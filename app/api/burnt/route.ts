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
    // Health booleans are always public (harmless, and let the UI explain a
    // "syncing" state); raw upstream error strings only with ?debug=1.
    const debug = new URL(req.url).searchParams.get("debug") === "1";
    if (!debug) {
      stats.diagnostics = { ...stats.diagnostics, errors: [] };
    }
    return NextResponse.json(stats);
  } catch (err) {
    console.error("GET /api/burnt failed:", err);
    return NextResponse.json(
      { error: "Failed to load burn stats" },
      { status: 502 },
    );
  }
}
