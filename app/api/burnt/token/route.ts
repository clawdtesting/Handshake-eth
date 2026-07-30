import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { BURNT_COLLECTION_ADDRESS, isBurnAddress } from "@/lib/burnt/config";
import { getBurntStats } from "@/lib/burnt/stats";
import { nftBase } from "@/lib/burnt/alchemy";
import { attributesOf, fetchMetadataBatch } from "@/lib/burnt/traits";

export const dynamic = "force-dynamic";

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

/** Current holder of a single token, lowercased, or null if none/unknown. */
async function ownerOf(tokenId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${nftBase()}/getOwnersForToken?contractAddress=${BURNT_COLLECTION_ADDRESS}&tokenId=${tokenId}`,
      { headers: { accept: "application/json" }, next: { revalidate: 30 } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const owner = data?.owners?.[0];
    return typeof owner === "string" ? owner.toLowerCase() : null;
  } catch {
    return null;
  }
}

const querySchema = z.object({
  // Accept "#3458" or "3458"; digits only, bounded length.
  id: z
    .string()
    .transform((s) => s.trim().replace(/^#/, ""))
    .pipe(z.string().regex(/^\d{1,10}$/)),
});

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "burnt-token"), 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ id: searchParams.get("id") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a numeric token id, e.g. 3458" },
      { status: 400 },
    );
  }
  const tokenId = parsed.data.id;

  try {
    const [stats, nfts, owner] = await Promise.all([
      getBurntStats(),
      fetchMetadataBatch([tokenId]),
      ownerOf(tokenId),
    ]);

    const raw = nfts[0];
    const traits = attributesOf(raw);
    const name = raw ? nameOf(raw, tokenId) : `#${tokenId}`;
    const image = raw ? imageOf(raw) : null;
    const inBurnt = new Set(stats.burntTokenIds).has(tokenId);
    const ownerIsBurn = isBurnAddress(owner);
    const hasMeta = traits.length > 0 || !!image || (raw?.name ?? null) != null;

    // Does the token exist at all (minted at some point)?
    const exists = inBurnt || !!owner || hasMeta;
    if (!exists) {
      return NextResponse.json({ tokenId, exists: false });
    }

    // burnt: in the transfer-derived burnt set, held by a sink, or it existed
    // but has no current holder (destroyed via _burn to the zero address).
    const status: "alive" | "burnt" =
      inBurnt || ownerIsBurn || (hasMeta && !owner) ? "burnt" : "alive";

    return NextResponse.json({
      tokenId,
      exists: true,
      status,
      name,
      image,
      owner: ownerIsBurn ? null : owner,
      traits,
    });
  } catch (err) {
    console.error("GET /api/burnt/token failed:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }
}
