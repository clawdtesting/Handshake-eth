import { NextResponse } from "next/server";
import { publicClient } from "@/lib/chains/client";
import {
  ETH_MAINNET_CHAIN_ID,
  SETTLEMENT_CONTRACT_ADDRESS,
} from "@/lib/chains/ethereum";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Operational health check. Fails (503) if the deployment is misconfigured
 * in a way that would silently degrade safety: zero settlement address,
 * chain-id/RPC mismatch, missing contract bytecode, or no DB connectivity.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    settlementConfigured:
      SETTLEMENT_CONTRACT_ADDRESS !==
      "0x0000000000000000000000000000000000000000",
    chainMatches: false,
    settlementDeployed: false,
    database: false,
  };

  try {
    const chainId = await publicClient.getChainId();
    checks.chainMatches = chainId === ETH_MAINNET_CHAIN_ID;
  } catch {
    checks.chainMatches = false;
  }

  if (checks.settlementConfigured) {
    try {
      const code = await publicClient.getCode({
        address: SETTLEMENT_CONTRACT_ADDRESS,
      });
      checks.settlementDeployed = !!code && code !== "0x";
    } catch {
      checks.settlementDeployed = false;
    }
  }

  try {
    const db = getServiceClient();
    const { error } = await db.from("trade_offers").select("id").limit(1);
    checks.database = !error;
  } catch {
    checks.database = false;
  }

  const healthy = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { healthy, chainId: ETH_MAINNET_CHAIN_ID, checks },
    { status: healthy ? 200 : 503 }
  );
}
