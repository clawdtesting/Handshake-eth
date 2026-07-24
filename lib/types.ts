export type OfferStatus = "open" | "completed" | "cancelled" | "expired";
export type OfferSide = "maker" | "taker";

export type CollectionSearchResult = {
  name: string;
  slug: string;
  contractAddress?: string | null;
  imageUrl?: string | null;
  chain?: string | null;
};

export interface NFTAsset {
  contractAddress: string;
  tokenId: string;
  tokenStandard: "ERC721";
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  metadata?: Record<string, unknown> | null;
  rarityRank?: number | null;
}

export interface TradeOfferNFT extends NFTAsset {
  id: string;
  tradeOfferId: string;
  side: OfferSide;
  quantity: number;
}

export interface TradeOffer {
  id: string;
  chainId: number;
  makerAddress: string;
  takerAddress: string | null;
  status: OfferStatus;
  makerEthAmount: string; // wei, as string
  takerEthAmount: string; // wei, as string
  feeBps: number; // protocol fee (bps) baked into the signed order
  flatFee: string; // flat swap fee (wei, as string) baked into the order
  nonce: string;
  expiry: number; // unix seconds
  signature: string;
  orderHash: string;
  isPrivate: boolean;
  requiredMaxRarityRank?: number | null;
  /** Set when this offer is the final signed order of a Deal Room. */
  dealRoomId?: string | null;
  completedTxHash: string | null;
  cancelledTxHash: string | null;
  createdAt: string;
  updatedAt: string;
  nfts: TradeOfferNFT[];
}

export interface WalletReputation {
  walletAddress: string;
  completedTradesCount: number;
  cancelledTradesCount: number;
  lastTradeAt: string | null;
}

export interface MarketStats {
  totalTrades: number;
  openOffers: number;
  totalVolumeWei: string;
}

// ---------------------------------------------------------------------
// Deal Rooms (Live Haggle)
// ---------------------------------------------------------------------

export type DealRoomStatus =
  | "open"
  | "agreed"
  | "signed"
  | "settled"
  | "declined"
  | "cancelled"
  | "expired"
  | "superseded";

export type DeclineReason = "price" | "items" | "not_trading" | "other";

/** One NFT inside a draft revision. Display fields are cache-only. */
export interface RevisionNFT {
  contractAddress: string;
  tokenId: string; // uint256 as decimal string
  /** Implicit from which array holds it; present on DB reads. */
  side?: OfferSide;
  collectionName?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  rarityRank?: number | null;
}

/**
 * A non-executable draft of trade terms. Mirrors TradeOrder minus
 * nonce/signature — those exist only on the final signed order.
 */
export interface DealRoomDraft {
  makerAddress: string;
  takerAddress: string;
  makerNFTs: RevisionNFT[];
  takerNFTs: RevisionNFT[];
  makerEthAmount: string; // wei, as string
  takerEthAmount: string; // wei, as string
  feeBps: number;
  flatFee: string; // wei, as string
  offerExpiry: number; // unix seconds — expiry of the eventual signed order
}

export interface DealRoomRevision extends DealRoomDraft {
  id: string;
  roomId: string;
  revisionNumber: number;
  proposedBy: string;
  termsHash: string;
  note: string | null;
  createdAt: string;
  /** Wallets that accepted this exact revision. */
  acceptedBy: string[];
}

export interface DealRoomEvent {
  id: number;
  roomId: string;
  revisionId: string | null;
  actor: string | null;
  eventType: string;
  body: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DealRoom {
  id: string;
  chainId: number;
  participantA: string;
  participantB: string;
  initiatedBy: string;
  sourceOfferId: string | null;
  sourceWantedPostId: string | null;
  finalOfferId: string | null;
  currentRevisionId: string | null;
  status: DealRoomStatus;
  version: number;
  declinedBy: string | null;
  declineReason: DeclineReason | null;
  signedAt: string | null;
  settledAt: string | null;
  expiresAt: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Room detail as served to a participant (includes the realtime capability). */
export interface DealRoomDetail extends DealRoom {
  realtimeToken: string;
  currentRevision: DealRoomRevision | null;
  revisions: DealRoomRevision[];
  events: DealRoomEvent[];
}

export interface RoomNotification {
  id: string;
  recipientWallet: string;
  notificationType: string;
  roomId: string | null;
  offerId: string | null;
  actorWallet: string | null;
  title: string;
  body: string;
  actionPath: string;
  readAt: string | null;
  createdAt: string;
}
