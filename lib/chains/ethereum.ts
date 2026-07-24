import { defineChain } from "viem";
export const ETH_MAINNET_CHAIN_ID = 1;
const configuredRpc = process.env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL;
export const ETH_MAINNET_RPC_URLS = configuredRpc ? [configuredRpc] : [];
export const ETH_MAINNET_RPC_URL = configuredRpc ?? "";
export const ETH_MAINNET_EXPLORER_URL = "https://etherscan.io";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ETH = { name: "Ether", symbol: "ETH", decimals: 18 } as const;
export const ethereum = defineChain({ id: 1, name: "Ethereum Mainnet", nativeCurrency: ETH,
  rpcUrls: { default: { http: ETH_MAINNET_RPC_URLS } },
  blockExplorers: { default: { name: "Etherscan", url: ETH_MAINNET_EXPLORER_URL } } });
export const SETTLEMENT_CONTRACT_ADDRESS = (/^0x[0-9a-fA-F]{40}$/.test(process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS ?? "") ? process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS : ZERO_ADDRESS) as `0x${string}`;
export const explorerTxUrl = (hash:string) => `${ETH_MAINNET_EXPLORER_URL}/tx/${hash}`;
export const explorerAddressUrl = (address:string) => `${ETH_MAINNET_EXPLORER_URL}/address/${address}`;
export const explorerTokenUrl = (contract:string, tokenId?:string) => tokenId ? `${ETH_MAINNET_EXPLORER_URL}/token/${contract}?a=${tokenId}` : `${ETH_MAINNET_EXPLORER_URL}/token/${contract}`;
