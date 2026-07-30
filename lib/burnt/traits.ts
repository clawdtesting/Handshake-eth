import { nftBase } from "@/lib/burnt/alchemy";
import { BURNT_COLLECTION_ADDRESS } from "@/lib/burnt/config";
import { getBurntStats } from "@/lib/burnt/stats";

/**
 * Trait data for the Burnt page: the collection-wide attribute universe that
 * powers the OpenSea-style filter sidebar, and a leaderboard of which traits
 * have been burned the most.
 */

export interface TraitValue {
  value: string;
  /** How many tokens in the whole collection have this value. */
  count: number;
  /** How many burned tokens have this value. */
  burnt: number;
}

export interface TraitType {
  traitType: string;
  /** Distinct values in this trait type (the number OpenSea shows). */
  distinctValues: number;
  values: TraitValue[];
}

export interface TraitLeaderRow {
  traitType: string;
  value: string;
  burnt: number;
  total: number;
  /** Share of tokens with this trait that are burned, 0–100. */
  burntPct: number;
}

export interface BurntTraits {
  types: TraitType[];
  leaderboard: TraitLeaderRow[];
  /** Burned tokens whose metadata resolved (basis of the trait counts). */
  sampled: number;
  burntTotal: number;
  error: string | null;
}

const BATCH = 100;
const TTL_MS = 5 * 60_000;
let cache: { at: number; value: BurntTraits } | null = null;

/** Normalise a token's attributes to {traitType, value} pairs. */
export function attributesOf(raw: any): { traitType: string; value: string }[] {
  const attrs =
    raw?.raw?.metadata?.attributes ??
    raw?.metadata?.attributes ??
    raw?.attributes ??
    [];
  if (!Array.isArray(attrs)) return [];
  const out: { traitType: string; value: string }[] = [];
  for (const a of attrs) {
    const traitType = a?.trait_type ?? a?.traitType ?? a?.key;
    const value = a?.value ?? a?.trait_value;
    if (traitType == null || value == null) continue;
    out.push({ traitType: String(traitType), value: String(value) });
  }
  return out;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `summarizeNFTAttributes → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`getNFTMetadataBatch → ${res.status}`);
  return res.json();
}

/** Collection-wide attribute counts via Alchemy's attribute summary. */
async function getSummary(): Promise<Record<string, Record<string, number>>> {
  const data = await getJson(
    `${nftBase()}/summarizeNFTAttributes?contractAddress=${BURNT_COLLECTION_ADDRESS}`,
  );
  const summary = data?.summary;
  return summary && typeof summary === "object" ? summary : {};
}

/** Fetch metadata for a set of token ids in bounded batches. */
export async function fetchMetadataBatch(ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const data = await postJson(`${nftBase()}/getNFTMetadataBatch`, {
      tokens: slice.map((tokenId) => ({
        contractAddress: BURNT_COLLECTION_ADDRESS,
        tokenId,
      })),
      refreshCache: false,
    });
    for (const nft of data?.nfts ?? []) out.push(nft);
  }
  return out;
}

const LEADERBOARD_SIZE = 40;

export async function getBurntTraits(): Promise<BurntTraits> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const stats = await getBurntStats();
  const burntIds = stats.burntTokenIds;

  // Collection-wide totals (denominators + sidebar) and the burned tokens'
  // own attributes (numerators) recover independently.
  const [summaryR, burntNftsR] = await Promise.allSettled([
    getSummary(),
    fetchMetadataBatch(burntIds),
  ]);

  const summary = summaryR.status === "fulfilled" ? summaryR.value : {};
  const burntNfts = burntNftsR.status === "fulfilled" ? burntNftsR.value : [];
  const error =
    summaryR.status === "rejected"
      ? String((summaryR.reason as Error)?.message ?? summaryR.reason)
      : burntNftsR.status === "rejected"
        ? String((burntNftsR.reason as Error)?.message ?? burntNftsR.reason)
        : null;

  // Tally burned-trait occurrences into a nested map — no string keys, so
  // trait names/values with spaces can never collide.
  const burntByType = new Map<string, Map<string, number>>();
  let sampled = 0;
  for (const nft of burntNfts) {
    const attrs = attributesOf(nft);
    if (attrs.length > 0) sampled++;
    for (const { traitType, value } of attrs) {
      let byValue = burntByType.get(traitType);
      if (!byValue) burntByType.set(traitType, (byValue = new Map()));
      byValue.set(value, (byValue.get(value) ?? 0) + 1);
    }
  }
  const burntOf = (t: string, v: string) => burntByType.get(t)?.get(v) ?? 0;

  // Sidebar types from the collection summary, annotated with burnt counts.
  const types: TraitType[] = Object.entries(summary)
    .map(([traitType, values]) => {
      const rows: TraitValue[] = Object.entries(values)
        .map(([value, count]) => ({
          value,
          count: Number(count) || 0,
          burnt: burntOf(traitType, value),
        }))
        .sort((a, b) => b.count - a.count);
      return { traitType, distinctValues: rows.length, values: rows };
    })
    .sort((a, b) => a.traitType.localeCompare(b.traitType));

  // Leaderboard: traits most represented among burned tokens. Flattened from
  // `types` so each row keeps its structured trait/value — never re-parsed.
  const leaderboard: TraitLeaderRow[] = types
    .flatMap((t) =>
      t.values.map((v) => ({
        traitType: t.traitType,
        value: v.value,
        burnt: v.burnt,
        total: v.count,
        burntPct: v.count > 0 ? Math.round((v.burnt / v.count) * 1000) / 10 : 0,
      })),
    )
    .filter((r) => r.burnt > 0)
    // Rank by share of the trait that's been burned; break ties by raw burnt
    // count so a 1-of-1 100% doesn't outrank a broadly-burned trait at 100%.
    .sort((a, b) => b.burntPct - a.burntPct || b.burnt - a.burnt)
    .slice(0, LEADERBOARD_SIZE);

  const value: BurntTraits = {
    types,
    leaderboard,
    sampled,
    burntTotal: burntIds.length,
    error,
  };

  if (!error) cache = { at: Date.now(), value };
  return value;
}

/**
 * tokenId → attribute pairs for burned tokens, so the token grid can filter
 * the burnt view by trait without re-fetching metadata.
 */
export async function getBurntTraitMap(): Promise<
  Map<string, { traitType: string; value: string }[]>
> {
  const stats = await getBurntStats();
  const nfts = await fetchMetadataBatch(stats.burntTokenIds);
  const map = new Map<string, { traitType: string; value: string }[]>();
  for (const nft of nfts) {
    const id = String(nft?.tokenId ?? "");
    if (id) map.set(id, attributesOf(nft));
  }
  return map;
}
