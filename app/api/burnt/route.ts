import { NextResponse } from "next/server";
import { getBurntStats } from "@/lib/burnt/stats";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "burnt"), 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const stats = await getBurntStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("GET /api/burnt failed:", err);
    return NextResponse.json(
      { error: "Failed to load burn stats" },
      { status: 502 },
    );
  }
}
