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
  /** "summary" = Alchemy attribute summary; "tokens" = tallied from metadata. */
  source: "summary" | "tokens" | "none";
  /** Tokens scanned when tallied from metadata (0 when from the summary). */
  sampled: number;
  /** True when the token scan hit its page cap (rarity is approximate). */
  truncated: boolean;
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

function attributesOf(raw: any): { traitType: string; value: string }[] {
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

const MAX_TALLY_PAGES = 40; // 40 × 100 = up to 4,000 tokens scanned

/**
 * Fallback when Alchemy's attribute summary is empty: page the contract's
 * tokens with metadata and tally attributes ourselves. Bounded so it can't run
 * away on huge collections (rarity is then approximate — flagged `truncated`).
 */
async function tallyFromTokens(contract: string): Promise<{
  types: RarityTrait[];
  sampled: number;
  truncated: boolean;
}> {
  const byType = new Map<string, Map<string, number>>();
  let sampled = 0;
  let pageKey: string | undefined;
  let page = 0;

  for (; page < MAX_TALLY_PAGES; page++) {
    const params = new URLSearchParams({
      contractAddress: contract,
      withMetadata: "true",
      limit: "100",
    });
    if (pageKey) params.set("startToken", pageKey);
    const data = await getJson(`${nftBase()}/getNFTsForContract?${params}`);

    for (const nft of data?.nfts ?? []) {
      sampled++;
      for (const { traitType, value } of attributesOf(nft)) {
        let vals = byType.get(traitType);
        if (!vals) byType.set(traitType, (vals = new Map()));
        vals.set(value, (vals.get(value) ?? 0) + 1);
      }
    }

    pageKey = data?.pageKey ?? undefined;
    if (!pageKey) break;
  }

  const types: RarityTrait[] = [...byType.entries()]
    .map(([traitType, vals]) => ({
      traitType,
      distinctValues: vals.size,
      values: [...vals.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.count - b.count),
    }))
    .sort((a, b) => a.traitType.localeCompare(b.traitType));

  return { types, sampled, truncated: page >= MAX_TALLY_PAGES && !!pageKey };
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

  let types: RarityTrait[] = Object.entries(summary)
    .map(([traitType, values]) => {
      const rows = Object.entries(values)
        .map(([value, count]) => ({ value, count: Number(count) || 0 }))
        .sort((a, b) => a.count - b.count); // rarest first
      return { traitType, distinctValues: rows.length, values: rows };
    })
    .sort((a, b) => a.traitType.localeCompare(b.traitType));

  let source: CollectionRarity["source"] = types.length ? "summary" : "none";
  let sampled = 0;
  let truncated = false;

  // Alchemy's summary is empty for some contracts even when tokens have traits
  // — fall back to tallying from token metadata.
  if (types.length === 0) {
    try {
      const tallied = await tallyFromTokens(contract);
      if (tallied.types.length > 0) {
        types = tallied.types;
        source = "tokens";
        sampled = tallied.sampled;
        truncated = tallied.truncated;
      }
    } catch {
      // keep "none"
    }
  }

  const value: CollectionRarity = {
    contract,
    name: meta?.name ?? meta?.openSeaMetadata?.collectionName ?? null,
    symbol: meta?.symbol ?? null,
    image: meta?.openSeaMetadata?.imageUrl ?? meta?.image?.cachedUrl ?? null,
    totalSupply: Number.isFinite(totalSupply) ? totalSupply : null,
    types,
    source,
    sampled,
    truncated,
  };

  cache.set(contract, { at: Date.now(), value });
  return value;
}
