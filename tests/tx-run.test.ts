import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { runWrite, TxError } from "@/lib/chains/tx";
import { clearTxLog, getTxLog } from "@/lib/chains/tx-log";

const ACCOUNT = ("0x" + "1".repeat(40)) as Address;
const CONTRACT = ("0x" + "2".repeat(40)) as Address;
const HASH = ("0x" + "a".repeat(64)) as `0x${string}`;

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    simulateContract: vi.fn().mockResolvedValue({ request: {} }),
    estimateContractGas: vi.fn().mockResolvedValue(100_000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    ...overrides,
  };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    account: ACCOUNT,
    walletChainId: 1,
    expectedChainId: 1,
    label: "Test write",
    address: CONTRACT,
    abi: [] as never,
    functionName: "deposit",
    ...overrides,
  };
}

describe("runWrite", () => {
  beforeEach(() => clearTxLog());

  it("simulates, buffers gas by 50%, submits, and verifies the receipt", async () => {
    const publicClient = makeClient();
    const writeContractAsync = vi.fn().mockResolvedValue(HASH);

    const result = await runWrite({
      publicClient,
      writeContractAsync,
      ...baseParams({ value: 5n }),
    } as never);

    expect(publicClient.simulateContract).toHaveBeenCalledOnce();
    // 100_000 * 3 / 2 = 150_000
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 150_000n, value: 5n }),
    );
    expect(result.hash).toBe(HASH);

    const phases = getTxLog().map((r) => r.phase);
    expect(phases).toContain("submitted");
    expect(phases).toContain("success");
  });

  it("rejects on the wrong network before prompting the wallet", async () => {
    const publicClient = makeClient();
    const writeContractAsync = vi.fn();

    await expect(
      runWrite({
        publicClient,
        writeContractAsync,
        ...baseParams({ walletChainId: 2 }),
      } as never),
    ).rejects.toMatchObject({ errorName: "WrongNetwork" });

    expect(writeContractAsync).not.toHaveBeenCalled();
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it("classifies a simulation revert and never submits", async () => {
    const publicClient = makeClient({
      simulateContract: vi
        .fn()
        .mockRejectedValue(new Error("User rejected the request.")),
    });
    const writeContractAsync = vi.fn();

    await expect(
      runWrite({
        publicClient,
        writeContractAsync,
        ...baseParams(),
      } as never),
    ).rejects.toMatchObject({ errorName: "UserRejected" });

    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("still submits when gas estimation fails (wallet default applies)", async () => {
    const publicClient = makeClient({
      estimateContractGas: vi.fn().mockRejectedValue(new Error("estimate fail")),
    });
    const writeContractAsync = vi.fn().mockResolvedValue(HASH);

    await runWrite({
      publicClient,
      writeContractAsync,
      ...baseParams(),
    } as never);

    const call = writeContractAsync.mock.calls[0][0];
    expect("gas" in call).toBe(false);
  });

  it("throws when the receipt status is reverted", async () => {
    const publicClient = makeClient({
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ status: "reverted" }),
    });
    const writeContractAsync = vi.fn().mockResolvedValue(HASH);

    await expect(
      runWrite({
        publicClient,
        writeContractAsync,
        ...baseParams(),
      } as never),
    ).rejects.toBeInstanceOf(TxError);
  });

  it("can skip simulation when simulate=false", async () => {
    const publicClient = makeClient();
    const writeContractAsync = vi.fn().mockResolvedValue(HASH);

    await runWrite({
      publicClient,
      writeContractAsync,
      ...baseParams({ simulate: false }),
    } as never);

    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(writeContractAsync).toHaveBeenCalledOnce();
  });
});
