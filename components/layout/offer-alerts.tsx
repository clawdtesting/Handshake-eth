"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { Bell, Check, ExternalLink, X } from "lucide-react";
import type { TradeOffer } from "@/lib/types";
import { useNotifications } from "@/hooks/use-deal-rooms";
import { cn } from "@/lib/utils";

const STATE_KEY_PREFIX = "ethereum-market-notification-states";

type NotificationState = "unread" | "read" | "dismissed";
type NotificationStateMap = Record<string, NotificationState>;

type OfferNotification = {
  id: string;
  title: string;
  message: string;
  timestamp?: string;
  actionHref: string;
  actionLabel: string;
  state: NotificationState;
};

function getStateKey(address: string) {
  return `${STATE_KEY_PREFIX}:${address.toLowerCase()}`;
}

function readStates(address?: string): NotificationStateMap {
  if (!address || typeof window === "undefined") return {};

  try {
    const parsed = JSON.parse(localStorage.getItem(getStateKey(address)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as NotificationStateMap;
  } catch {
    return {};
  }
}

function writeStates(address: string, states: NotificationStateMap) {
  try {
    const entries = Object.entries(states).slice(-200);
    localStorage.setItem(getStateKey(address), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // localStorage unavailable; notification controls still work until refresh.
  }
}

function formatTimestamp(timestamp?: string) {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getOfferSummary(offer: TradeOffer) {
  const makerNfts = offer.nfts.filter((nft) => nft.side === "maker").length;
  const takerNfts = offer.nfts.filter((nft) => nft.side === "taker").length;
  const pieces = [];

  if (makerNfts > 0) pieces.push(`${makerNfts} NFT${makerNfts === 1 ? "" : "s"} offered`);
  if (takerNfts > 0) pieces.push(`${takerNfts} NFT${takerNfts === 1 ? "" : "s"} requested`);
  if (offer.makerEthAmount !== "0") pieces.push("ETH included by maker");
  if (offer.takerEthAmount !== "0") pieces.push("ETH requested from you");

  return pieces.length > 0 ? pieces.join(" · ") : "A wallet-to-wallet trade is waiting for your review.";
}

/**
 * Header bell: polls for open deals reserved for the connected wallet and lets
 * the user read, dismiss, or open each actionable notification.
 */
export function OfferAlerts() {
  const { address } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const [states, setStates] = useState<NotificationStateMap>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: incoming } = useQuery({
    queryKey: ["incoming-offers", address],
    enabled: !!address,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TradeOffer[]> => {
      const res = await fetch(`/api/offers?taker=${address}&status=open&limit=50`);
      if (!res.ok) return [];
      const { offers } = await res.json();
      return (offers as TradeOffer[]).filter(
        (o) => o.makerAddress.toLowerCase() !== address!.toLowerCase()
      );
    },
  });

  // Server-persistent Deal Room notifications (counter-proposals, invites,
  // agreements, settlements…). These are emitted server-side but were never
  // surfaced in the bell — so events like a counter appeared to notify nobody.
  const { data: roomNotifications, markRead } = useNotifications();
  const serverIds = useMemo(
    () => new Set((roomNotifications ?? []).map((n) => n.id)),
    [roomNotifications],
  );

  useEffect(() => {
    setStates(readStates(address));
    setIsOpen(false);
  }, [address]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const notifications = useMemo<OfferNotification[]>(() => {
    const offerAlerts: OfferNotification[] = (incoming ?? []).map((offer) => ({
      id: offer.id,
      title: "Private deal available",
      message: getOfferSummary(offer),
      timestamp: offer.createdAt,
      actionHref: "/account",
      actionLabel: "View dashboard",
      state: states[offer.id] ?? "unread",
    }));

    const roomAlerts: OfferNotification[] = (roomNotifications ?? []).map(
      (n) => ({
        id: n.id,
        title: n.title,
        message: n.body,
        timestamp: n.createdAt,
        actionHref: n.actionPath,
        actionLabel: "Open",
        // Server tracks read via readAt; a local override wins once set.
        state: states[n.id] ?? (n.readAt ? "read" : "unread"),
      }),
    );

    return [...roomAlerts, ...offerAlerts]
      .filter((notification) => notification.state !== "dismissed")
      .sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      });
  }, [incoming, roomNotifications, states]);

  const unreadCount = notifications.filter((notification) => notification.state === "unread").length;

  function updateNotificationState(ids: string[], state: NotificationState) {
    if (!address) return;

    setStates((current) => {
      const next = { ...current };
      ids.forEach((id) => {
        next[id] = state;
      });
      writeStates(address, next);
      return next;
    });

    // Persist read state server-side for Deal Room notifications so it holds
    // across devices; offer alerts stay client-only as before.
    if (state === "read" || state === "dismissed") {
      ids
        .filter((id) => serverIds.has(id))
        .forEach((id) => markRead.mutate({ id }));
    }
  }

  if (!address) return null;

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread deal notification${unreadCount === 1 ? "" : "s"}`
            : "Deal notifications"
        }
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ethereum-purple px-1 text-[10px] font-bold text-ethereum-black">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-x-4 top-16 z-50 overflow-hidden rounded-2xl border border-ethereum-purple/25 bg-background/95 shadow-2xl shadow-ethereum-purple/15 backdrop-blur md:absolute md:inset-x-auto md:right-0 md:top-11 md:w-96">
          <div className="flex items-center justify-between border-b border-ethereum-purple/15 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <p className="text-xs text-muted-foreground">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  updateNotificationState(
                    notifications
                      .filter((notification) => notification.state === "unread")
                      .map((notification) => notification.id),
                    "read"
                  )
                }
                className="rounded-full border border-ethereum-purple/30 px-3 py-1 text-xs font-medium text-ethereum-purple transition-colors hover:bg-ethereum-purple/10"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications</div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => {
                  const timestamp = formatTimestamp(notification.timestamp);

                  return (
                    <article
                      key={notification.id}
                      className={cn(
                        "rounded-xl border p-3 transition-colors",
                        notification.state === "unread"
                          ? "border-ethereum-purple/35 bg-ethereum-purple/10"
                          : "border-border/60 bg-secondary/25"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-1 h-2 w-2 shrink-0 rounded-full",
                            notification.state === "unread" ? "bg-ethereum-purple" : "bg-muted-foreground/35"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{notification.title}</h3>
                            {timestamp && (
                              <time className="shrink-0 text-[11px] text-muted-foreground">
                                {timestamp}
                              </time>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {notification.message}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Link
                              href={notification.actionHref}
                              onClick={() => updateNotificationState([notification.id], "read")}
                              className="inline-flex items-center gap-1 rounded-full bg-ethereum-purple px-3 py-1.5 text-xs font-semibold text-ethereum-black transition-opacity hover:opacity-90"
                            >
                              {notification.actionLabel}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                            {notification.state === "unread" && (
                              <button
                                type="button"
                                onClick={() => updateNotificationState([notification.id], "read")}
                                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                              >
                                <Check className="h-3 w-3" />
                                Mark as read
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => updateNotificationState([notification.id], "dismissed")}
                              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
