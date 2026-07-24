"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buildSessionMessage } from "@/lib/deal-rooms/session-message";
import { roomChannelName } from "@/lib/deal-rooms/broadcast";
import type {
  DealRoom,
  DealRoomDetail,
  DealRoomDraft,
  DealRoomRevision,
  DeclineReason,
  RoomNotification,
  TradeOffer,
} from "@/lib/types";
import type { ReadinessReport } from "@/lib/deal-rooms/readiness";

/**
 * Client state for Deal Rooms.
 *
 * Session: one personal_sign per wallet per day mints a bearer token
 * (localStorage, per-wallet key). Every room API call carries it. The
 * signature proves wallet ownership only — the sign-in message says so.
 *
 * Live layer: a Supabase broadcast/presence channel per room. Broadcast pings
 * invalidate the React Query cache; presence powers the "they're here"
 * indicator. Polling stays on as fallback so realtime is never load-bearing.
 */

const TOKEN_KEY = (wallet: string) => `handshake:room-session:${wallet}`;

interface StoredSession {
  token: string;
  expiresAt: number;
}

function readStoredSession(wallet: string): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY(wallet.toLowerCase()));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    // 5-minute safety margin so a token never expires mid-flow.
    if (parsed.expiresAt < Date.now() + 5 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function apiFetch<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `Request failed (${res.status})`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------

export function useRoomSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const wallet = address?.toLowerCase() ?? null;
  const [token, setToken] = useState<string | null>(null);
  const signingRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (!wallet) {
      setToken(null);
      return;
    }
    setToken(readStoredSession(wallet)?.token ?? null);
  }, [wallet]);

  /**
   * Returns a valid token, prompting one sign-in signature if needed.
   * Concurrent callers share a single wallet prompt.
   */
  const ensureSession = useCallback(async (): Promise<string> => {
    if (!wallet) throw new Error("Connect your wallet first");
    const stored = readStoredSession(wallet);
    if (stored) {
      setToken(stored.token);
      return stored.token;
    }
    if (signingRef.current) return signingRef.current;

    signingRef.current = (async () => {
      try {
        const timestamp = Date.now();
        const message = buildSessionMessage({ walletAddress: wallet, timestamp });
        const signature = await signMessageAsync({ message });
        const res = await fetch("/api/deal-rooms/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: wallet, timestamp, signature }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Sign-in failed");
        }
        const data = (await res.json()) as StoredSession & { token: string };
        window.localStorage.setItem(
          TOKEN_KEY(wallet),
          JSON.stringify({ token: data.token, expiresAt: data.expiresAt })
        );
        setToken(data.token);
        return data.token;
      } finally {
        signingRef.current = null;
      }
    })();
    return signingRef.current;
  }, [wallet, signMessageAsync]);

  return { wallet, token, hasSession: !!token, ensureSession };
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

export type RoomListEntry = DealRoom & {
  currentRevision: DealRoomRevision | null;
};

export function useMyRooms() {
  const { wallet, token } = useRoomSession();
  return useQuery({
    queryKey: ["deal-rooms", wallet],
    enabled: !!wallet && !!token,
    refetchInterval: 30_000,
    queryFn: () =>
      apiFetch<{ rooms: RoomListEntry[] }>("/api/deal-rooms", token!).then(
        (d) => d.rooms
      ),
  });
}

export function useDealRoom(id: string | null) {
  const { wallet, token } = useRoomSession();
  return useQuery({
    queryKey: ["deal-room", id],
    enabled: !!id && !!wallet && !!token,
    // Fallback cadence; the realtime channel invalidates much faster.
    refetchInterval: 5_000,
    queryFn: () =>
      apiFetch<{ room: DealRoomDetail }>(`/api/deal-rooms/${id}`, token!).then(
        (d) => d.room
      ),
  });
}

export function useRoomReadiness(id: string | null, enabled: boolean) {
  const { token } = useRoomSession();
  return useQuery({
    queryKey: ["deal-room-readiness", id],
    enabled: !!id && !!token && enabled,
    refetchInterval: 15_000,
    queryFn: () =>
      apiFetch<{ readiness: ReadinessReport }>(
        `/api/deal-rooms/${id}/readiness`,
        token!
      ).then((d) => d.readiness),
  });
}

