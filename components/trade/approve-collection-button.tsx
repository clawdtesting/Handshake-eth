"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ETH_MAINNET_CHAIN_ID, SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { erc721Abi } from "@/lib/contracts/settlement";
import { runWrite } from "@/lib/chains/tx";
import { COLLECTION_APPROVALS_KEY } from "@/hooks/use-approvals";
import type { Address } from "viem";

/**
 * One-click setApprovalForAll(settlement, true) for a single collection, so a
 * collection can be re-approved for trading outside the offer picker (e.g.
 * approvals made against a previous settlement contract). Refreshes the
 * approval dots on success.
 */
export function ApproveCollectionButton({
  collectionAddress,
  size = "sm",
  className,
  onApproved,
}: {
  collectionAddress: string;
  size?: "sm" | "md";
  className?: string;
  onApproved?: () => void;
}) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function approve() {
    if (!address || !publicClient) {
      toast.error("Connect your wallet first");
      return;
    }
    if (chainId !== ETH_MAINNET_CHAIN_ID) {
      toast.error("Switch to the Ethereum network first");
      return;
    }
    if (
      SETTLEMENT_CONTRACT_ADDRESS ===
      "0x0000000000000000000000000000000000000000"
    ) {
      toast.error("Settlement contract is not configured");
      return;
    }

    setPending(true);
    try {
      await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: "Approve collection",
        address: collectionAddress as Address,
        abi: erc721Abi,
        functionName: "setApprovalForAll",
        args: [SETTLEMENT_CONTRACT_ADDRESS, true] as const,
      });
      queryClient.invalidateQueries({ queryKey: [COLLECTION_APPROVALS_KEY] });
      toast.success("Collection approved for trading");
      onApproved?.();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to approve collection");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      size={size === "sm" ? "sm" : "default"}
      variant="secondary"
      className={className}
      disabled={pending}
      onClick={approve}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Approving…
        </>
      ) : (
        "Approve for trading"
      )}
    </Button>
  );
}
