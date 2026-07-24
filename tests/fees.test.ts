import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { quoteFees } from "@/lib/fees";

describe("fee math (must mirror Handshake.sol)", () => {
  it("charges 1% on each ETH leg by default", () => {
    const q = quoteFees(parseEther("10"), parseEther("4"));
    expect(q.makerLegFee).toBe(parseEther("0.1"));
    expect(q.takerLegFee).toBe(parseEther("0.04"));
    expect(q.totalFee).toBe(parseEther("0.14"));
  });

  it("charges no fee on pure NFT swaps by default", () => {
    const q = quoteFees(0n, 0n);
    expect(q.totalFee).toBe(0n);
    expect(q.takerPays).toBe(0n);
  });

  it("applies the flat swap fee only when no ETH moves", () => {
    const flat = parseEther("0.05");
    expect(quoteFees(0n, 0n, 100n, flat).totalFee).toBe(flat);
    expect(quoteFees(parseEther("1"), 0n, 100n, flat).flatFee).toBe(0n);
  });

  it("computes taker payment as amount + taker leg fee + flat fee", () => {
    const q = quoteFees(0n, parseEther("100"));
    expect(q.takerPays).toBe(parseEther("101"));
  });

  it("computes maker escrow requirement as amount + maker leg fee", () => {
    const q = quoteFees(parseEther("100"), 0n);
    expect(q.makerEscrowRequired).toBe(parseEther("101"));
  });

  it("uses integer division like Solidity", () => {
    // 1 wei * 100 / 10000 = 0 (floor)
    const q = quoteFees(1n, 99n);
    expect(q.makerLegFee).toBe(0n);
    expect(q.takerLegFee).toBe(0n);
  });

  it("respects custom fee bps", () => {
    const q = quoteFees(parseEther("10"), 0n, 500n);
    expect(q.makerLegFee).toBe(parseEther("0.5"));
  });
});
