import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";

/**
 * Client-safe half of the Deal Room session: the sign-in message the wallet
 * signs and its freshness rule. The server-only half (HMAC token issue/verify)
 * lives in ./session.ts — it uses node:crypto and must never be bundled for
 * the browser.
 */

export const SESSION_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

export function buildSessionMessage(p: {
  walletAddress: string;
  timestamp: number;
}): string {
  return [
    "Handshake — Sign in to Deal Rooms",
    "This signature only proves wallet ownership.",
    "It does NOT approve, transfer, or trade any asset.",
    `Wallet: ${p.walletAddress.toLowerCase()}`,
    `Chain: ${ETH_MAINNET_CHAIN_ID}`,
    `Timestamp: ${p.timestamp}`,
  ].join("\n");
}

export function sessionTimestampFresh(
  timestamp: number,
  now: number = Date.now()
): boolean {
  return (
    Number.isFinite(timestamp) &&
    Math.abs(now - timestamp) <= SESSION_SIGNATURE_MAX_SKEW_MS
  );
}
