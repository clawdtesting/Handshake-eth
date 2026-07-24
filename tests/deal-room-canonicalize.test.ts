import { describe, expect, it } from "vitest";
import {
  canonicalizeTerms,
  canonicalJson,
  termsHash,
} from "@/lib/deal-rooms/canonicalize";
import type { DealRoomDraft } from "@/lib/types";

const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xBbbBBbBbbbBBbBbbbbBbBbbBBbBBbbBbbBbbbbBB";
const C1 = "0x1111111111111111111111111111111111111111";
const C2 = "0x2222222222222222222222222222222222222222";

function draft(overrides: Partial<DealRoomDraft> = {}): DealRoomDraft {
  return {
    makerAddress: A,
    takerAddress: B,
    makerNFTs: [
      { contractAddress: C2, tokenId: "7" },
      { contractAddress: C1, tokenId: "42" },
    ],
    takerNFTs: [],
    makerEthAmount: "0",
    takerEthAmount: "4000000000000000000000",
    feeBps: 100,
    flatFee: "0",
    offerExpiry: 2_000_000_000,
    ...overrides,
  };
}

describe("canonicalizeTerms", () => {
  it("lowercases addresses and sorts NFTs by (contract, tokenId)", () => {
    const terms = canonicalizeTerms(draft());
    expect(terms.makerAddress).toBe(A.toLowerCase());
    expect(terms.takerAddress).toBe(B.toLowerCase());
    expect(terms.makerNFTs.map((n) => n.contractAddress)).toEqual([C1, C2]);
  });

  it("normalizes tokenIds to canonical decimal (strips leading zeros)", () => {
    const terms = canonicalizeTerms(
      draft({ makerNFTs: [{ contractAddress: C1, tokenId: "0042" }] })
    );
    expect(terms.makerNFTs[0].tokenId).toBe("42");
  });

  it("sorts numeric tokenIds numerically, not lexicographically", () => {
    const terms = canonicalizeTerms(
      draft({
        makerNFTs: [
          { contractAddress: C1, tokenId: "10" },
          { contractAddress: C1, tokenId: "9" },
        ],
      })
    );
    expect(terms.makerNFTs.map((n) => n.tokenId)).toEqual(["9", "10"]);
  });
});

describe("termsHash", () => {
  it("is order-independent for NFT arrays", () => {
    const a = draft();
    const b = draft({ makerNFTs: [...draft().makerNFTs].reverse() });
    expect(termsHash(a)).toBe(termsHash(b));
  });

  it("is case-independent for addresses", () => {
    const a = draft();
    const b = draft({
      makerAddress: A.toLowerCase(),
      takerAddress: B.toUpperCase().replace("0X", "0x"),
    });
    expect(termsHash(a)).toBe(termsHash(b));
  });

  it("changes when any economic field changes", () => {
    const base = termsHash(draft());
    expect(termsHash(draft({ takerEthAmount: "4000000000000000000001" }))).not.toBe(base);
    expect(termsHash(draft({ feeBps: 99 }))).not.toBe(base);
    expect(termsHash(draft({ flatFee: "1" }))).not.toBe(base);
    expect(termsHash(draft({ offerExpiry: 2_000_000_001 }))).not.toBe(base);
    expect(
      termsHash(
        draft({ makerNFTs: [{ contractAddress: C1, tokenId: "42" }] })
      )
    ).not.toBe(base);
  });

  it("differs when the same NFT set moves to the other side", () => {
    const a = draft({
      makerNFTs: [{ contractAddress: C1, tokenId: "1" }],
      takerNFTs: [],
      takerEthAmount: "1",
      makerEthAmount: "1",
    });
    const b = draft({
      makerNFTs: [],
      takerNFTs: [{ contractAddress: C1, tokenId: "1" }],
      takerEthAmount: "1",
      makerEthAmount: "1",
    });
    expect(termsHash(a)).not.toBe(termsHash(b));
  });

  it("produces a 32-byte hex hash", () => {
    expect(termsHash(draft())).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("canonical JSON is stable across duplicate calls", () => {
    const t = canonicalizeTerms(draft());
    expect(canonicalJson(t)).toBe(canonicalJson(canonicalizeTerms(draft())));
  });

  it("handles uint256-scale tokenIds without precision loss", () => {
    const big = 2n ** 255n;
    const a = draft({
      makerNFTs: [{ contractAddress: C1, tokenId: big.toString() }],
    });
    const b = draft({
      makerNFTs: [{ contractAddress: C1, tokenId: (big + 1n).toString() }],
    });
    expect(termsHash(a)).not.toBe(termsHash(b));
  });
});
