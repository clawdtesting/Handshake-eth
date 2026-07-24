/**
 * Centralised contract-write runner used by every transaction flow.
 *
 * Guarantees, for accept / cancel / approve / deposit / withdraw alike:
 *   - chain is validated before anything is signed,
 *   - the call is simulated first when possible (catches reverts pre-gas),
 *   - gas is buffered (Ethereum RPC rejects estimate-tight limits),
 *   - every lifecycle step is logged with structured context,
 *   - the receipt status is checked,
 *   - errors are classified into user-safe messages.
 *
 * On failure it throws an Error whose `.message` is already user-facing, so
 * callers can `toast.error(err.message)` directly. The original error is kept
 * on `.cause` and a classified `.name` is attached for logging.
 */

import type { Abi, Address, PublicClient } from "viem";
import { bufferedGas } from "@/lib/chains/gas";
import { classifyTxError } from "@/lib/chains/tx-errors";
import { logTx, newTxId, type TxLogContext } from "@/lib/chains/tx-log";

type WriteContractAsync = (args: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
}) => Promise<`0x${string}`>;

export interface RunWriteParams {
  publicClient: PublicClient;
  writeContractAsync: WriteContractAsync;
  /** Connected wallet (sender). */
  account: Address;
  /** Chain the wallet is currently connected to. */
  walletChainId: number | undefined;
  /** Chain the app/contract expects. */
  expectedChainId: number;
  /** Human label for logs/toasts, e.g. "Accept deal". */
  label: string;

  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;

  /** Simulate before sending (default true). Set false for funcs that can't simulate cleanly. */
  simulate?: boolean;
  /** Called as soon as the tx hash is known (UI can move to "pending"). */
  onSubmitted?: (hash: `0x${string}`) => void;
}

export interface RunWriteResult {
  hash: `0x${string}`;
  /** Mined receipt; status already verified === "success". */
  receipt: Awaited<ReturnType<PublicClient["waitForTransactionReceipt"]>>;
}

/** A user-facing transaction error with classification metadata attached. */
export class TxError extends Error {
  readonly errorName: string;
  readonly revertReason?: string;
  constructor(message: string, errorName: string, options?: { cause?: unknown; revertReason?: string }) {
    super(message);
    this.name = "TxError";
    this.errorName = errorName;
    this.revertReason = options?.revertReason;
    if (options?.cause) this.cause = options.cause;
  }
}

export async function runWrite(params: RunWriteParams): Promise<RunWriteResult> {
  const {
    publicClient,
    writeContractAsync,
    account,
    walletChainId,
    expectedChainId,
    label,
    address,
    abi,
    functionName,
    args,
    value,
    simulate = true,
    onSubmitted,
  } = params;

  const id = newTxId();
  const ctx: TxLogContext = {
    label,
    wallet: account,
    chainId: walletChainId,
    contract: address,
    functionName,
    args,
    value: value !== undefined ? value.toString() : undefined,
  };

  logTx(id, "prepare", ctx);

  // ---- Chain validation (fail fast, before any wallet prompt) ----
  logTx(id, "validate", ctx);
  if (walletChainId !== expectedChainId) {
    const message = `Switch your wallet to Ethereum (chain ${expectedChainId}) before continuing.`;
    logTx(id, "error", ctx, { errorName: "WrongNetwork", errorMessage: message });
    throw new TxError(message, "WrongNetwork");
  }

  try {
    // ---- Simulation (catches reverts before the user pays gas) ----
    if (simulate) {
      logTx(id, "simulate", ctx);
      try {
        await publicClient.simulateContract({
          account,
          address,
          abi,
          functionName,
          args: args as never,
          value,
        });
        logTx(id, "simulated", ctx, { simulationOk: true });
      } catch (simErr) {
        const classified = classifyTxError(simErr);
        logTx(id, "error", ctx, {
          simulationOk: false,
          errorName: classified.name,
          errorMessage: classified.rawMessage,
          revertReason: classified.revertReason,
        });
        throw new TxError(classified.userMessage, classified.name, {
          cause: simErr,
          revertReason: classified.revertReason,
        });
      }
    }

    // ---- Buffered gas estimate (Ethereum needs headroom) ----
    const gas = await bufferedGas(publicClient, {
      account,
      address,
      abi,
      functionName,
      args: args as never,
      value,
    } as never);

    // ---- Submit ----
    logTx(id, "submit", ctx);
    const hash = await writeContractAsync({
      address,
      abi,
      functionName,
      args,
      value,
      ...(gas !== undefined ? { gas } : {}),
    });
    logTx(id, "submitted", ctx, { txHash: hash });
    onSubmitted?.(hash);

    // ---- Wait for receipt ----
    logTx(id, "receipt", ctx, { txHash: hash });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      logTx(id, "error", ctx, {
        txHash: hash,
        receiptStatus: "reverted",
        errorName: "Reverted",
        errorMessage: "Transaction reverted on-chain",
      });
      throw new TxError(
        "The transaction reverted on-chain. The deal may no longer be valid.",
        "Reverted",
      );
    }

    logTx(id, "success", ctx, { txHash: hash, receiptStatus: "success" });
    return { hash, receipt };
  } catch (err) {
    if (err instanceof TxError) throw err;
    const classified = classifyTxError(err);
    logTx(id, "error", ctx, {
      errorName: classified.name,
      errorMessage: classified.rawMessage,
      revertReason: classified.revertReason,
    });
    throw new TxError(classified.userMessage, classified.name, {
      cause: err,
      revertReason: classified.revertReason,
    });
  }
}
