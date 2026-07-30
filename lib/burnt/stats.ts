import {
  BURN_ADDRESSES,
  BURNT_COLLECTION_ADDRESS,
  BURNT_INITIAL_SUPPLY,
  isBurnAddress,
} from "@/lib/burnt/config";
import { ALCHEMY_NETWORK, nftBase, rpcUrl } from "@/lib/burnt/alchemy";

/**
 * Server-side burn accounting for the Burnt page. All chain reads go through
 * Alchemy (the provider the rest of the app already uses):
 *   - getContractMetadata      → name / symbol / logo / live totalSupply
 *   - getOwnersForContract     → every existing token + its current holder,
 *                                which is how we know what's held by a burn sink
 *   - alchemy_getAssetTransfers → who sent tokens to a sink (the leaderboard)
 *
 * Two kinds of "gone" are tracked separately because they are genuinely
 * different on-chain events:
 *   - trueBurned:   a real ERC-721 `_burn` — the token no longer exists, so it
 *                   never comes back from getOwnersForContract. Counted as
 *                   (initialSupply − currentSupply).
 *   - burnedToDead: the token still exists but its holder is a burn sink
 *                   (0x…dEaD or a configured burn contract). Enumerable by id.
 */


// Which Alchemy REST endpoint a URL is hitting, for readable diagnostics that
// never include the API key.
function endpointOf(url: string): string {
  return url.split("/nft/v3/")[1]?.split("?")[0]?.split("/").pop() ?? "request";
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `${endpointOf(url)} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res.json();
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`${method} → ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "RPC error"}`);
  return body.result;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

function recentImageOf(raw: any): string | null {
  return (
    raw?.image?.cachedUrl ??
    raw?.image?.thumbnailUrl ??
    raw?.image?.originalUrl ??
    raw?.image?.pngUrl ??
    null
  );
}

/** Attach name/image to the latest burns via a single metadata batch. */
async function enrichRecent(events: BurnEvent[]): Promise<BurntStats["recentBurns"]> {
  if (events.length === 0) return [];
  const data = await postJson(`${nftBase()}/getNFTMetadataBatch`, {
    tokens: events.map((e) => ({
      contractAddress: BURNT_COLLECTION_ADDRESS,
      tokenId: e.tokenId,
    })),
    refreshCache: false,
  });
  const byId = new Map<string, any>();
  for (const nft of data?.nfts ?? []) byId.set(String(nft?.tokenId ?? ""), nft);

  return events.map((e) => {
    const raw = byId.get(e.tokenId);
    const rawName = raw?.name ?? raw?.raw?.metadata?.name;
    return {
      tokenId: e.tokenId,
      from: e.from,
      timestamp: e.timestamp,
      name:
        typeof rawName === "string" && rawName.trim()
          ? rawName.trim()
          : `#${e.tokenId}`,
      image: raw ? recentImageOf(raw) : null,
    };
  });
}

export interface BurntStats {
  collection: {
    address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
    initialSupply: number;
  };
  supply: {
    /** Tokens that still exist on-chain (includes those parked in a sink). */
    current: number;
    /** Existing tokens whose holder is a burn sink. */
    burnedToDead: number;
    /** Tokens destroyed via a real `_burn` (initial − current). */
    trueBurned: number;
    /** burnedToDead + trueBurned. */
    totalBurned: number;
    /** Tokens still in circulation. */
    alive: number;
    /** Percent of the original mint that is gone, 0–100 (one decimal). */
    burnPct: number;
  };
  burnAddresses: string[];
  /** Token ids currently parked in a burn sink, ascending. */
  deadHeldTokenIds: string[];
  /** Every token id ever burned (to any sink, incl. zero-address burns). */
  burntTokenIds: string[];
  /** Distinct wallets that have burned at least one token. */
  uniqueBurners: number;
  /** Wallets ranked by how many tokens they've sent to a sink. */
  topBurners: { address: string; count: number }[];
  /** The most recently burned tokens (newest first), enriched with art. */
  recentBurns: {
    tokenId: string;
    from: string;
    timestamp: string | null;
    name: string | null;
    image: string | null;
  }[];
  updatedAt: number;
  /**
   * Non-sensitive health info: whether a key is configured, the resolved
   * hosts, whether live supply was actually read, and any per-call failures.
   * Surfaced via `/api/burnt?debug=1`. Never contains the API key.
   */
  diagnostics: {
    hasKey: boolean;
    nftNetwork: string;
    rpcNetwork: string;
    supplyKnown: boolean;
    errors: string[];
  };
}

