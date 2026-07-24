import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, type Address } from "viem";
import {
  generateNonce,
  getOrderDomain,
  hashOrder,
  ORDER_TYPES,
  verifyOrderSignature,
  ZERO_ADDRESS,
  type TradeOrder,
} from "@/lib/orders/eip712";

const maker = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);

const order: TradeOrder = {
  maker: maker.address.toLowerCase() as Address,
  taker: ZERO_ADDRESS,
  makerNFTs: [
    { standard: 0, contractAddress: ("0x" + "2".repeat(40)) as Address, tokenId: 1n, amount: 1n },
  ],
  takerNFTs: [],
  makerEthAmount: 0n,
  takerEthAmount: parseEther("1"),
  feeBps: 100n,
  flatFee: 0n,
  nonce: 42n,
  expiry: 2000000000n,
};

describe("EIP-712 orders", () => {
  it("produces a stable deterministic hash", () => {
    const a = hashOrder(order, 1, ("0x" + "9".repeat(40)) as Address);
    const b = hashOrder(order, 1, ("0x" + "9".repeat(40)) as Address);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("hash changes when the order changes", () => {
    const a = hashOrder(order, 1, ("0x" + "9".repeat(40)) as Address);
    const b = hashOrder(
      { ...order, takerEthAmount: parseEther("2") },
      1,
      ("0x" + "9".repeat(40)) as Address
    );
    expect(a).not.toBe(b);
  });

  it("verifies a signature from the maker and rejects tampering", async () => {
    const signature = await maker.signTypedData({
      domain: getOrderDomain(1, ("0x" + "9".repeat(40)) as Address),
      types: ORDER_TYPES,
      primaryType: "TradeOrder",
      message: order,
    });
    expect(
      await verifyOrderSignature(order, signature, 1, ("0x" + "9".repeat(40)) as Address)
    ).toBe(true);
    expect(
      await verifyOrderSignature(
        { ...order, nonce: 43n },
        signature,
        1,
        ("0x" + "9".repeat(40)) as Address
      )
    ).toBe(false);
  });

  it("binds the signature to the chain id", async () => {
    const signature = await maker.signTypedData({
      domain: getOrderDomain(1, ("0x" + "9".repeat(40)) as Address),
      types: ORDER_TYPES,
      primaryType: "TradeOrder",
      message: order,
    });
    expect(
      await verifyOrderSignature(order, signature, 2, ("0x" + "9".repeat(40)) as Address)
    ).toBe(false);
  });

  it("generates unique 256-bit nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a < 2n ** 256n).toBe(true);
  });
});
