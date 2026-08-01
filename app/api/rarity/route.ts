import { NextResponse } from "next/server";
import { z } from "zod";
import { addressSchema } from "@/lib/validation/offers";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getCollectionRarity } from "@/lib/rarity/summary";

export const dynamic = "force-dynamic";

const querySchema = z.object({ contract: addressSchema });

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "rarity"), 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ contract: searchParams.get("contract") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid contract address (0x…)" },
      { status: 400 },
    );
  }

  try {
    const rarity = await getCollectionRarity(parsed.data.contract);
    return NextResponse.json(rarity);
  } catch (err) {
    console.error("GET /api/rarity failed:", err);
    return NextResponse.json(
      { error: "Failed to load rarity for this collection" },
      { status: 502 },
    );
  }
}
