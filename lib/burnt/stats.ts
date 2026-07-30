import {
  BURN_ADDRESSES,
  BURNT_COLLECTION_ADDRESS,
  BURNT_INITIAL_SUPPLY,
  isBurnAddress,
} from "@/lib/burnt/config";

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

const ALCHEMY_NETWORK = process.env.ALCHEMY_NETWORK ?? "ethereum-mainnet";

// NFT API and the JSON-RPC core API use different host slugs for the same
// chain (ethereum-mainnet vs eth-mainnet). Normalise for the RPC host.
const RPC_NETWORK = ALCHEMY_NETWORK.replace(/^ethereum-/, "eth-");

function nftBase(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set");
  return `https://${ALCHEMY_NETWORK}.g.alchemy.com/nft/v3/${key}`;
}

function rpcUrl(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set");
  return `https://${RPC_NETWORK}.g.alchemy.com/v2/${key}`;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    throw new Error(`Alchemy request failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Alchemy RPC failed: ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "Alchemy RPC error");
  return body.result;
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
  /** Wallets ranked by how many tokens they've sent to a sink. */
  topBurners: { address: string; count: number }[];
  updatedAt: number;
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
  try {
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
  } catch {
    return { name: null, symbol: null, image: null, totalSupply: null };
  }
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

/** Aggregate senders of tokens into every burn sink into a leaderboard. */
async function getTopBurners(): Promise<{ address: string; count: number }[]> {
  const counts = new Map<string, number>();

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
          maxCount: "0x3e8",
          order: "asc",
          ...(pageKey ? { pageKey } : {}),
        },
      ]);

      for (const t of result?.transfers ?? []) {
        const from = (t?.from ?? "").toLowerCase();
        // A mint is a transfer FROM zero; that isn't someone burning.
        if (!from || isBurnAddress(from)) continue;
        counts.set(from, (counts.get(from) ?? 0) + 1);
      }

      pageKey = result?.pageKey ?? undefined;
      if (!pageKey) break;
    }
  }

  return Array.from(counts.entries())
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
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

  const [meta, held, topBurners] = await Promise.all([
    getContractMeta(),
    getDeadHeldTokenIds(),
    getTopBurners().catch(() => [] as { address: string; count: number }[]),
  ]);

  const initialSupply = BURNT_INITIAL_SUPPLY;
  // Prefer the live totalSupply when the contract reports it; otherwise fall
  // back to the count enumerated from owners.
  const current = meta.totalSupply ?? held.existingCount;
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
    topBurners,
    updatedAt: Date.now(),
  };

  cache = { at: Date.now(), value };
  return value;
}

/** The set of burn-sink-held ids, for annotating a token grid. */
export async function getDeadHeldSet(): Promise<Set<string>> {
  const stats = await getBurntStats();
  return new Set(stats.deadHeldTokenIds);
}
