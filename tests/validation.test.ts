import { describe, expect, it } from "vitest";
import {
  cancelOfferSchema,
  completeOfferSchema,
  createOfferSchema,
  listOffersQuerySchema,
} from "@/lib/validation/offers";

const validOffer = {
  chainId: 1,
  makerAddress: "0x" + "1".repeat(40),
  takerAddress: null,
  makerNFTs: [
    {
      contractAddress: "0x" + "2".repeat(40),
      tokenId: "1",
      tokenStandard: "ERC721" as const,
    },
  ],
  takerNFTs: [],
  makerEthAmount: "0",
  takerEthAmount: "1000000000000000000",
  feeBps: 100,
  flatFee: "0",
  nonce: "12345",
  expiry: Math.floor(Date.now() / 1000) + 3600,
  signature: "0x" + "a".repeat(130),
  isPrivate: false,
};

describe("createOfferSchema", () => {
  it("accepts a valid offer", () => {
    expect(createOfferSchema.safeParse(validOffer).success).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, makerAddress: "not-an-address" })
        .success
    ).toBe(false);
  });

  it("rejects empty maker side", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, makerNFTs: [], makerEthAmount: "0" })
        .success
    ).toBe(false);
  });

  it("rejects empty taker side", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, takerNFTs: [], takerEthAmount: "0" })
        .success
    ).toBe(false);
  });

  it("rejects past expiry", () => {
    expect(
      createOfferSchema.safeParse({
        ...validOffer,
        expiry: Math.floor(Date.now() / 1000) - 10,
      }).success
    ).toBe(false);
  });

  it("rejects private offers without a taker", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, isPrivate: true, takerAddress: null })
        .success
    ).toBe(false);
  });

  it("accepts private offers with a taker", () => {
    expect(
      createOfferSchema.safeParse({
        ...validOffer,
        isPrivate: true,
        takerAddress: "0x" + "3".repeat(40),
      }).success
    ).toBe(true);
  });

  it("rejects more than 20 NFTs per side", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      contractAddress: "0x" + "2".repeat(40),
      tokenId: String(i),
      tokenStandard: "ERC721" as const,
    }));
    expect(
      createOfferSchema.safeParse({ ...validOffer, makerNFTs: many }).success
    ).toBe(false);
  });

  it("rejects non-numeric amounts", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, takerEthAmount: "1.5" }).success
    ).toBe(false);
  });

  it("rejects malformed signatures", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, signature: "0x1234" }).success
    ).toBe(false);
  });

  it("rejects a feeBps over the 5% cap", () => {
    expect(
      createOfferSchema.safeParse({ ...validOffer, feeBps: 501 }).success
    ).toBe(false);
  });

  it("requires the fee fields", () => {
    const { feeBps, ...withoutFee } = validOffer;
    void feeBps;
    expect(createOfferSchema.safeParse(withoutFee).success).toBe(false);
  });
});

describe("completeOfferSchema", () => {
  it("requires a valid tx hash", () => {
    expect(
      completeOfferSchema.safeParse({
        txHash: "0x" + "f".repeat(64),
        takerAddress: "0x" + "4".repeat(40),
      }).success
    ).toBe(true);
    expect(
      completeOfferSchema.safeParse({
        txHash: "0x123",
        takerAddress: "0x" + "4".repeat(40),
      }).success
    ).toBe(false);
  });
});

describe("cancelOfferSchema", () => {
  it("requires the maker wallet and the on-chain cancel tx hash", () => {
    // Both walletAddress and txHash are required: the route verifies the tx
    // emits TradeCancelled for this offer, so txHash can no longer be omitted.
    expect(
      cancelOfferSchema.safeParse({
        walletAddress: "0x" + "5".repeat(40),
        txHash: "0x" + "a".repeat(64),
      }).success
    ).toBe(true);
    // Missing txHash is now rejected (previously accepted).
    expect(
      cancelOfferSchema.safeParse({ walletAddress: "0x" + "5".repeat(40) }).success
    ).toBe(false);
    // Malformed tx hash is rejected.
    expect(
      cancelOfferSchema.safeParse({
        walletAddress: "0x" + "5".repeat(40),
        txHash: "0xdeadbeef",
      }).success
    ).toBe(false);
    expect(cancelOfferSchema.safeParse({}).success).toBe(false);
  });
});

describe("listOffersQuerySchema", () => {
  it("applies defaults and caps the limit", () => {
    const parsed = listOffersQuerySchema.parse({});
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(0);
    expect(listOffersQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
  });
});
