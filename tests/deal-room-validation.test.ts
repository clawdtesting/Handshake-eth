import { describe, expect, it } from "vitest";
import {
  createRoomSchema,
  draftSchema,
  finalizeSchema,
  proposeRevisionSchema,
} from "@/lib/validation/deal-rooms";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0x1111111111111111111111111111111111111111";
const FUTURE = Math.floor(Date.now() / 1000) + 86_400;

const validDraft = {
  makerAddress: A,
  takerAddress: B,
  makerNFTs: [{ contractAddress: C, tokenId: "1" }],
  takerNFTs: [],
  makerEthAmount: "0",
  takerEthAmount: "1000",
  feeBps: 100,
  flatFee: "0",
  offerExpiry: FUTURE,
};

describe("draftSchema", () => {
  it("accepts a valid draft", () => {
    expect(draftSchema.safeParse(validDraft).success).toBe(true);
  });

  it("rejects maker === taker", () => {
    expect(
      draftSchema.safeParse({ ...validDraft, takerAddress: A }).success
    ).toBe(false);
  });

  it("rejects an empty side", () => {
    expect(
      draftSchema.safeParse({
        ...validDraft,
        makerNFTs: [],
        makerEthAmount: "0",
      }).success
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...validDraft,
        takerNFTs: [],
        takerEthAmount: "0",
      }).success
    ).toBe(false);
  });

  it("rejects past expiry", () => {
    expect(
      draftSchema.safeParse({ ...validDraft, offerExpiry: 1000 }).success
    ).toBe(false);
  });

  it("rejects duplicate NFTs on one side (case-insensitive)", () => {
    expect(
      draftSchema.safeParse({
        ...validDraft,
        makerNFTs: [
          { contractAddress: C, tokenId: "1" },
          { contractAddress: C.toUpperCase().replace("0X", "0x"), tokenId: "01" },
        ],
      }).success
    ).toBe(false);
  });

  it("rejects more than 20 NFTs per side (mirrors MAX_ITEMS_PER_SIDE)", () => {
    const nfts = Array.from({ length: 21 }, (_, i) => ({
      contractAddress: C,
      tokenId: String(i),
    }));
    expect(draftSchema.safeParse({ ...validDraft, makerNFTs: nfts }).success).toBe(false);
  });

  it("rejects fee above the contract cap (500 bps)", () => {
    expect(draftSchema.safeParse({ ...validDraft, feeBps: 501 }).success).toBe(false);
  });
});

describe("createRoomSchema", () => {
  const base = {
    chainId: 1,
    counterparty: B,
    draft: validDraft,
  };

  it("accepts minimal input and defaults room expiry to 7 days", () => {
    const parsed = createRoomSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.expiresInMinutes).toBe(7 * 24 * 60);
    }
  });

  it("bounds room lifetime to 15 minutes – 30 days", () => {
    expect(
      createRoomSchema.safeParse({ ...base, expiresInMinutes: 14 }).success
    ).toBe(false);
    expect(
      createRoomSchema.safeParse({ ...base, expiresInMinutes: 31 * 24 * 60 })
        .success
    ).toBe(false);
  });

  it("caps notes at 240 chars", () => {
    expect(
      createRoomSchema.safeParse({ ...base, note: "x".repeat(241) }).success
    ).toBe(false);
    expect(
      createRoomSchema.safeParse({ ...base, note: "x".repeat(240) }).success
    ).toBe(true);
  });
});

describe("proposeRevisionSchema", () => {
  it("requires a positive expectedVersion", () => {
    expect(
      proposeRevisionSchema.safeParse({ expectedVersion: 0, draft: validDraft })
        .success
    ).toBe(false);
    expect(
      proposeRevisionSchema.safeParse({ expectedVersion: 3, draft: validDraft })
        .success
    ).toBe(true);
  });
});

describe("finalizeSchema", () => {
  const order = {
    maker: A,
    taker: B,
    makerNFTs: [{ contractAddress: C, tokenId: "1" }],
    takerNFTs: [],
    makerEthAmount: "0",
    takerEthAmount: "1000",
    feeBps: "100",
    flatFee: "0",
    nonce: "123456789",
    expiry: String(FUTURE),
  };

  it("accepts a full order + signature", () => {
    expect(
      finalizeSchema.safeParse({
        expectedVersion: 5,
        order,
        signature: `0x${"ab".repeat(65)}`,
      }).success
    ).toBe(true);
  });

  it("rejects a short signature", () => {
    expect(
      finalizeSchema.safeParse({
        expectedVersion: 5,
        order,
        signature: "0x1234",
      }).success
    ).toBe(false);
  });

  it("rejects non-decimal uint fields", () => {
    expect(
      finalizeSchema.safeParse({
        expectedVersion: 5,
        order: { ...order, nonce: "0xdeadbeef" },
        signature: `0x${"ab".repeat(65)}`,
      }).success
    ).toBe(false);
  });
});
