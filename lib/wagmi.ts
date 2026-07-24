"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { ethereum, ETH_MAINNET_RPC_URLS } from "@/lib/chains/ethereum";

// Show the Ethereum logo as the chain icon in the wallet/connect button.
const ethereumWithIcon = {
  ...ethereum,
  iconUrl: "/Logomark.svg",
  iconBackground: "#0E100F",
};

export const wagmiConfig = getDefaultConfig({
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Handshake",
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "handshake-dev",
  chains: [ethereumWithIcon],
  transports: {
    [ethereum.id]: http(ETH_MAINNET_RPC_URLS[0]),
  },
  ssr: true,
});
