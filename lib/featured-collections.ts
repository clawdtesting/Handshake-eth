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
  // ── Tradeable now (no transfer-validator gate) — green dot ──────────────
  {
    name: "Erebus",
    address: "0x2a0001f3d4c98881376f8d36b3c61f163d84a095",
    image: "/collections/Erebus.png",
    // Erebus tokens are animated .mp4s (image === animation_url on-chain), so
    // a static, project-controlled logo is pinned here and never derived from
    // token artwork.
    officialLogo: "/collections/Erebus.png",
    transferValidator: false,
  },
  {
    name: "r3tards",
    address: "0x200723a706de0013316e5cd8eba2b3f53dd90c29",
    image: "/collections/r3tards.png",
    transferValidator: false,
  },
  {
    name: "skrumpeys",
    address: "0xb0dad798c80e40dd6b8e8545074c6a5b7b97d2c0",
    image: "/collections/skrumpeys.png",
    transferValidator: false,
  },
  {
    name: "Monshape",
    address: "0x1c921c0ccc4f1f90a18a1297dc040528b3cf0f5b",
    image: "/collections/monshape.png",
    officialLogo: "/collections/monshape.png",
    transferValidator: false,
  },
  {
    name: "Monafuku Cafe",
    address: "0xb6f9ba0511edced7491b06f33201b494575017eb",
    image: "/Logomark.png",
    transferValidator: false,
  },
  {
    name: "Kapysh",
    address: "0x6602fdcf8553671a9cba9f8765ab5f4d0bc8e66e",
    image: "/Logomark.png",
    transferValidator: false,
  },
  {
    name: "Ethereums Mogs",
    address: "0x1414f3baf22404c42fd656af4afaab4934045137",
    image: "/Logomark.png",
    transferValidator: false,
  },
  {
    name: "Monmilios",
    address: "0x5ccd3ca6279807a9e49432d37f72841a0b7f96be",
    image: "/Logomark.png",
    transferValidator: false,
  },

  // ── Transfer-validator gated — locked until owner approves settlement ──
  //    (red dot; visible but not tradeable yet)
  {
    name: "10kSquad",
    address: "0x818030837e8350ba63e64d7dc01a547fa73c8279",
    image: "/collections/10Ksquad.png",
    officialLogo: "/collections/10Ksquad.png",
    officialWebsite: "https://www.the10ksquad.xyz/",
    transferValidator: true,
  },
  {
    name: "Molandaks",
    address: "0x36982448e77658b8f58f4665696e3173d1e696c2",
    image: "/collections/molandaks.png",
    transferValidator: true,
  },
  {
    name: "Roarrr",
    address: "0xcbdfad1bfb6a4414dd4d84b7a6420dc43683deb0",
    image: "/collections/Roarrr.png",
    transferValidator: true,
  },
  {
    name: "Sealuminati",
    address: "0xaeaa920165fd7ce58a0e0772ffc97f06626572cd",
    image: "/collections/Sealuminati.png",
    transferValidator: true,
  },
  {
    name: "The Daks",
    address: "0x9f8514cebee138b61806d4651f51d26c8098b463",
    image: "/collections/The Daks.png",
    transferValidator: true,
  },
  {
    name: "Overnads",
    address: "0xfb5ba4061f5c50b1daa6c067bb2dfb0a8ebf6a8d",
    image: "/collections/Overnads.png",
    transferValidator: true,
  },
  {
    name: "Chewy",
    address: "0xe1ddf619bb352e6eb25367be99606be02836cbbc",
    image: "/collections/Chewy.png",
    transferValidator: true,
  },
  // Logos come from on-chain/indexer metadata (SafeCollectionImage); the
  // `image` fallback is only used when metadata has no image.
  {
    name: "LootGO",
    address: "0xa3522ea57c0bc48e602e2fe9f3929309d9618d96",
    image: "/collections/lootgo.png",
    transferValidator: true,
  },
  {
    name: "D.Y.O.O.R",
    address: "0x349d8eb480c92cf75371fba5c6344a4d11b9103a",
    image: "/Logomark.png",
    transferValidator: true,
  },
  {
    name: "Lil Starrs",
    address: "0xcabf3c04b90f4fe1b521fcaf4acb25d5df478e52",
    image: "/collections/lilstarrrs.png",
    transferValidator: true,
  },
  {
    name: "Mouch",
    address: "0x54b8048a30919e64c678d5decef5fd8c20f836ff",
    image: "/Logomark.png",
    transferValidator: true,
  },
  {
    name: "Mongang",
    address: "0xec7bf726c8011048e3c14c88fae1a788d22c220f",
    image: "/collections/mongang.png",
    transferValidator: true,
  },
  {
    name: "Spiky",
    address: "0x43577cc08c03d4017177eb1e43f5f8077c41c765",
    image: "/Logomark.png",
    transferValidator: true,
  },
  {
    name: "Llamao",
    address: "0x21d95addcebe87bea4e49534595f242af002d068",
    image: "/Logomark.png",
    transferValidator: true,
  },
  {
    name: "Chads",
    address: "0xe217a5517105a97616b09c05c685a7e125e6e753",
    image: "/Logomark.png",
    transferValidator: true,
  },
  {
    name: "Purple Frens",
    address: "0xbe88e5e5572aefa8fe52b460dbc82e34c78445e2",
    image: "/Logomark.png",
    transferValidator: true,
  },
  {
    name: "RealNads",
    address: "0xe20c4f8cacdb1854151f3e12144bdc919e608b9b",
    image: "/Logomark.png",
    transferValidator: true,
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
