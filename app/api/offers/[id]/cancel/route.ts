import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeEventLog } from "viem";
import { getServiceClient } from "@/lib/supabase/server";
import { bumpReputation, getOfferById, recordEvent } from "@/lib/db/offers";
import { cancelOfferSchema } from "@/lib/validation/offers";
import { publicClient } from "@/lib/chains/client";
import { settlementAbi } from "@/lib/contracts/settlement";
import { SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { syncDealRoomsOnOfferChange } from "@/lib/deal-rooms/sync";

export const dynamic = "force-dynamic";

/**
 * Mark an offer cancelled. Cancellation is an on-chain action (cancelNonce). We
 * verify the submitted tx actually emitted TradeCancelled for this offer's
 * maker+nonce — not merely that the nonce is consumed. `nonceUsed` is true after
 * BOTH a cancel and a fill, so trusting it would let anyone re-label a freshly
 * settled trade as "cancelled" (and skew reputation) in the window before the
 * complete call lands. Verifying the event closes that race and keeps the
 * endpoint unable to hide or mislabel other people's offers.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await rateLimit(clientKey(req, "cancel-offer"), 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid offer id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = cancelOfferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const offer = await getOfferById(id);
    if (!offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    if (offer.status !== "open") {
      return NextResponse.json(
        { error: `Offer is already ${offer.status}` },
        { status: 409 }
      );
    }
    if (
      parsed.data.walletAddress.toLowerCase() !== offer.makerAddress.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Only the maker can cancel" },
        { status: 403 }
      );
    }

    // Trustless check: the submitted tx must have succeeded and emitted
    // TradeCancelled(maker, nonce) from our settlement contract for THIS offer.
    // This distinguishes a real cancellation from a fill (both consume the
    // nonce), so a settled trade can't be mislabeled cancelled.
    const receipt = await publicClient.getTransactionReceipt({
      hash: parsed.data.txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction failed" }, { status: 409 });
    }

    let cancelled = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== SETTLEMENT_CONTRACT_ADDRESS.toLowerCase()) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: settlementAbi,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "TradeCancelled" &&
          (decoded.args as any).maker?.toLowerCase() ===
            offer.makerAddress.toLowerCase() &&
          (decoded.args as any).nonce?.toString() === String(offer.nonce)
        ) {
          cancelled = true;
          break;
        }
      } catch {
        // not a settlement event we recognise
      }
    }
    if (!cancelled) {
      return NextResponse.json(
        { error: "Transaction does not cancel this offer" },
        { status: 409 }
      );
    }

    const db = getServiceClient();
    const { error } = await db
      .from("trade_offers")
      .update({
        status: "cancelled",
        cancelled_tx_hash: parsed.data.txHash,
      })
      .eq("id", id)
      .eq("status", "open");
    if (error) throw error;

    await recordEvent(id, "cancelled", offer.makerAddress, parsed.data.txHash);
    await bumpReputation(offer.makerAddress, "cancelled_trades_count");

    await syncDealRoomsOnOfferChange(id, "cancelled", parsed.data.txHash);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/offers/[id]/cancel failed:", err);
    return NextResponse.json({ error: "Failed to cancel offer" }, { status: 500 });
  }
}
