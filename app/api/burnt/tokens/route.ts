import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { BURNT_COLLECTION_ADDRESS } from "@/lib/burnt/config";
import { getBurntStats } from "@/lib/burnt/stats";

export const dynamic = "force-dynamic";

const ALCHEMY_NETWORK = process.env.ALCHEMY_NETWORK ?? "ethereum-mainnet";
const PAGE_SIZE = 48;

function nftBase(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set");
  return `https://${ALCHEMY_NETWORK}.g.alchemy.com/nft/v3/${key}`;
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

/**
 * "all"/"alive" view: page through the live contract supply and tag each token
 * by whether its id sits in a burn sink.
 */
async function contractPage(
  deadSet: Set<string>,
  aliveOnly: boolean,
  pageKey: string | null,
): Promise<{ tokens: BurntToken[]; pageKey: string | null }> {
  const params = new URLSearchParams({
    contractAddress: BURNT_COLLECTION_ADDRESS,
    withMetadata: "true",
    limit: String(PAGE_SIZE),
  });
  if (pageKey) params.set("startToken", pageKey);

  const data = await getJson(`${nftBase()}/getNFTsForContract?${params}`);

  let tokens: BurntToken[] = (data?.nfts ?? []).map((raw: any) => {
    const tokenId = String(raw?.tokenId ?? "");
    return {
      tokenId,
      name: nameOf(raw, tokenId),
      image: imageOf(raw),
      status: deadSet.has(tokenId) ? "burned" : "alive",
    } as BurntToken;
  });

  if (aliveOnly) tokens = tokens.filter((t) => t.status === "alive");

  return { tokens, pageKey: data?.pageKey ?? null };
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
    const stats = await getBurntStats();
    const deadSet = new Set(stats.deadHeldTokenIds);

    const result =
      status === "burned"
        ? await burnedPage(stats.deadHeldTokenIds, pageKey ?? null)
        : await contractPage(deadSet, status === "alive", pageKey ?? null);

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/burnt/tokens failed:", err);
    return NextResponse.json(
      { error: "Failed to load tokens" },
      { status: 502 },
    );
  }
}
