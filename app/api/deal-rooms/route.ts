import { NextResponse } from "next/server";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getOfferById } from "@/lib/db/offers";
import {
  createNotification,
  createRoom,
  findActiveRoomForSource,
  listRoomsForWallet,
} from "@/lib/db/deal-rooms";
import { createRoomSchema } from "@/lib/validation/deal-rooms";
import { termsHash } from "@/lib/deal-rooms/canonicalize";
import { broadcastRoomUpdate } from "@/lib/deal-rooms/broadcast";
import { requireSession, shortAddr, unauthorized } from "@/lib/deal-rooms/api";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/deal-rooms — rooms the session wallet participates in.
 */
export async function GET(req: Request) {
  const wallet = requireSession(req);
  if (!wallet) return unauthorized();

  const { allowed } = await rateLimit(
    clientKey(req, `list-rooms:${wallet}`),
    30,
    60_000
  );
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const rooms = await listRoomsForWallet(wallet);
    return NextResponse.json({ rooms });
  } catch (err) {
    console.error("GET /api/deal-rooms failed:", err);
    return NextResponse.json({ error: "Failed to list rooms" }, { status: 500 });
  }
}

/**
 * POST /api/deal-rooms — open a room with an initial draft.
 *
 * Sources:
 *  - sourceOfferId: "Suggest changes" on an existing offer. The caller must be
 *    the offer's counterparty (or its maker); if an active room for this
 *    (pair, offer) already exists the caller is redirected to it instead of
 *    forking a duplicate negotiation.
 *  - sourceWantedPostId: "Build a matching deal" from the wanted board.
 *  - neither: a direct invite to any wallet.
 */
export async function POST(req: Request) {
  const wallet = requireSession(req);
  if (!wallet) return unauthorized();

  const { allowed } = await rateLimit(
    clientKey(req, `create-room:${wallet}`),
    6,
    60_000
  );
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (input.chainId !== ETH_MAINNET_CHAIN_ID) {
    return NextResponse.json(
      { error: `Wrong chain. Expected ${ETH_MAINNET_CHAIN_ID}` },
      { status: 400 }
    );
  }

  const counterparty = input.counterparty.toLowerCase();
  if (counterparty === wallet) {
    return NextResponse.json(
      { error: "You can't open a room with yourself" },
      { status: 400 }
    );
  }

  // The session wallet must be on one side of the draft, the counterparty on
  // the other — a room's draft can only ever bind its two participants.
  const draftParties = new Set([
    input.draft.makerAddress.toLowerCase(),
    input.draft.takerAddress.toLowerCase(),
  ]);
  if (!draftParties.has(wallet) || !draftParties.has(counterparty)) {
    return NextResponse.json(
      { error: "Draft maker/taker must be the two room participants" },
      { status: 400 }
    );
  }

  try {
    // Validate the source linkage.
    if (input.sourceOfferId) {
      const offer = await getOfferById(input.sourceOfferId);
      if (!offer) {
        return NextResponse.json(
          { error: "Source offer not found" },
          { status: 404 }
        );
      }
      const maker = offer.makerAddress.toLowerCase();
      const taker = offer.takerAddress?.toLowerCase() ?? null;
      const parties = new Set([wallet, counterparty]);
      if (!parties.has(maker) || (taker && !parties.has(taker))) {
        return NextResponse.json(
          { error: "Room participants must match the source offer's parties" },
          { status: 400 }
        );
      }
      const existing = await findActiveRoomForSource(
        input.chainId,
        wallet,
        counterparty,
        input.sourceOfferId
      );
      if (existing) {
        return NextResponse.json({ room: existing, existing: true });
      }
    }

    if (input.sourceWantedPostId) {
      const db = getServiceClient();
      const { data: post } = await db
        .from("wanted_posts")
        .select("id, wallet_address")
        .eq("id", input.sourceWantedPostId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json(
          { error: "Wanted post not found" },
          { status: 404 }
        );
      }
      if (
        post.wallet_address !== wallet &&
        post.wallet_address !== counterparty
      ) {
        return NextResponse.json(
          { error: "Wanted post doesn't belong to either participant" },
          { status: 400 }
        );
      }
    }

    const hash = termsHash(input.draft);
    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);

    const { room, revision } = await createRoom({
      chainId: input.chainId,
      initiatedBy: wallet,
      counterparty,
      sourceOfferId: input.sourceOfferId ?? null,
      sourceWantedPostId: input.sourceWantedPostId ?? null,
      expiresAt,
      draft: input.draft,
      termsHash: hash,
      note: input.note ?? null,
    });

    await createNotification({
      recipient: counterparty,
      type: "room_invited",
      roomId: room.id,
      actor: wallet,
      title: "New Deal Room",
      body: `${shortAddr(wallet)} wants to negotiate a trade with you.`,
      actionPath: `/rooms/${room.id}`,
      dedupeKey: `room_invited:${room.id}:${counterparty}`,
    });
    await broadcastRoomUpdate(room.id, room.realtimeToken, "room_updated");

    return NextResponse.json({ room, revision }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json(
        { error: "A room for this offer already exists" },
        { status: 409 }
      );
    }
    console.error("POST /api/deal-rooms failed:", err);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}
