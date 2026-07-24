import { encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import { classifyTxError } from "@/lib/chains/tx-errors";
import { settlementAbi } from "@/lib/contracts/settlement";

describe("classifyTxError", () => {
  it("detects user rejection by EIP-1193 code", () => {
    const result = classifyTxError({ code: 4001, message: "denied" });
    expect(result.name).toBe("UserRejected");
    expect(result.userMessage).toMatch(/rejected the request/i);
  });

  it("detects user rejection by message", () => {
    const result = classifyTxError(new Error("User rejected the request."));
    expect(result.name).toBe("UserRejected");
  });

  it("detects insufficient funds", () => {
    const result = classifyTxError(
      new Error("insufficient funds for gas * price + value"),
    );
    expect(result.name).toBe("InsufficientFunds");
    expect(result.userMessage).toMatch(/enough ETH/i);
  });

  it("detects gas-too-low (Ethereum RPC rejection)", () => {
    const result = classifyTxError(new Error("Gas limit too low"));
    expect(result.name).toBe("GasTooLow");
  });

  it("detects wrong network", () => {
    const err = new Error("chain mismatch");
    expect(classifyTxError(err).name).toBe("WrongNetwork");
  });

  it("detects dropped/replaced transactions", () => {
    const result = classifyTxError(
      new Error("replacement transaction underpriced"),
    );
    expect(result.name).toBe("TxDroppedOrReplaced");
  });

  it("detects RPC transport failures", () => {
    const result = classifyTxError(new Error("Failed to fetch"));
    expect(result.name).toBe("RpcError");
  });

  it("detects a generic on-chain revert", () => {
    const result = classifyTxError(new Error("execution reverted"));
    expect(result.name).toBe("ContractReverted");
  });

  it("decodes revert data nested in a plain Ethereum RPC error", () => {
    const data = encodeErrorResult({
      abi: settlementAbi,
      errorName: "TransferNotEffective",
      args: ["0x818030837e8350ba63e64d7dc01a547fa73c8279", 1918n],
    });
    const result = classifyTxError({
      message: "execution reverted",
      cause: { code: 3, data },
    });

    expect(result.name).toBe("TransferNotEffective");
    expect(result.userMessage).toMatch(/ownership did not change/i);
  });

  it("explains a bubbled ERC-721 receiver rejection", () => {
    const data = encodeErrorResult({
      abi: settlementAbi,
      errorName: "ERC721InvalidReceiver",
      args: ["0x2f2a0000000000000000000000000000000047d3"],
    });
    const result = classifyTxError({ message: "execution reverted", data });

    expect(result.name).toBe("ERC721InvalidReceiver");
    expect(result.userMessage).toMatch(/cannot receive this NFT/i);
  });

  it("falls back to the raw message for unknown errors", () => {
    const result = classifyTxError(new Error("something weird happened"));
    expect(result.name).toBe("Unknown");
    expect(result.userMessage).toBe("something weird happened");
  });

  it("never throws on non-Error inputs", () => {
    expect(() => classifyTxError(undefined)).not.toThrow();
    expect(() => classifyTxError("a string")).not.toThrow();
    expect(() => classifyTxError(null)).not.toThrow();
  });
});
