"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

export interface BurntStats {
  collection: {
    address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
    initialSupply: number;
  };
  supply: {
    current: number;
    burnedToDead: number;
    trueBurned: number;
    totalBurned: number;
    alive: number;
    burnPct: number;
  };
  burnAddresses: string[];
  deadHeldTokenIds: string[];
  burntTokenIds: string[];
  uniqueBurners: number;
  topBurners: { address: string; count: number }[];
  recentBurns: {
    tokenId: string;
    from: string;
    timestamp: string | null;
    name: string | null;
    image: string | null;
  }[];
  updatedAt: number;
  diagnostics?: {
    hasKey: boolean;
    nftNetwork: string;
    rpcNetwork: string;
    supplyKnown: boolean;
    errors: string[];
  };
}

export type BurntStatus = "all" | "alive" | "burned";

export interface BurntToken {
  tokenId: string;
  name: string | null;
  image: string | null;
  status: "alive" | "burned";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function useBurntStats() {
  return useQuery({
    queryKey: ["burnt-stats"],
    staleTime: 60_000,
    queryFn: () => fetchJson<BurntStats>("/api/burnt"),
  });
}

/** A selected trait, e.g. { traitType: "eyes", value: "Laser" }. */
export interface SelectedTrait {
  traitType: string;
  value: string;
}

function traitParams(traits: SelectedTrait[]): string[] {
  return traits.map((t) => `${t.traitType}~${t.value}`);
}

export function useBurntTokens(status: BurntStatus, traits: SelectedTrait[] = []) {
  // Stable key independent of selection order.
  const traitKey = traitParams(traits).sort().join("|");
  return useInfiniteQuery({
    queryKey: ["burnt-tokens", status, traitKey],
    staleTime: 60_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status });
      if (pageParam) params.set("pageKey", pageParam);
      for (const t of traitParams(traits)) params.append("t", t);
      return fetchJson<{ tokens: BurntToken[]; pageKey: string | null }>(
        `/api/burnt/tokens?${params}`,
      );
    },
    getNextPageParam: (last) => last.pageKey,
  });
}

export interface TraitValue {
  value: string;
  count: number;
  burnt: number;
}
export interface TraitType {
  traitType: string;
  distinctValues: number;
  values: TraitValue[];
}
export interface TraitLeaderRow {
  traitType: string;
  value: string;
  burnt: number;
  total: number;
  burntPct: number;
}
export interface BurntTraits {
  types: TraitType[];
  leaderboard: TraitLeaderRow[];
  sampled: number;
  burntTotal: number;
  error: string | null;
}

export function useBurntTraits() {
  return useQuery({
    queryKey: ["burnt-traits"],
    staleTime: 5 * 60_000,
    queryFn: () => fetchJson<BurntTraits>("/api/burnt/traits"),
  });
}

export interface BurntTokenLookup {
  tokenId: string;
  exists: boolean;
  status?: "alive" | "burnt";
  name?: string | null;
  image?: string | null;
  owner?: string | null;
  traits?: { traitType: string; value: string }[];
}

export function useBurntTokenLookup(id: string | null) {
  return useQuery({
    queryKey: ["burnt-token", id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<BurntTokenLookup>(`/api/burnt/token?id=${encodeURIComponent(id!)}`),
  });
}
