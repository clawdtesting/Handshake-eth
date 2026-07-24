import { NextResponse } from "next/server";
import type { CollectionSearchResult } from "@/lib/types";
import { clientKey, rateLimit } from "@/lib/rate-limit";

const OPENSEA_BASE_URL =
  process.env.OPENSEA_BASE_URL ?? "https://api.opensea.io/api/v2";
const OPENSEA_CHAIN = process.env.OPENSEA_CHAIN ?? "ethereum";
const CACHE_TTL_MS = 60_000;
const cache = new Map<
  string,
  { expiresAt: number; results: CollectionSearchResult[] }
>();

type OpenSeaCollection = {
  name?: string | null;
  collection?: string | null;
  slug?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  contracts?: Array<{ address?: string | null; chain?: string | null }> | null;
  primary_asset_contracts?: Array<{
    address?: string | null;
    chain?: string | null;
  }> | null;
};

function normalizeCollection(
  raw: OpenSeaCollection,
): CollectionSearchResult | null {
  const name = raw.name?.trim();
  const slug = (raw.collection ?? raw.slug)?.trim();
  if (!name || !slug) return null;

  const contract =
    raw.contracts?.[0] ?? raw.primary_asset_contracts?.[0] ?? null;
  const address = contract?.address?.trim();

  return {
    name,
    slug,
    contractAddress: address ? address.toLowerCase() : null,
    imageUrl: raw.image_url ?? raw.imageUrl ?? null,
    chain: contract?.chain ?? OPENSEA_CHAIN,
  };
}

async function fetchOpenSea(path: string) {
  const key = process.env.OPENSEA_API_KEY;
  if (!key) throw new Error("OPENSEA_API_KEY is not set");

  const res = await fetch(`${OPENSEA_BASE_URL}${path}`, {
    headers: { accept: "application/json", "x-api-key": key },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`Collection search failed with status ${res.status}`);
  }

  return res.json();
}

function unique(results: CollectionSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.slug}:${result.contractAddress ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(request: Request) {
  const { allowed } = await rateLimit(
    clientKey(request, "collection-search"),
    12,
    60_000,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ results: cached.results });
  }

  try {
    const params = new URLSearchParams({
      chain: OPENSEA_CHAIN,
      limit: "20",
      order_by: "market_cap",
    });

    const collectionsData = await fetchOpenSea(`/collections?${params}`);
    const haystack = q.toLowerCase();
    const listedResults = (
      (collectionsData.collections ?? []) as OpenSeaCollection[]
    )
      .map(normalizeCollection)
      .filter((result): result is CollectionSearchResult => Boolean(result))
      .filter(
        (result) =>
          result.name.toLowerCase().includes(haystack) ||
          result.slug.toLowerCase().includes(haystack) ||
          result.contractAddress?.toLowerCase() === haystack,
      );

    let detailResult: CollectionSearchResult | null = null;
    if (/^[a-z0-9][a-z0-9_-]+$/i.test(q)) {
      try {
        detailResult = normalizeCollection(
          await fetchOpenSea(`/collections/${q}`),
        );
      } catch {
        // Exact slug resolution is optional; list results can still satisfy search.
      }
    }

    const results = unique(
      [detailResult, ...listedResults].filter(
        (result): result is CollectionSearchResult => Boolean(result),
      ),
    ).slice(0, 10);

    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to search collections",
      },
      { status: 502 },
    );
  }
}
