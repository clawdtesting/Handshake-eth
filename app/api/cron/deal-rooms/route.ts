import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { forceRoomStatus } from "@/lib/db/deal-rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/deal-rooms — periodic reconciliation (Vercel Cron).
 *
 *  1. Active rooms past their room expiry → `expired`.
 *  2. `signed` rooms whose final offer's on-chain expiry passed → back to
 *     `agreed` (the signed order is dead by expiry; the agreed draft can be
 *     re-signed with a fresh expiry).
 *
 * Guarded by CRON_SECRET (Authorization: Bearer <secret>). Only recently
 * active rows are scanned — no chain reads happen here; expiry is the one
 * transition that's provable from timestamps alone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed in production. Vercel Cron sends CRON_SECRET as a Bearer
  // token; silently accepting an unset secret would expose a service-role
  // database mutation endpoint to the public internet.
  if (!secret && process.env.NODE_ENV === "production") {
    console.error("CRON_SECRET is required for the deal-room cron route");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization");
  if (secret && header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getServiceClient();
    const nowIso = new Date().toISOString();
    const nowUnix = Math.floor(Date.now() / 1000);

    // 1. Room-level expiry.
    const { data: expiredRooms, error: expErr } = await db
      .from("deal_rooms")
      .select("id")
      .in("status", ["open", "agreed"])
      .lt("expires_at", nowIso)
      .limit(200);
    if (expErr) throw expErr;
    for (const room of expiredRooms ?? []) {
      await forceRoomStatus(room.id, "expired", {}, "room_expired");
    }

    // 2. Signed rooms whose final offer expired unfilled.
    const { data: signedRooms, error: sigErr } = await db
      .from("deal_rooms")
      .select("id, final_offer_id, trade_offers!deal_rooms_final_offer_id_fkey(expiry, status)")
      .eq("status", "signed")
      .not("final_offer_id", "is", null)
      .limit(200);
    if (sigErr) throw sigErr;

    let reopened = 0;
    for (const room of (signedRooms ?? []) as any[]) {
      const offer = room.trade_offers;
      if (!offer) continue;
      const stillOpen = offer.status === "open";
      const expired = Number(offer.expiry) < nowUnix;
      if (stillOpen && expired) {
        await forceRoomStatus(
          room.id,
          "agreed",
          { final_offer_id: null, signed_at: null },
          "system",
          "Final signed offer expired unfilled — negotiation reopened"
        );
        reopened += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      expiredRooms: expiredRooms?.length ?? 0,
      reopenedSignedRooms: reopened,
    });
  } catch (err) {
    console.error("GET /api/cron/deal-rooms failed:", err);
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}