// A single burn tracker for one collection: a short shared cache keeps the
// heavier owner/transfer enumeration from re-running on every page hit.
let cache: { at: number; value: BurntStats } | null = null;
const TTL_MS = 60_000;

const MAX_OWNER_PAGES = 40; // ~40 * 1000 tokens — ample headroom over 5k
const MAX_TRANSFER_PAGES = 20; // per sink

async function getContractMeta(): Promise<{
  name: string | null;
  symbol: string | null;
  image: string | null;
  totalSupply: number | null;
}> {
  const data = await getJson(
    `${nftBase()}/getContractMetadata?contractAddress=${BURNT_COLLECTION_ADDRESS}`,
  );
  const total = Number(data?.totalSupply);
  return {
    name: data?.name ?? data?.openSeaMetadata?.collectionName ?? null,
    symbol: data?.symbol ?? null,
    image: data?.openSeaMetadata?.imageUrl ?? data?.image?.cachedUrl ?? null,
    totalSupply: Number.isFinite(total) ? total : null,
  };
}

/** Walk getOwnersForContract, collecting the ids each burn sink holds. */
async function getDeadHeldTokenIds(): Promise<{
  deadHeldIds: string[];
  existingCount: number;
}> {
  const deadHeld = new Set<string>();
  let existing = 0;
  let pageKey: string | undefined;

  for (let page = 0; page < MAX_OWNER_PAGES; page++) {
    const params = new URLSearchParams({
      contractAddress: BURNT_COLLECTION_ADDRESS,
      withTokenBalances: "true",
    });
    if (pageKey) params.set("pageKey", pageKey);
    const data = await getJson(`${nftBase()}/getOwnersForContract?${params}`);

    for (const owner of data?.owners ?? []) {
      const balances = owner?.tokenBalances ?? [];
      existing += balances.length;
      if (isBurnAddress(owner?.ownerAddress)) {
        for (const b of balances) {
          const id = tokenIdToDecimal(b?.tokenId);
          if (id !== null) deadHeld.add(id);
        }
      }
    }

    pageKey = data?.pageKey ?? undefined;
    if (!pageKey) break;
  }

  const deadHeldIds = Array.from(deadHeld).sort((a, b) => Number(a) - Number(b));
  return { deadHeldIds, existingCount: existing };
}

interface BurnEvent {
  tokenId: string;
  from: string;
  blockNum: number;
  timestamp: string | null;
}

interface BurnScan {
  /** Wallets ranked by how many tokens they sent to a sink. */
  topBurners: { address: string; count: number }[];
  /** Distinct wallets that have burned at least one token. */
  uniqueBurners: number;
  /** Every token id ever sent to a sink (authoritative burnt set). */
  burntTokenIds: string[];
  /** The most recent burns first (id, burner, when). */
  recentBurns: BurnEvent[];
}

/**
 * One pass over every burn-sink's inbound ERC-721 transfers. It's the single
 * source for the leaderboard, the unique-burner count, and the burnt token-id
 * set (which includes real `_burn`s to the zero address, not just dead-held
 * tokens) — so traits of burnt tokens can be resolved from these ids.
 */
const RECENT_BURNS = 5;

async function scanBurns(): Promise<BurnScan> {
  const counts = new Map<string, number>();
  const burntIds = new Set<string>();
  // Keep only the most recent events by block, so "latest burns" is cheap.
  const events: BurnEvent[] = [];

  for (const sink of BURN_ADDRESSES) {
    let pageKey: string | undefined;
    for (let page = 0; page < MAX_TRANSFER_PAGES; page++) {
      const result = await rpc("alchemy_getAssetTransfers", [
        {
          fromBlock: "0x0",
          toBlock: "latest",
          contractAddresses: [BURNT_COLLECTION_ADDRESS],
          toAddress: sink,
          category: ["erc721"],
          excludeZeroValue: false,
          withMetadata: true,
          maxCount: "0x3e8",
          order: "asc",
          ...(pageKey ? { pageKey } : {}),
        },
      ]);

      for (const t of result?.transfers ?? []) {
        const id = tokenIdToDecimal(t?.erc721TokenId ?? t?.tokenId);
        if (id !== null) {
          burntIds.add(id);
          const blockNum = Number(t?.blockNum ?? 0) || parseInt(t?.blockNum ?? "0", 16) || 0;
          events.push({
            tokenId: id,
            from: (t?.from ?? "").toLowerCase(),
            blockNum,
            timestamp: t?.metadata?.blockTimestamp ?? null,
          });
        }
        const from = (t?.from ?? "").toLowerCase();
        // A mint is a transfer FROM zero; that isn't someone burning.
        if (!from || isBurnAddress(from)) continue;
        counts.set(from, (counts.get(from) ?? 0) + 1);
      }

      pageKey = result?.pageKey ?? undefined;
      if (!pageKey) break;
    }
  }

  const topBurners = Array.from(counts.entries())
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const burntTokenIds = Array.from(burntIds).sort((a, b) => Number(a) - Number(b));
  // Most recent first, across both sinks; keep a handful.
  const recentBurns = events
    .sort((a, b) => b.blockNum - a.blockNum)
    .slice(0, RECENT_BURNS);
  return { topBurners, uniqueBurners: counts.size, burntTokenIds, recentBurns };
}

