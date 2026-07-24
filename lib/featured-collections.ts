/**
 * Curated collections surfaced as quick-select buttons in the trade
 * builder. Useful while indexer coverage on Ethereum is incomplete.
 */
export interface FeaturedCollection {
  name: string;
  address: `0x${string}`;
  /** Legacy field kept for back-compat; prefer officialLogo when present. */
  image: string;
  /**
   * Curated, project-controlled official logo (local file or trusted URL).
   * Highest-priority source for the collection logo. Must be a STATIC image.
   */
  officialLogo?: string;
  officialWebsite?: string;
  openSeaSlug?: string;
  /**
   * True when the collection enforces an on-chain transfer validator
   * (ERC721-C / Creator Token Standard style). Handshake's settlement
   * contract must be allowlisted by the collection owner before any trade can
   * settle, so until that happens the collection is surfaced as "locked" (red
   * dot) and cannot be traded — it stays visible so holders can still browse
   * it. Collections without a transfer validator trade freely and are shown
   * with a green dot.
   */
  transferValidator?: boolean;
  /**
   * For transfer-validator collections only: set to `true` once the collection
   * owner has approved Handshake's settlement contract on the validator. That
   * flips the collection from locked (red) to open (green). Ignored for
   * collections without a transfer validator (they are always open). Kept as an
   * explicit, project-controlled flag because the settlement contract's own
   * `isCollectionAllowed` allowlist does NOT reliably reflect the owner's
   * validator approval.
   */
  settlementApproved?: boolean;
}

/**
 * Trade-readiness of a collection, from two independent on-chain approvals:
 *   1. Transfer-validator approval — the collection owner has authorised
 *      Handshake's settlement contract on the transfer validator
 *      (/api/collections/settlement-approved). Collections without a transfer
 *      validator have nothing to approve, so this condition is always met.
 *   2. Handshake allowlist — the settlement contract's own `isCollectionAllowed`
 *      (/api/collections/allowed).
 *
 * Both must hold before a trade can settle:
 *   - "open"    (green)  — both approvals in place → tradeable.
 *   - "pending" (yellow) — exactly one approval is still missing.
 *   - "locked"  (red)    — neither approval is in place.
 */
export type CollectionTradeStatus = "open" | "pending" | "locked";

export interface CollectionTradeSignals {
  /** Live transfer-validator read (isTransferAllowed). */
  validatorApproved?: boolean;
  /** Live Handshake settlement read (isCollectionAllowed). */
  handshakeAllowed?: boolean;
}

export function collectionTradeStatus(
  collection: Pick<FeaturedCollection, "transferValidator" | "settlementApproved">,
  signals: CollectionTradeSignals = {},
): CollectionTradeStatus {
  // A collection with no transfer validator has nothing to approve there;
  // `settlementApproved` is a manual override for when the validator read is
  // unavailable.
  const validatorOk =
    collection.transferValidator !== true ||
    collection.settlementApproved === true ||
    signals.validatorApproved === true;
  const handshakeOk = signals.handshakeAllowed === true;

  const met = (validatorOk ? 1 : 0) + (handshakeOk ? 1 : 0);
  if (met === 2) return "open";
  if (met === 1) return "pending";
  return "locked";
}

export const FEATURED_COLLECTIONS: FeaturedCollection[] = [
  // Single launch collection on Ethereum mainnet. All prior Monad-era
  // collections were removed post-migration. The logo/artwork is pulled from
  // T00ns' own on-chain/indexer metadata (SafeCollectionImage); "/Logomark.svg"
  // is only a fallback for when metadata has no image. No local logo file is
  // pinned so the collection's real imagery is always used.
  //
  // On-chain transfer-validator (ERC721-C) status for this address could not be
  // verified from this environment, so it is left ungated (transferValidator
  // omitted) and NOT marked settlementApproved. Confirm the validator status on
  // mainnet before launch and set these fields from verified facts.
  {
    name: "T00ns",
    address: "0x902d94ba5bfc0cb408d1a6ca4b8f255d845e50e9",
    image: "/Logomark.svg",
  },
];

const byAddress = new Map(
  FEATURED_COLLECTIONS.map((collection) => [
    collection.address.toLowerCase(),
    collection,
  ]),
);

/** Case-insensitive lookup of a curated featured collection by address. */
export function getFeaturedCollection(
  address?: string | null,
): FeaturedCollection | null {
  if (!address) return null;
  return byAddress.get(address.toLowerCase()) ?? null;
}
