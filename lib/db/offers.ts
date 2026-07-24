import { getServiceClient } from "@/lib/supabase/server";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import type { TradeOffer, TradeOfferNFT, WalletReputation } from "@/lib/types";

function mapNft(row: any): TradeOfferNFT {
  return {
    id: row.id,
    tradeOfferId: row.trade_offer_id,
    side: row.side,
    tokenStandard: row.token_standard,
    contractAddress: row.contract_address,
    tokenId: row.token_id,
    quantity: row.quantity,
    collectionName: row.collection_name,
    imageUrl: row.image_url,
    name: row.name,
    metadata: row.metadata,
    rarityRank: row.rarity_rank ?? null,
  };
}

export function mapOffer(row: any): TradeOffer {
  return {
    id: row.id,
    chainId: row.chain_id,
    makerAddress: row.maker_address,
    takerAddress: row.taker_address,
    status: row.status,
    makerEthAmount: row.maker_mon_amount,
    takerEthAmount: row.taker_mon_amount,
    feeBps: row.fee_bps,
    flatFee: row.flat_fee,
    nonce: row.nonce,
    expiry: row.expiry,
    signature: row.signature,
    orderHash: row.order_hash,
    isPrivate: row.is_private,
    requiredMaxRarityRank: row.required_max_rarity_rank ?? null,
    dealRoomId: row.deal_room_id ?? null,
    completedTxHash: row.completed_tx_hash,
    cancelledTxHash: row.cancelled_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nfts: (row.trade_offer_nfts ?? []).map(mapNft),
  };
}

// numeric columns must round-trip as strings: PostgREST serialises numeric
// as a JSON number, which loses precision beyond 2^53 (the nonce is a random
// 256-bit value). The ::text casts override the lossy defaults from "*".
const OFFER_SELECT =
  "*, nonce::text, maker_mon_amount::text, taker_mon_amount::text, flat_fee::text, trade_offer_nfts(*, token_id::text)";

export async function getOfferById(id: string): Promise<TradeOffer | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("trade_offers")
    .select(OFFER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapOffer(data) : null;
}

export async function listOffers(filters: {
  status?: string;
  maker?: string;
  taker?: string;
  wallet?: string;
  collection?: string;
  limit: number;
  offset: number;
}): Promise<TradeOffer[]> {
  const db = getServiceClient();
  const select = filters.collection
    ? `${OFFER_SELECT}, matching_nfts:trade_offer_nfts!inner(id)`
    : OFFER_SELECT;

  let query = db
    .from("trade_offers")
    .select(select)
    // Offers are chain-bound (EIP-712 domain); never mix networks.
    .eq("chain_id", ETH_MAINNET_CHAIN_ID)
    .order("created_at", { ascending: false })
    .range(filters.offset, filters.offset + filters.limit - 1);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.maker) query = query.eq("maker_address", filters.maker.toLowerCase());
  if (filters.taker) query = query.eq("taker_address", filters.taker.toLowerCase());

  if (filters.collection) {
    query = query.eq(
      "matching_nfts.contract_address",
      filters.collection.toLowerCase()
    );
  }

  if (filters.wallet) {
    const w = filters.wallet.toLowerCase();
    query = query.or(`maker_address.eq.${w},taker_address.eq.${w}`);
  } else if (!filters.maker && !filters.taker) {
    // Hide private offers from the public feed only; maker/taker-scoped
    // queries are how the parties themselves find targeted offers.
    query = query.eq("is_private", false);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapOffer);
}

export async function recordEvent(
  tradeOfferId: string,
  eventType: string,
  walletAddress: string | null,
  txHash: string | null,
  data: Record<string, unknown> = {}
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("trade_events").insert({
    trade_offer_id: tradeOfferId,
    event_type: eventType,
    wallet_address: walletAddress?.toLowerCase() ?? null,
    tx_hash: txHash,
    data,
  });
  if (error) throw error;
}

export async function bumpReputation(
  walletAddress: string,
  field: "completed_trades_count" | "cancelled_trades_count"
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.rpc("bump_wallet_reputation", {
    p_wallet: walletAddress.toLowerCase(),
    p_field: field,
  });
  if (error) throw error;
}

export async function getReputation(
  walletAddress: string
): Promise<WalletReputation> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("wallet_reputation")
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return {
    walletAddress: walletAddress.toLowerCase(),
    completedTradesCount: data?.completed_trades_count ?? 0,
    cancelledTradesCount: data?.cancelled_trades_count ?? 0,
    lastTradeAt: data?.last_trade_at ?? null,
  };
}
