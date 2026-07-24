import { createPublicClient, fallback, http } from "viem";
import { ethereum, ETH_MAINNET_RPC_URLS } from "@/lib/chains/ethereum";

function serverRpcUrls(): string[] {
  const configured = (process.env.ETH_MAINNET_RPC_URLS ?? process.env.ETH_MAINNET_RPC_URL ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("https://"));
  return Array.from(new Set([...configured, ...ETH_MAINNET_RPC_URLS]));
}

export const publicClient = createPublicClient({
  chain: ethereum,
  transport: fallback(serverRpcUrls().map((url) => http(url))),
});
