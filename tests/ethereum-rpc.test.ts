import { describe, expect, it } from "vitest";
import { ETH_MAINNET_CHAIN_ID, ETH_MAINNET_EXPLORER_URL, ETH_MAINNET_RPC_URLS, ethereum } from "@/lib/chains/ethereum";
describe("Ethereum mainnet configuration", () => {
 it("is mainnet-only and has no invented RPC", () => {
  expect(ETH_MAINNET_CHAIN_ID).toBe(1); expect(ethereum.id).toBe(1);
  expect(ETH_MAINNET_EXPLORER_URL).toBe("https://etherscan.io");
  expect(ETH_MAINNET_RPC_URLS.length).toBe(process.env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL ? 1 : 0);
 });
});
