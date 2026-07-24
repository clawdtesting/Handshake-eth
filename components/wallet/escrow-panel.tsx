"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseEther } from "viem";
import { toast } from "sonner";
import { Loader2, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ETH_MAINNET_CHAIN_ID, SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { settlementAbi } from "@/lib/contracts/settlement";
import { runWrite } from "@/lib/chains/tx";
import { formatEth } from "@/lib/utils";

/**
 * Self-managed ETH escrow on the settlement contract. Funds maker-side
 * ETH legs of deals and holds sale proceeds until users claim them; fully
 * user-controlled (deposit/withdraw anytime).
 */
export function EscrowPanel() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [working, setWorking] = useState<"deposit" | "withdraw" | null>(null);

  const balanceQuery = useQuery({
    queryKey: ["escrow-balance", address],
    enabled: !!address && !!publicClient,
    queryFn: () =>
      publicClient!.readContract({
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "escrowBalance",
        args: [address!],
      }),
  });

  function parsedAmount(): bigint | null {
    try {
      const wei = parseEther(amount);
      return wei > 0n ? wei : null;
    } catch {
      return null;
    }
  }

  async function run(action: "deposit" | "withdraw") {
    if (!publicClient || !address) return;
    const wei = parsedAmount();
    if (!wei) {
      toast.error("Enter a valid ETH amount");
      return;
    }
    if (action === "withdraw" && wei > (balanceQuery.data ?? 0n)) {
      toast.error("Amount exceeds your escrow balance");
      return;
    }
    setWorking(action);
    try {
      await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: action === "deposit" ? "Deposit escrow" : "Withdraw escrow",
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: action,
        ...(action === "deposit"
          ? { value: wei }
          : { args: [wei] as const }),
        onSubmitted: () =>
          toast.info(action === "deposit" ? "Depositing…" : "Withdrawing…"),
      });
      toast.success(
        action === "deposit"
          ? `Deposited ${formatEth(wei)} ETH to escrow`
          : `Withdrew ${formatEth(wei)} ETH from escrow`
      );
      setAmount("");
      balanceQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message ?? `${action} failed`);
    } finally {
      setWorking(null);
    }
  }

  if (!address) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Vault className="h-4 w-4 text-ethereum-purple" /> ETH escrow
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Funds the ETH side of deals you propose and receives ETH proceeds from
          completed sales. Only you can deposit or withdraw — the platform has
          no access.
        </p>
        <p className="text-2xl font-bold text-ethereum-purple">
          {balanceQuery.isLoading
            ? "…"
            : `${formatEth(balanceQuery.data ?? 0n)} ETH`}
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="0.0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={working !== null}
            onClick={() => run("deposit")}
          >
            {working === "deposit" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Deposit"
            )}
          </Button>
          <Button
            variant="outline"
            disabled={working !== null}
            onClick={() => run("withdraw")}
          >
            {working === "withdraw" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Withdraw"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}