export function useNotifications() {
  const { wallet, token } = useRoomSession();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications", wallet],
    enabled: !!wallet && !!token,
    refetchInterval: 20_000,
    queryFn: () =>
      apiFetch<{ notifications: RoomNotification[] }>(
        "/api/notifications",
        token!
      ).then((d) => d.notifications),
  });
  const markRead = useMutation({
    mutationFn: (p: { id?: string; all?: boolean }) =>
      apiFetch("/api/notifications", token!, {
        method: "POST",
        body: JSON.stringify(p),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications", wallet] }),
  });
  return { ...query, markRead };
}

// ---------------------------------------------------------------------
// Live layer: broadcast + presence
// ---------------------------------------------------------------------

export interface RoomPresence {
  /** Lowercased wallets currently in the room (including self). */
  present: string[];
  counterpartyHere: boolean;
}

export function useRoomLive(
  room: Pick<DealRoomDetail, "id" | "realtimeToken"> | null | undefined,
  counterparty: string | null
): RoomPresence {
  const { wallet } = useRoomSession();
  const queryClient = useQueryClient();
  const [present, setPresent] = useState<string[]>([]);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase || !room?.id || !room.realtimeToken || !wallet) return;

    const channel = supabase.channel(
      roomChannelName(room.id, room.realtimeToken),
      { config: { presence: { key: wallet } } }
    );

    channel
      .on("broadcast", { event: "room_updated" }, () => {
        queryClient.invalidateQueries({ queryKey: ["deal-room", room.id] });
        queryClient.invalidateQueries({ queryKey: ["deal-rooms"] });
        queryClient.invalidateQueries({
          queryKey: ["deal-room-readiness", room.id],
        });
      })
      .on("presence", { event: "sync" }, () => {
        setPresent(Object.keys(channel.presenceState()).map((k) => k.toLowerCase()));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ at: Date.now() });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      setPresent([]);
    };
  }, [room?.id, room?.realtimeToken, wallet, queryClient]);

  return useMemo(
    () => ({
      present,
      counterpartyHere:
        !!counterparty && present.includes(counterparty.toLowerCase()),
    }),
    [present, counterparty]
  );
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

export interface CreateRoomInput {
  chainId: number;
  counterparty: string;
  sourceOfferId?: string | null;
  sourceWantedPostId?: string | null;
  expiresInMinutes?: number;
  draft: DealRoomDraft;
  note?: string | null;
}

export function useRoomMutations(roomId: string | null) {
  const { ensureSession } = useRoomSession();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    if (roomId) {
      queryClient.invalidateQueries({ queryKey: ["deal-room", roomId] });
      queryClient.invalidateQueries({
        queryKey: ["deal-room-readiness", roomId],
      });
    }
    queryClient.invalidateQueries({ queryKey: ["deal-rooms"] });
  }, [queryClient, roomId]);

  const createRoom = useMutation({
    mutationFn: async (input: CreateRoomInput) => {
      const token = await ensureSession();
      return apiFetch<{ room: DealRoom; existing?: boolean }>(
        "/api/deal-rooms",
        token,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: invalidate,
  });

  const propose = useMutation({
    mutationFn: async (input: {
      expectedVersion: number;
      draft: DealRoomDraft;
      note?: string | null;
    }) => {
      const token = await ensureSession();
      return apiFetch<{ room: DealRoom; revision: DealRoomRevision }>(
        `/api/deal-rooms/${roomId}/revisions`,
        token,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: invalidate,
  });

  const agree = useMutation({
    mutationFn: async (input: { expectedVersion: number; revisionId: string }) => {
      const token = await ensureSession();
      return apiFetch<{ room: DealRoom; bothAgreed: boolean }>(
        `/api/deal-rooms/${roomId}/agree`,
        token,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: invalidate,
  });

  const decline = useMutation({
    mutationFn: async (input: {
      expectedVersion: number;
      reason: DeclineReason;
    }) => {
      const token = await ensureSession();
      return apiFetch<{ room: DealRoom }>(
        `/api/deal-rooms/${roomId}/decline`,
        token,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: async (input: { expectedVersion: number }) => {
      const token = await ensureSession();
      return apiFetch<{ room: DealRoom }>(
        `/api/deal-rooms/${roomId}/cancel`,
        token,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: invalidate,
  });

  const finalize = useMutation({
    mutationFn: async (input: {
      expectedVersion: number;
      order: {
        maker: string;
        taker: string;
        makerNFTs: { contractAddress: string; tokenId: string }[];
        takerNFTs: { contractAddress: string; tokenId: string }[];
        makerEthAmount: string;
        takerEthAmount: string;
        feeBps: string;
        flatFee: string;
        nonce: string;
        expiry: string;
      };
      signature: string;
    }) => {
      const token = await ensureSession();
      return apiFetch<{ offer: TradeOffer; room: DealRoom }>(
        `/api/deal-rooms/${roomId}/finalize`,
        token,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: invalidate,
  });

  return { createRoom, propose, agree, decline, cancel, finalize, invalidate };
}