function tokenIdToDecimal(tokenId: unknown): string | null {
  if (tokenId === null || tokenId === undefined) return null;
  const raw = String(tokenId);
  try {
    // Alchemy returns ids as decimal strings, but be tolerant of hex too.
    return raw.startsWith("0x") ? BigInt(raw).toString(10) : BigInt(raw).toString(10);
  } catch {
    return null;
  }
}

export async function getBurntStats(): Promise<BurntStats> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const errors: string[] = [];

  // Each source is isolated: a failure in one (a rate-limited endpoint, a
  // collection the indexer hasn't ingested) records a diagnostic but never
  // blanks the whole page. Original mint always renders from config.
  const [metaR, heldR, scanR] = await Promise.allSettled([
    getContractMeta(),
    getDeadHeldTokenIds(),
    scanBurns(),
  ]);

  const meta =
    metaR.status === "fulfilled"
      ? metaR.value
      : (errors.push(errMsg(metaR.reason)),
        { name: null, symbol: null, image: null, totalSupply: null });

  const held =
    heldR.status === "fulfilled"
      ? { ...heldR.value, ok: true }
      : (errors.push(errMsg(heldR.reason)),
        { deadHeldIds: [] as string[], existingCount: 0, ok: false });

  const scan: BurnScan =
    scanR.status === "fulfilled"
      ? scanR.value
      : (errors.push(errMsg(scanR.reason)),
        { topBurners: [], uniqueBurners: 0, burntTokenIds: [], recentBurns: [] });
  const { topBurners, uniqueBurners, burntTokenIds } = scan;

  // Enrich the latest burns with art (one small batch). Non-fatal.
  const recentBurns = await enrichRecent(scan.recentBurns).catch((e) => {
    errors.push(errMsg(e));
    return scan.recentBurns.map((b) => ({
      tokenId: b.tokenId,
      from: b.from,
      timestamp: b.timestamp,
      name: `#${b.tokenId}`,
      image: null as string | null,
    }));
  });

  const initialSupply = BURNT_INITIAL_SUPPLY;
  // Live supply is "known" only if the contract reported totalSupply or we
  // successfully enumerated owners. When it's unknown we must NOT infer that
  // everything burned — fall back to the original mint (0% burnt, pending).
  const supplyKnown = meta.totalSupply !== null || held.ok;
  const current = meta.totalSupply ?? (held.ok ? held.existingCount : initialSupply);
  const burnedToDead = held.deadHeldIds.length;
  const trueBurned = Math.max(0, initialSupply - current);
  const totalBurned = Math.min(initialSupply, trueBurned + burnedToDead);
  const alive = Math.max(0, initialSupply - totalBurned);
  const burnPct =
    initialSupply > 0
      ? Math.round((totalBurned / initialSupply) * 1000) / 10
      : 0;

  const value: BurntStats = {
    collection: {
      address: BURNT_COLLECTION_ADDRESS,
      name: meta.name,
      symbol: meta.symbol,
      image: meta.image,
      initialSupply,
    },
    supply: { current, burnedToDead, trueBurned, totalBurned, alive, burnPct },
    burnAddresses: [...BURN_ADDRESSES],
    deadHeldTokenIds: held.deadHeldIds,
    burntTokenIds,
    uniqueBurners,
    topBurners,
    recentBurns,
    updatedAt: Date.now(),
    diagnostics: {
      hasKey: !!process.env.ALCHEMY_API_KEY,
      nftNetwork: ALCHEMY_NETWORK,
      rpcNetwork: ALCHEMY_NETWORK,
      supplyKnown,
      errors,
    },
  };

  // Only cache a fully-healthy result. A transient failure (rate limit, cold
  // indexer) shouldn't be pinned for 60s — let the next request retry.
  if (errors.length === 0) cache = { at: Date.now(), value };
  return value;
}

/** The set of burn-sink-held ids, for annotating a token grid. */
export async function getDeadHeldSet(): Promise<Set<string>> {
  const stats = await getBurntStats();
  return new Set(stats.deadHeldTokenIds);
}
