"use client";

import { useQuery } from "@tanstack/react-query";

export interface RarityValue {
  value: string;
  count: number;
}
export interface RarityTrait {
  traitType: string;
  distinctValues: number;
  values: RarityValue[];
}
export interface CollectionRarity {
  contract: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
  totalSupply: number | null;
  types: RarityTrait[];
  source: "summary" | "tokens" | "none";
  sampled: number;
  truncated: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function useCollectionRarity(contract: string | null) {
  return useQuery({
    queryKey: ["rarity", contract],
    enabled: !!contract,
    staleTime: 10 * 60_000,
    queryFn: () =>
      fetchJson<CollectionRarity>(`/api/rarity?contract=${contract}`),
  });
}
