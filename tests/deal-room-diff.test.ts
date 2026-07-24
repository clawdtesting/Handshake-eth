import { describe, expect, it } from "vitest";
import { diffDrafts } from "@/lib/deal-rooms/diff";
import type { DealRoomDraft } from "@/lib/types";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0x1111111111111111111111111111111111111111";

function draft(overrides: Partial<DealRoomDraft> = {}): DealRoomDraft {
  return {
    makerAddress: A,
    takerAddress: B,
    makerNFTs: [{ contractAddress: C, tokenId: "1", name: "Molandak #1" }],
    takerNFTs: [],
    makerEthAmount: "0",
    takerEthAmount: "4000000000000000000000", // 4000 ETH
    feeBps: 100,
    flatFee: "0",
    offerExpiry: Math.floor(Date.now() / 1000) + 86_400,
    ...overrides,
  };
}

describe("diffDrafts", () => {
  it("returns no chips for the first revision (no base)", () => {
    expect(diffDrafts(null, draft())).toEqual([]);
  });

  it("returns no chips when nothing changed", () => {
    expect(diffDrafts(draft(), draft())).toEqual([]);
  });

  it("flags added and removed NFTs with names", () => {
    const before = draft();
    const after = draft({
      makerNFTs: [{ contractAddress: C, tokenId: "2", name: "Molandak #2" }],
    });
    const chips = diffDrafts(before, after);
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("+ Molandak #2");
    expect(labels).toContain("− Molandak #1");
  });

  it("flags ETH deltas with sign, magnitude, and before→after", () => {
    const before = draft();
    const after = draft({ takerEthAmount: "3500000000000000000000" }); // −500
    const chips = diffDrafts(before, after);
    const eth = chips.find((c) => c.kind === "eth");
    expect(eth).toBeDefined();
    expect(eth!.side).toBe("taker");
    expect(eth!.label).toContain("−");
    expect(eth!.label).toContain("500");
    expect(eth!.label).toContain("4000 → 3500");
  });

  it("flags expiry changes", () => {
    const before = draft();
    const after = draft({ offerExpiry: before.offerExpiry + 6 * 86_400 });
    const chips = diffDrafts(before, after);
    expect(chips.some((c) => c.kind === "expiry")).toBe(true);
  });

  it("treats the same NFT with different display metadata as unchanged", () => {
    const before = draft();
    const after = draft({
      makerNFTs: [
        { contractAddress: C.toUpperCase().replace("0X", "0x"), tokenId: "01", name: "Renamed" },
      ],
    });
    expect(diffDrafts(before, after)).toEqual([]);
  });
});
