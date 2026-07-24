"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import { Button } from "@/components/ui/button";

export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === ETH_MAINNET_CHAIN_ID) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
      <div className="container mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Handshake deals settle on Ethereum. Switch networks before signing or accepting.
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={() => switchChain({ chainId: ETH_MAINNET_CHAIN_ID })}
        >
          {isPending ? "Switching…" : "Switch to Ethereum"}
        </Button>
      </div>
    </div>
  );
}