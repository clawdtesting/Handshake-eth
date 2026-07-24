import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeEventLog } from "viem";
import { getServiceClient } from "@/lib/supabase/server";
import { bumpReputation, getOfferById, recordEvent } from "@/lib/db/offers";
import { completeOfferSchema } from "@/lib/validation/offers";
import { publicClient } from "@/lib/chains/client";
import { settlementAbi } from "@/lib/contracts/settlement";
import { SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { syncDealRoomsOnOfferChange } from "@/lib/deal-rooms/sync";

export const dynamic = "force-dynamic";

/**
 * Mark an offer completed. We verify the settlement transaction receipt
 * on-chain: it must be successful and emit TradeExecuted with this
 * offer's order hash from our settlement contract.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await rateLimit(clientKey(req, "complete-offer"), 20, 60_000);
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
  const parsed = completeOfferSchema.safeParse(body);
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

    const receipt = await publicClient.getTransactionReceipt({
      hash: parsed.data.txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction failed" }, { status: 409 });
    }

    let executedTaker: string | null = null;
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
          decoded.eventName === "TradeExecuted" &&
          (decoded.args as any).orderHash?.toLowerCase() ===
            offer.orderHash.toLowerCase()
        ) {
          executedTaker = ((decoded.args as any).taker as string).toLowerCase();
          break;
        }
      } catch {
        // not a settlement event we recognise
      }
    }

    if (!executedTaker) {
      return NextResponse.json(
        { error: "Transaction does not settle this offer" },
        { status: 409 }
      );
    }

    // The on-chain event is authoritative; reject mismatched client claims
    // for auditability/consistency.
    if (parsed.data.takerAddress.toLowerCase() !== executedTaker) {
      return NextResponse.json(
        { error: "Submitted taker does not match the settlement event" },
        { status: 409 }
      );
    }

    const db = getServiceClient();
    const { error } = await db
      .from("trade_offers")
      .update({
        status: "completed",
        taker_address: executedTaker,
        completed_tx_hash: parsed.data.txHash,
      })
      .eq("id", id)
      .eq("status", "open");
    if (error) throw error;

    await recordEvent(id, "completed", executedTaker, parsed.data.txHash);
    await bumpReputation(offer.makerAddress, "completed_trades_count");
    await bumpReputation(executedTaker, "completed_trades_count");

    await syncDealRoomsOnOfferChange(id, "completed", parsed.data.txHash);

    return NextResponse.json({ ok: true, taker: executedTaker });
  } catch (err) {
    console.error("POST /api/offers/[id]/complete failed:", err);
    return NextResponse.json({ error: "Failed to complete offer" }, { status: 500 });
  }
}
