import { NextResponse } from "next/server";
import {
  ETH_MAINNET_CHAIN_ID,
  ETH_MAINNET_EXPLORER_URL,
  SETTLEMENT_CONTRACT_ADDRESS,
} from "@/lib/chains/ethereum";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Handshake",
    chainId: ETH_MAINNET_CHAIN_ID,
    explorerUrl: ETH_MAINNET_EXPLORER_URL,
    settlementContract: SETTLEMENT_CONTRACT_ADDRESS,
    feeBps: 100,
    nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  });
}
