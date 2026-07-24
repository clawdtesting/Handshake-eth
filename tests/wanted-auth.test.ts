import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCreateWantedMessage,
  buildDeleteWantedMessage,
  timestampFresh,
  verifyWalletSignature,
} from "@/lib/wanted/auth";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);

describe("wanted auth", () => {
  it("accepts a signature from the claimed wallet", async () => {
    const timestamp = Date.now();
    const message = buildCreateWantedMessage({
      walletAddress: account.address,
      lookingFor: "Ethereum Punks",
      timestamp,
    });
    const signature = await account.signMessage({ message });
    expect(
      await verifyWalletSignature(message, signature, account.address)
    ).toBe(true);
  });

  it("rejects a signature for a different wallet", async () => {
    const timestamp = Date.now();
    const message = buildDeleteWantedMessage({
      walletAddress: account.address,
      id: "00000000-0000-0000-0000-000000000000",
      timestamp,
    });
    const signature = await account.signMessage({ message });
    expect(
      await verifyWalletSignature(
        message,
        signature,
        "0x000000000000000000000000000000000000dEaD"
      )
    ).toBe(false);
  });

  it("rejects a tampered message", async () => {
    const timestamp = Date.now();
    const message = buildCreateWantedMessage({
      walletAddress: account.address,
      lookingFor: "Ethereum Punks",
      timestamp,
    });
    const signature = await account.signMessage({ message });
    const tampered = buildCreateWantedMessage({
      walletAddress: account.address,
      lookingFor: "Something else",
      timestamp,
    });
    expect(
      await verifyWalletSignature(tampered, signature, account.address)
    ).toBe(false);
  });

  it("enforces timestamp freshness", () => {
    const now = Date.now();
    expect(timestampFresh(now, now)).toBe(true);
    expect(timestampFresh(now - 10 * 60 * 1000, now)).toBe(false);
  });
});
