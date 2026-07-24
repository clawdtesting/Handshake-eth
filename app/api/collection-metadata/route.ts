import { NextResponse } from "next/server";
import { z } from "zod";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import { getCollectionMetadata } from "@/lib/nft/collection-metadata";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.coerce.number().int().positive().optional(),
});

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "collection-metadata"), 60, 60_000);
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ address: searchParams.get("address"), chainId: searchParams.get("chainId") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });

  const metadata = await getCollectionMetadata(parsed.data.address, parsed.data.chainId ?? ETH_MAINNET_CHAIN_ID);
  return NextResponse.json({ metadata });
}
