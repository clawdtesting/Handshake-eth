import { NextResponse } from "next/server";
import { z } from "zod";
import type { Address } from "viem";
import { publicClient } from "@/lib/chains/client";
import { erc721Abi } from "@/lib/contracts/settlement";
import { BURNT_COLLECTION_ADDRESS } from "@/lib/burnt/config";
import { addressSchema } from "@/lib/validation/offers";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/combat/owner?token=<id>&owner=<address>
 *
 * Provable ownership check for Combat Live: reads `ownerOf(tokenId)` on the
 * T00ns contract and reports whether it belongs to `owner`. Fail-closed — any
 * revert (e.g. a burned/nonexistent token) or RPC error resolves to not-owned.
 */
const querySchema = z.object({
  token: z.string().regex(/^\d{1,10}$/),
  owner: addressSchema,
});

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "combat-owner"), 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    token: searchParams.get("token") ?? "",
    owner: searchParams.get("owner") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  try {
    const actual = (await publicClient.readContract({
      address: BURNT_COLLECTION_ADDRESS,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [BigInt(parsed.data.token)],
    })) as Address;

    const owned = actual.toLowerCase() === parsed.data.owner.toLowerCase();
    return NextResponse.json({ owned, owner: actual.toLowerCase() });
  } catch {
    // Reverts (nonexistent/burned token) or RPC hiccups → not owned.
    return NextResponse.json({ owned: false, owner: null });
  }
}
