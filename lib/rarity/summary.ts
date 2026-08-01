import { nftBase } from "@/lib/burnt/alchemy";

/**
 * Trait-rarity summary for ANY collection, via Alchemy's attribute summary.
 * Same data the T00ns Battle Sheet uses, generalised to an arbitrary contract.
 */

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
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: CollectionRarity }>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export async function getCollectionRarity(
  contractRaw: string,
): Promise<CollectionRarity> {
  const contract = contractRaw.toLowerCase();
  const cached = cache.get(contract);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const [summaryRes, metaRes] = await Promise.allSettled([
    getJson(`${nftBase()}/summarizeNFTAttributes?contractAddress=${contract}`),
    getJson(`${nftBase()}/getContractMetadata?contractAddress=${contract}`),
  ]);

  const summary =
    summaryRes.status === "fulfilled" && summaryRes.value?.summary
      ? (summaryRes.value.summary as Record<string, Record<string, number>>)
      : {};

  const meta = metaRes.status === "fulfilled" ? metaRes.value : null;
  const metaTotal = Number(meta?.totalSupply);
  const summaryTotal =
    summaryRes.status === "fulfilled" ? Number(summaryRes.value?.totalSupply) : NaN;
  const totalSupply = Number.isFinite(metaTotal)
    ? metaTotal
    : Number.isFinite(summaryTotal)
      ? summaryTotal
      : null;

  const types: RarityTrait[] = Object.entries(summary)
    .map(([traitType, values]) => {
      const rows = Object.entries(values)
        .map(([value, count]) => ({ value, count: Number(count) || 0 }))
        .sort((a, b) => a.count - b.count); // rarest first
      return { traitType, distinctValues: rows.length, values: rows };
    })
    .sort((a, b) => a.traitType.localeCompare(b.traitType));

  const value: CollectionRarity = {
    contract,
    name: meta?.name ?? meta?.openSeaMetadata?.collectionName ?? null,
    symbol: meta?.symbol ?? null,
    image: meta?.openSeaMetadata?.imageUrl ?? meta?.image?.cachedUrl ?? null,
    totalSupply: Number.isFinite(totalSupply) ? totalSupply : null,
    types,
  };

  cache.set(contract, { at: Date.now(), value });
  return value;
}
