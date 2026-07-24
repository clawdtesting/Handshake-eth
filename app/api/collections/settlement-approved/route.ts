import { NextResponse } from "next/server";
import type { Address } from "viem";
import { publicClient } from "@/lib/chains/client";
import { SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import {
  TRANSFER_VALIDATOR_ADDRESS,
  TRANSFER_PROBE_FROM,
  TRANSFER_PROBE_TO,
  transferValidatorAbi,
} from "@/lib/contracts/transfer-validator";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/collections/settlement-approved?contracts=0x..,0x..
 *
 * Reports, per collection, whether the shared Creator Token Transfer Validator
 * currently permits Handshake's settlement contract to move that collection's
 * tokens (i.e. the collection owner has authorised the settlement contract).
 * The trade-status dot uses this to flip a validator-gated collection from
 * locked (red) to open (green) automatically once approval lands on-chain.
 *
 * Fail CLOSED: only a read that positively returns `true` marks a collection
 * approved. A failed, reverted, or inconclusive read is treated as NOT approved,
 * so a collection is never shown as tradeable on an unverified positive. Reads
 * go through one multicall so a whole wallet's worth resolves in a single RPC
 * call.
 */

// Canonical Multicall3 (same deterministic address on Ethereum and every EVM).
const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; approved: boolean }>();

export async function GET(req: Request) {
  const { allowed: rateOk } = await rateLimit(
    clientKey(req, "collections-settlement-approved"),
    60,
    60_000,
  );
  if (!rateOk) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const unique = Array.from(
    new Set(
      (searchParams.get("contracts") ?? "")
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter((c) => /^0x[0-9a-f]{40}$/.test(c)),
    ),
  ).slice(0, 100);

  const settlementConfigured =
    SETTLEMENT_CONTRACT_ADDRESS !==
    "0x0000000000000000000000000000000000000000";

  const result: Record<string, boolean> = {};
  const misses: string[] = [];
  for (const address of unique) {
    const cached = cache.get(address);
    if (cached && Date.now() - cached.at < TTL_MS) {
      result[address] = cached.approved;
    } else {
      result[address] = false; // default closed until a read confirms otherwise
      if (settlementConfigured) misses.push(address);
    }
  }

  if (misses.length > 0) {
    const contracts = misses.map((address) => ({
      address: TRANSFER_VALIDATOR_ADDRESS,
      abi: transferValidatorAbi,
      functionName: "isTransferAllowed" as const,
      args: [
        address as Address,
        SETTLEMENT_CONTRACT_ADDRESS,
        TRANSFER_PROBE_FROM,
        TRANSFER_PROBE_TO,
      ] as const,
    }));

    try {
      const reads = await publicClient.multicall({
        contracts,
        allowFailure: true,
        multicallAddress: MULTICALL3_ADDRESS,
      });
      misses.forEach((address, i) => {
        const r = reads[i];
        if (r?.status === "success") {
          const approved = Boolean(r.result);
          result[address] = approved;
          cache.set(address, { at: Date.now(), approved });
        }
        // failure → leave as false (fail closed), don't cache the miss
      });
    } catch {
      // Multicall unavailable — fall back to individual reads, still fail closed.
      await Promise.all(
        misses.map(async (address) => {
          try {
            const approved = Boolean(
              await publicClient.readContract({
                address: TRANSFER_VALIDATOR_ADDRESS,
                abi: transferValidatorAbi,
                functionName: "isTransferAllowed",
                args: [
                  address as Address,
                  SETTLEMENT_CONTRACT_ADDRESS,
                  TRANSFER_PROBE_FROM,
                  TRANSFER_PROBE_TO,
                ],
              }),
            );
            result[address] = approved;
            cache.set(address, { at: Date.now(), approved });
          } catch {
            // leave false
          }
        }),
      );
    }
  }

  return NextResponse.json({ approved: result });
}
