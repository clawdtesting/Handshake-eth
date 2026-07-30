import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getBurntTraits } from "@/lib/burnt/traits";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "burnt-traits"), 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const traits = await getBurntTraits();
    return NextResponse.json(traits);
  } catch (err) {
    console.error("GET /api/burnt/traits failed:", err);
    return NextResponse.json(
      { error: "Failed to load traits" },
      { status: 502 },
    );
  }
}
