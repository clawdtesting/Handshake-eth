/**
 * Alchemy host builders shared by the Burnt stats engine and the token route.
 *
 * The NFT API and the JSON-RPC core API live on the SAME host for a chain —
 * `eth-mainnet.g.alchemy.com` — and differ only by path (`/nft/v3` vs `/v2`).
 * `ethereum-mainnet.g.alchemy.com` does NOT resolve (it returns "fetch
 * failed"), so any `ethereum-` prefixed slug is normalised to `eth-`.
 */

export const ALCHEMY_NETWORK = (
  process.env.ALCHEMY_NETWORK ?? "eth-mainnet"
).replace(/^ethereum-/, "eth-");

function requireKey(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set");
  return key;
}

/** Base URL for the Alchemy NFT API v3, key included. */
export function nftBase(): string {
  return `https://${ALCHEMY_NETWORK}.g.alchemy.com/nft/v3/${requireKey()}`;
}

/** JSON-RPC endpoint for the Alchemy core API (getAssetTransfers, etc.). */
export function rpcUrl(): string {
  return `https://${ALCHEMY_NETWORK}.g.alchemy.com/v2/${requireKey()}`;
}
