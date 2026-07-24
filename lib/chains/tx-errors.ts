/**
 * Classify wallet / RPC / contract errors into actionable, user-facing
 * messages. Replaces generic "transaction failed" toasts with specific
 * guidance, and exposes a stable error name for structured logging.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Address,
  type Hex,
} from "viem";
import { settlementAbi, settlementErrorMessages } from "@/lib/contracts/settlement";

export interface ClassifiedTxError {
  /** Stable, machine-readable name for logging/metrics. */
  name: string;
  /** Safe, user-facing message. */
  userMessage: string;
  /** Decoded contract revert reason, when the failure was a revert. */
  revertReason?: string;
  /** Raw message for developer logs. */
  rawMessage: string;
}

/** Decode a settlement revert into a friendly sentence, when possible. */
export function decodeRevert(err: unknown): { name: string; message: string } | null {
  if (err instanceof BaseError) {
    const revert = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? undefined;
      if (name && settlementErrorMessages[name]) {
        return { name, message: settlementErrorMessages[name] };
      }
      if (name) return { name, message: `Settlement would revert: ${name}` };
    }
  }

  // Some Ethereum RPCs return a plain JSON-RPC error (or put it under `cause`)
  // instead of letting viem construct ContractFunctionRevertedError. Decode
  // any revert payload ourselves so useful custom errors are not reduced to
  // the generic "would revert" message.
  const data = findRevertData(err);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: settlementAbi, data });
      const name = decoded.errorName;
      return {
        name,
        message:
          settlementErrorMessages[name] ?? `Settlement would revert: ${name}`,
      };
    } catch {
      // The payload may belong to an unknown third-party NFT implementation.
    }
  }
  return null;
}

function findRevertData(value: unknown, seen = new Set<unknown>()): Hex | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (
    typeof record.data === "string" &&
    /^0x[0-9a-fA-F]{8,}$/.test(record.data)
  ) {
    return record.data as Hex;
  }

  for (const key of ["cause", "error", "details"]) {
    const nested = findRevertData(record[key], seen);
    if (nested) return nested;
  }
  return null;
}

function messageIncludes(err: unknown, needle: string): boolean {
  const msg =
    err instanceof BaseError
      ? `${err.shortMessage} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return msg.toLowerCase().includes(needle.toLowerCase());
}

function errorCode(err: unknown): number | string | undefined {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.code === "number" || typeof anyErr.code === "string") {
      return anyErr.code as number | string;
    }
    const cause = anyErr.cause as Record<string, unknown> | undefined;
    if (cause && (typeof cause.code === "number" || typeof cause.code === "string")) {
      return cause.code as number | string;
    }
  }
  return undefined;
}

function rawMessageOf(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Map any thrown transaction error to a classified, user-safe result.
 * Order matters: most-specific signals first.
 */
export function classifyTxError(err: unknown): ClassifiedTxError {
  const rawMessage = rawMessageOf(err);
  const code = errorCode(err);

  // 1. Contract revert with a known reason.
  const revert = decodeRevert(err);
  if (revert) {
    return {
      name: revert.name,
      userMessage: revert.message,
      revertReason: revert.name,
      rawMessage,
    };
  }

  // 2. User rejected the request in their wallet (EIP-1193 code 4001).
  if (
    code === 4001 ||
    err?.constructor?.name === "UserRejectedRequestError" ||
    messageIncludes(err, "User rejected") ||
    messageIncludes(err, "User denied") ||
    messageIncludes(err, "rejected the request")
  ) {
    return {
      name: "UserRejected",
      userMessage: "You rejected the request in your wallet.",
      rawMessage,
    };
  }

  // 3. Wrong network.
  if (
    err?.constructor?.name === "ChainMismatchError" ||
    messageIncludes(err, "chain mismatch") ||
    messageIncludes(err, "does not match the target chain")
  ) {
    return {
      name: "WrongNetwork",
      userMessage: "Your wallet is on the wrong network. Switch to Ethereum and try again.",
      rawMessage,
    };
  }

  // 4. Insufficient funds for value + gas.
  if (
    messageIncludes(err, "insufficient funds") ||
    err?.constructor?.name === "InsufficientFundsError"
  ) {
    return {
      name: "InsufficientFunds",
      userMessage:
        "You don't have enough ETH to cover this amount plus gas. Top up your wallet and retry.",
      rawMessage,
    };
  }

  // 5. Gas too low (Ethereum RPC rejects estimate-tight limits).
  if (
    messageIncludes(err, "gas limit too low") ||
    messageIncludes(err, "intrinsic gas too low") ||
    messageIncludes(err, "out of gas")
  ) {
    return {
      name: "GasTooLow",
      userMessage:
        "The network rejected the gas limit. Retry — we add extra gas headroom for Ethereum.",
      rawMessage,
    };
  }

  // 6. Dropped / replaced transaction.
  if (
    messageIncludes(err, "replacement transaction underpriced") ||
    messageIncludes(err, "transaction was replaced") ||
    messageIncludes(err, "nonce too low") ||
    err?.constructor?.name === "TransactionNotFoundError" ||
    err?.constructor?.name === "WaitForTransactionReceiptTimeoutError"
  ) {
    return {
      name: "TxDroppedOrReplaced",
      userMessage:
        "The transaction was dropped or replaced before it confirmed. Check your wallet activity and retry if needed.",
      rawMessage,
    };
  }

  // 7. RPC / network transport failure.
  if (
    err?.constructor?.name === "HttpRequestError" ||
    err?.constructor?.name === "TimeoutError" ||
    err?.constructor?.name === "RpcRequestError" ||
    messageIncludes(err, "request timed out") ||
    messageIncludes(err, "failed to fetch") ||
    messageIncludes(err, "network request failed")
  ) {
    return {
      name: "RpcError",
      userMessage:
        "Couldn't reach the Ethereum network. Check your connection or RPC and try again.",
      rawMessage,
    };
  }

  // 8. Generic contract revert without a decodable reason.
  if (messageIncludes(err, "reverted") || messageIncludes(err, "execution reverted")) {
    return {
      name: "ContractReverted",
      userMessage:
        "The transaction would revert on-chain. The deal may no longer be valid (expired, already filled, missing approval, or ownership changed).",
      rawMessage,
    };
  }

  // 9. Fallback — surface the cleanest message we have.
  const shortMessage =
    err instanceof BaseError ? err.shortMessage : undefined;
  return {
    name: "Unknown",
    userMessage: shortMessage || rawMessage || "Transaction failed. Please try again.",
    rawMessage,
  };
}

/** Convenience: a non-zero-address settlement contract guard message. */
export function settlementConfigured(address: Address): boolean {
  return address !== "0x0000000000000000000000000000000000000000";
}
