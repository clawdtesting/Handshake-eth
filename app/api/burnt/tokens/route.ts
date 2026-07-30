import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { BURNT_COLLECTION_ADDRESS } from "@/lib/burnt/config";
import { getBurntStats } from "@/lib/burnt/stats";
import { nftBase } from "@/lib/burnt/alchemy";
import { attributesOf, getBurntTraitMap } from "@/lib/burnt/traits";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;
// When filtering by trait, matches are sparse, so scan a wider contract page
// and walk several pages until we've gathered a screenful.
const SCAN_LIMIT = 100;
const MAX_SCAN_PAGES = 8;

type TraitFilters = Map<string, Set<string>>;

/** Selected traits as `t=<type>~<value>` params → type → allowed values. */
function parseTraitFilters(params: URLSearchParams): TraitFilters {
  const map: TraitFilters = new Map();
  for (const raw of params.getAll("t")) {
    const sep = raw.indexOf("~");
    if (sep < 0) continue;
    const type = raw.slice(0, sep);
    const value = raw.slice(sep + 1);
    if (!type || !value) continue;
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(value);
  }
  return map;
}

/** OR within a trait type, AND across types (OpenSea semantics). */
function matchesTraits(
  attrs: { traitType: string; value: string }[],
  filters: TraitFilters,
): boolean {
  for (const [type, values] of filters) {
    if (!attrs.some((a) => a.traitType === type && values.has(a.value))) {
      return false;
    }
  }
  return true;
}

interface BurntToken {
  tokenId: string;
  name: string | null;
  image: string | null;
  status: "alive" | "burned";
}

function imageOf(raw: any): string | null {
  return (
    raw?.image?.cachedUrl ??
    raw?.image?.thumbnailUrl ??
    raw?.image?.originalUrl ??
    raw?.image?.pngUrl ??
    null
  );
}

function nameOf(raw: any, tokenId: string): string {
  const name = raw?.name ?? raw?.raw?.metadata?.name;
  return typeof name === "string" && name.trim() ? name.trim() : `#${tokenId}`;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`Alchemy request failed: ${res.status}`);
  return res.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`Alchemy request failed: ${res.status}`);
  return res.json();
}

/**
 * "burned" view: the tokens are known by id (parked in a sink), so fetch their
 * metadata directly and page over the id list with a numeric offset cursor.
 */
async function burnedPage(
  ids: string[],
  pageKey: string | null,
): Promise<{ tokens: BurntToken[]; pageKey: string | null }> {
  const offset = Number(pageKey) || 0;
  const slice = ids.slice(offset, offset + PAGE_SIZE);
  if (slice.length === 0) return { tokens: [], pageKey: null };

  const data = await postJson(`${nftBase()}/getNFTMetadataBatch`, {
    tokens: slice.map((tokenId) => ({
      contractAddress: BURNT_COLLECTION_ADDRESS,
      tokenId,
    })),
    refreshCache: false,
  });

  const byId = new Map<string, any>();
  for (const raw of data?.nfts ?? []) {
    byId.set(String(raw?.tokenId ?? ""), raw);
  }

  const tokens: BurntToken[] = slice.map((tokenId) => {
    const raw = byId.get(tokenId);
    return {
      tokenId,
      name: raw ? nameOf(raw, tokenId) : `#${tokenId}`,
      image: raw ? imageOf(raw) : null,
      status: "burned",
    };
  });

  const next = offset + PAGE_SIZE;
  return { tokens, pageKey: next < ids.length ? String(next) : null };
}

function toToken(raw: any, deadSet: Set<string>): BurntToken {
  const tokenId = String(raw?.tokenId ?? "");
  return {
    tokenId,
    name: nameOf(raw, tokenId),
    image: imageOf(raw),
    status: deadSet.has(tokenId) ? "burned" : "alive",
  };
}

/**
 * "all"/"alive" view: page through the live contract supply and tag each token
 * by whether its id sits in a burn sink. When trait filters are active, matches
 * are sparse, so walk several contract pages until a screenful is gathered.
 */
async function contractPage(
  deadSet: Set<string>,
  aliveOnly: boolean,
  filters: TraitFilters,
  pageKey: string | null,
): Promise<{ tokens: BurntToken[]; pageKey: string | null }> {
  const hasFilters = filters.size > 0;
  const limit = hasFilters ? SCAN_LIMIT : PAGE_SIZE;
  const maxPages = hasFilters ? MAX_SCAN_PAGES : 1;

  const matched: BurntToken[] = [];
  let cursor = pageKey;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      contractAddress: BURNT_COLLECTION_ADDRESS,
      withMetadata: "true",
      limit: String(limit),
    });
    if (cursor) params.set("startToken", cursor);

    const data = await getJson(`${nftBase()}/getNFTsForContract?${params}`);
    for (const raw of data?.nfts ?? []) {
      const token = toToken(raw, deadSet);
      if (aliveOnly && token.status !== "alive") continue;
      if (hasFilters && !matchesTraits(attributesOf(raw), filters)) continue;
      matched.push(token);
    }

    cursor = data?.pageKey ?? null;
    if (!cursor || matched.length >= PAGE_SIZE) break;
  }

  return { tokens: matched, pageKey: cursor };
}

const querySchema = z.object({
  status: z.enum(["all", "alive", "burned"]).default("all"),
  pageKey: z.string().max(2048).optional(),
});

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "burnt-tokens"), 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    status: searchParams.get("status") ?? undefined,
    pageKey: searchParams.get("pageKey") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  try {
    const { status, pageKey } = parsed.data;
    const filters = parseTraitFilters(searchParams);
    const stats = await getBurntStats();
    const deadSet = new Set(stats.deadHeldTokenIds);

    let result: { tokens: BurntToken[]; pageKey: string | null };
    if (status === "burned") {
      // Authoritative burnt set (incl. zero-address burns). When traits are
      // selected, narrow the id list up front so pagination stays exact.
      let ids = stats.burntTokenIds;
      if (filters.size > 0) {
        const traitMap = await getBurntTraitMap();
        ids = ids.filter((id) => matchesTraits(traitMap.get(id) ?? [], filters));
      }
      result = await burnedPage(ids, pageKey ?? null);
    } else {
      result = await contractPage(
        deadSet,
        status === "alive",
        filters,
        pageKey ?? null,
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/burnt/tokens failed:", err);
    return NextResponse.json(
      { error: "Failed to load tokens" },
      { status: 502 },
    );
  }
}
