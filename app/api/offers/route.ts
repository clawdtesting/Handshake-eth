import { NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import { getServiceClient } from "@/lib/supabase/server";
import { listOffers, mapOffer, recordEvent } from "@/lib/db/offers";
import {
  createOfferSchema,
  listOffersQuerySchema,
} from "@/lib/validation/offers";
import {
  hashOrder,
  verifyOrderSignatureOnchain,
  ZERO_ADDRESS,
  type TradeOrder,
} from "@/lib/orders/eip712";
import { publicClient } from "@/lib/chains/client";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "list-offers"), 12, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const { searchParams } = new URL(req.url);
  const parsed = listOffersQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    const offers = await listOffers(parsed.data);
    return NextResponse.json({ offers });
  } catch (err) {
    console.error("GET /api/offers failed:", err);
    return NextResponse.json({ error: "Failed to list offers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { allowed } = await rateLimit(clientKey(req, "create-offer"), 4, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createOfferSchema.safeParse(body);
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

  // Reconstruct the order and verify the maker's EIP-712 signature.
  const order: TradeOrder = {
    maker: input.makerAddress.toLowerCase() as Address,
    taker: (input.takerAddress?.toLowerCase() ?? ZERO_ADDRESS) as Address,
    makerNFTs: input.makerNFTs.map((n) => ({
      standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress.toLowerCase() as Address,
      tokenId: BigInt(n.tokenId),
    })),
    takerNFTs: input.takerNFTs.map((n) => ({
      standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress.toLowerCase() as Address,
      tokenId: BigInt(n.tokenId),
    })),
    makerEthAmount: BigInt(input.makerEthAmount),
    takerEthAmount: BigInt(input.takerEthAmount),
    feeBps: BigInt(input.feeBps),
    flatFee: BigInt(input.flatFee),
    nonce: BigInt(input.nonce),
    expiry: BigInt(input.expiry),
  };

  // Accepts EOA (ECDSA) and smart-contract-wallet (EIP-1271 / ERC-6492)
  // signatures, matching the settlement contract's SignatureChecker so Safe /
  // account-abstraction makers can also create offers.
  const validSig = await verifyOrderSignatureOnchain(
    publicClient,
    order,
    input.signature as Hex
  );
  if (!validSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const orderHash = hashOrder(order);

  try {
    const db = getServiceClient();
    const { data: offer, error } = await db
      .from("trade_offers")
      .insert({
        chain_id: input.chainId,
        maker_address: order.maker,
        taker_address: input.takerAddress?.toLowerCase() ?? null,
        status: "open",
        maker_mon_amount: input.makerEthAmount,
        taker_mon_amount: input.takerEthAmount,
        fee_bps: input.feeBps,
        flat_fee: input.flatFee,
        nonce: input.nonce,
        expiry: input.expiry,
        signature: input.signature,
        order_hash: orderHash,
        is_private: input.isPrivate,
        required_max_rarity_rank: input.requiredMaxRarityRank ?? null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Offer with this nonce or order hash already exists" },
          { status: 409 }
        );
      }
      throw error;
    }

    const nftRows = [
      ...input.makerNFTs.map((n) => ({ ...n, side: "maker" as const })),
      ...input.takerNFTs.map((n) => ({ ...n, side: "taker" as const })),
    ].map((n) => ({
      trade_offer_id: offer.id,
      side: n.side,
      token_standard: "ERC721",
      contract_address: n.contractAddress.toLowerCase(),
      token_id: n.tokenId,
      quantity: 1,
      collection_name: n.collectionName ?? null,
      image_url: n.imageUrl ?? null,
      name: n.name ?? null,
      metadata: n.metadata ?? null,
      rarity_rank: n.rarityRank ?? null,
    }));
    if (nftRows.length > 0) {
      const { error: nftError } = await db.from("trade_offer_nfts").insert(nftRows);
      if (nftError) {
        await db.from("trade_offers").delete().eq("id", offer.id);
        throw nftError;
      }
    }

    await recordEvent(offer.id, "created", order.maker, null, { orderHash });

    return NextResponse.json(
      { offer: mapOffer({ ...offer, trade_offer_nfts: nftRows }) },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/offers failed:", err);
    return NextResponse.json({ error: "Failed to create offer" }, { status: 500 });
  }
}
