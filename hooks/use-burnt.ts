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
  topBurners: { address: string; count: number }[];
  updatedAt: number;
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

export function useBurntTokens(status: BurntStatus) {
  return useInfiniteQuery({
    queryKey: ["burnt-tokens", status],
    staleTime: 60_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status });
      if (pageParam) params.set("pageKey", pageParam);
      return fetchJson<{ tokens: BurntToken[]; pageKey: string | null }>(
        `/api/burnt/tokens?${params}`,
      );
    },
    getNextPageParam: (last) => last.pageKey,
  });
}
