import { NextResponse } from "next/server";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/server";
import { getOfferById, mapOffer, recordEvent } from "@/lib/db/offers";
import {
  counterpartyOf,
  createNotification,
  getRoomDetail,
  RoomConflictError,
  setRoomStatus,
} from "@/lib/db/deal-rooms";
import { finalizeSchema } from "@/lib/validation/deal-rooms";
import { termsHash } from "@/lib/deal-rooms/canonicalize";
import { canFinalize } from "@/lib/deal-rooms/state-machine";
import { isNonceUsed } from "@/lib/deal-rooms/readiness";
import { broadcastRoomUpdate } from "@/lib/deal-rooms/broadcast";
import {
  conflict,
  loadRoomForParticipant,
  notFound,
  requireSession,
  shortAddr,
  unauthorized,
} from "@/lib/deal-rooms/api";
import {
  hashOrder,
  verifyOrderSignatureOnchain,
  type TradeOrder,
} from "@/lib/orders/eip712";
import { publicClient } from "@/lib/chains/client";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import type { DealRoomDraft, RevisionNFT } from "@/lib/types";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

/**
 * POST /api/deal-rooms/[id]/finalize
 *
 * Converts the mutually-agreed draft into the room's single executable order.
 * Hard invariants enforced here:
 *
 *  1. Room must be `agreed` (both participants accepted the current revision).
 *  2. The caller must be the draft's designated maker.
 *  3. The submitted order must match the agreed revision EXACTLY — verified
 *     by recomputing the canonical terms hash from the order and comparing it
 *     to the revision's stored hash. Any drift in any field rejects.
 *  4. If the room replaces a signed source offer, that offer's nonce must
 *     already be consumed on-chain (cancelled or filled) so two executable
 *     versions of the deal can never coexist.
 *  5. The maker's EIP-712 signature must verify (EOA + EIP-1271/6492).
 *  6. Idempotent: a second call returns the already-created offer.
 *
 * The resulting offer is always PRIVATE and targeted at the counterparty.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const wallet = requireSession(req);
  if (!wallet) return unauthorized();

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return notFound();

  const { allowed } = await rateLimit(
    clientKey(req, `room-finalize:${wallet}`),
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

  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    const room = await loadRoomForParticipant(id, wallet);
    if (!room) return notFound();

    // Idempotency: already finalized → return the existing offer.
    if (room.finalOfferId) {
      const existing = await getOfferById(room.finalOfferId);
      return NextResponse.json({
        offer: existing,
        room,
        alreadyFinalized: true,
      });
    }

    if (!canFinalize(room.status)) {
      return conflict(
        room.status === "open"
          ? "Both sides must agree to the current revision first"
          : `Room is ${room.status} — cannot finalize`
      );
    }

    const detail = await getRoomDetail(id);
    const revision = detail?.currentRevision;
    if (!revision) return conflict("Room has no current revision");

    // Defense in depth: re-verify both acceptances on the exact revision.
    const accepted = new Set(revision.acceptedBy.map((a) => a.toLowerCase()));
    if (!accepted.has(room.participantA) || !accepted.has(room.participantB)) {
      return conflict("Both sides must agree to the current revision first");
    }

    // Only the draft's designated maker signs the final order.
    if (revision.makerAddress.toLowerCase() !== wallet) {
      return NextResponse.json(
        { error: "Only the draft's maker can sign the final deal" },
        { status: 403 }
      );
    }

    // --- Invariant 3: exact-terms equality via canonical hash -----------
    const orderAsDraft: DealRoomDraft = {
      makerAddress: input.order.maker,
      takerAddress: input.order.taker,
      makerNFTs: input.order.makerNFTs.map(
        (n): RevisionNFT => ({ ...n, side: "maker" })
      ),
      takerNFTs: input.order.takerNFTs.map(
        (n): RevisionNFT => ({ ...n, side: "taker" })
      ),
      makerEthAmount: input.order.makerEthAmount,
      takerEthAmount: input.order.takerEthAmount,
      feeBps: Number(input.order.feeBps),
      flatFee: input.order.flatFee,
      offerExpiry: Number(input.order.expiry),
    };
    if (termsHash(orderAsDraft) !== revision.termsHash) {
      return conflict(
        "Order does not match the agreed terms — refresh the room and retry"
      );
    }

    // --- Invariant 4: source offer must be dead on-chain ----------------
    if (room.sourceOfferId) {
      const source = await getOfferById(room.sourceOfferId);
      if (source && source.status === "open") {
        const used = await isNonceUsed(
          source.makerAddress.toLowerCase() as Address,
          BigInt(source.nonce)
        );
        if (used !== true) {
          return conflict(
            "The original signed offer is still executable. Cancel its nonce on-chain first so only one version of this deal can settle."
          );
        }
      }
    }

    // --- Invariant 5: EIP-712 signature ---------------------------------
    const order: TradeOrder = {
      maker: input.order.maker.toLowerCase() as Address,
      taker: input.order.taker.toLowerCase() as Address,
      makerNFTs: input.order.makerNFTs.map((n) => ({
        standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress.toLowerCase() as Address,
        tokenId: BigInt(n.tokenId),
      })),
      takerNFTs: input.order.takerNFTs.map((n) => ({
        standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress.toLowerCase() as Address,
        tokenId: BigInt(n.tokenId),
      })),
      makerEthAmount: BigInt(input.order.makerEthAmount),
      takerEthAmount: BigInt(input.order.takerEthAmount),
      feeBps: BigInt(input.order.feeBps),
      flatFee: BigInt(input.order.flatFee),
      nonce: BigInt(input.order.nonce),
      expiry: BigInt(input.order.expiry),
    };
    const validSig = await verifyOrderSignatureOnchain(
      publicClient,
      order,
      input.signature as Hex
    );
    if (!validSig) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const orderHash = hashOrder(order);
    const taker = counterpartyOf(room, wallet);

    // Display metadata for the offer's NFT rows comes from the revision cache.
    const metaByKey = new Map(
      [...revision.makerNFTs, ...revision.takerNFTs].map((n) => [
        `${n.contractAddress.toLowerCase()}:${BigInt(n.tokenId)}`,
        n,
      ])
    );

    const db = getServiceClient();
    const { data: offerRow, error } = await db
      .from("trade_offers")
      .insert({
        chain_id: ETH_MAINNET_CHAIN_ID,
        maker_address: order.maker,
        taker_address: taker,
        status: "open",
        maker_mon_amount: input.order.makerEthAmount,
        taker_mon_amount: input.order.takerEthAmount,
        fee_bps: Number(input.order.feeBps),
        flat_fee: input.order.flatFee,
        nonce: input.order.nonce,
        expiry: Number(input.order.expiry),
        signature: input.signature,
        order_hash: orderHash,
        is_private: true,
        deal_room_id: room.id,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        return conflict("An offer with this nonce or order hash already exists");
      }
      throw error;
    }

    const nftRows = [
      ...input.order.makerNFTs.map((n) => ({ ...n, side: "maker" as const })),
      ...input.order.takerNFTs.map((n) => ({ ...n, side: "taker" as const })),
    ].map((n) => {
      const meta = metaByKey.get(
        `${n.contractAddress.toLowerCase()}:${BigInt(n.tokenId)}`
      );
      return {
        trade_offer_id: offerRow.id,
        side: n.side,
        token_standard: "ERC721",
        contract_address: n.contractAddress.toLowerCase(),
        token_id: n.tokenId,
        quantity: 1,
        collection_name: meta?.collectionName ?? null,
        image_url: meta?.imageUrl ?? null,
        name: meta?.name ?? null,
        metadata: null,
        rarity_rank: meta?.rarityRank ?? null,
      };
    });
    if (nftRows.length > 0) {
      const { error: nftError } = await db
        .from("trade_offer_nfts")
        .insert(nftRows);
      if (nftError) {
        await db.from("trade_offers").delete().eq("id", offerRow.id);
        throw nftError;
      }
    }

    await recordEvent(offerRow.id, "created", order.maker, null, {
      orderHash,
      dealRoomId: room.id,
    });

    const updatedRoom = await setRoomStatus({
      roomId: room.id,
      expectedVersion: input.expectedVersion,
      status: "signed",
      patch: {
        final_offer_id: offerRow.id,
        signed_at: new Date().toISOString(),
      },
      eventType: "final_offer_signed",
      actor: wallet,
      eventBody: orderHash,
    });

    await createNotification({
      recipient: taker,
      type: "final_offer_signed",
      roomId: room.id,
      offerId: offerRow.id,
      actor: wallet,
      title: "Final deal signed — your move",
      body: `${shortAddr(wallet)} signed the agreed terms. Settle to complete the handshake.`,
      actionPath: `/rooms/${room.id}`,
      dedupeKey: `final_offer_signed:${room.id}`,
    });
    await broadcastRoomUpdate(room.id, room.realtimeToken, "room_updated", {
      kind: "signed",
    });

    return NextResponse.json(
      {
        offer: mapOffer({ ...offerRow, trade_offer_nfts: nftRows }),
        room: updatedRoom,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof RoomConflictError) {
      return conflict("This room moved — refresh and retry");
    }
    console.error("POST /api/deal-rooms/[id]/finalize failed:", err);
    return NextResponse.json({ error: "Failed to finalize" }, { status: 500 });
  }
}
