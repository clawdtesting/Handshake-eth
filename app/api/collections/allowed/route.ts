import { NextResponse } from "next/server";
import type { Address } from "viem";
import { publicClient } from "@/lib/chains/client";
import { settlementAbi } from "@/lib/contracts/settlement";
import { SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/collections/allowed?contracts=0x..,0x..
 *
 * Reports which collections the settlement contract will accept
 * (isCollectionAllowed — allowlisted AND past its ADD_DELAY timelock), so the
 * trade UI shows only Handshake-supported collections rather than the wallet's
 * entire holdings.
 *
 * Fail CLOSED: only a read that positively returns `true` marks a collection
 * allowed. A failed/inconclusive read is treated as NOT allowed so unverifiable
 * junk (LP positions, vouchers, spam) never shows up. Reads go through one
 * multicall so a whole wallet's worth of collections resolves in a single RPC
 * call instead of dozens that rate-limit and fail.
 */

// Canonical Multicall3 (same deterministic address on Ethereum and every EVM).
const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; allowed: boolean }>();

export async function GET(req: Request) {
  const { allowed: rateOk } = await rateLimit(
    clientKey(req, "collections-allowed"),
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
      result[address] = cached.allowed;
    } else {
      result[address] = false; // default closed until a read confirms otherwise
      if (settlementConfigured) misses.push(address);
    }
  }

  if (misses.length > 0) {
    const contracts = misses.map((address) => ({
      address: SETTLEMENT_CONTRACT_ADDRESS,
      abi: settlementAbi,
      functionName: "isCollectionAllowed" as const,
      args: [address as Address] as const,
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
          const allowed = Boolean(r.result);
          result[address] = allowed;
          cache.set(address, { at: Date.now(), allowed });
        }
        // failure → leave as false (fail closed), don't cache the miss
      });
    } catch {
      // Multicall unavailable — fall back to individual reads, still fail closed.
      await Promise.all(
        misses.map(async (address) => {
          try {
            const allowed = Boolean(
              await publicClient.readContract({
                address: SETTLEMENT_CONTRACT_ADDRESS,
                abi: settlementAbi,
                functionName: "isCollectionAllowed",
                args: [address as Address],
              }),
            );
            result[address] = allowed;
            cache.set(address, { at: Date.now(), allowed });
          } catch {
            // leave false
          }
        }),
      );
    }
  }

  return NextResponse.json({ allowed: result });
}
