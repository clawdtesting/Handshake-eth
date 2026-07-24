"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { type Address } from "viem";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, ExternalLink, Loader2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NFTCard } from "@/components/trade/nft-card";
import { FeeBreakdown } from "@/components/trade/fee-breakdown";
import { EmptyState } from "@/components/empty-state";
import { SuggestChangesButton } from "@/components/deal-room/suggest-changes-button";
import { useOffer } from "@/hooks/use-market";
import { useDealHealth } from "@/hooks/use-deal-health";
import {
  explorerTokenUrl,
  explorerTxUrl,
  ETH_MAINNET_CHAIN_ID,
  SETTLEMENT_CONTRACT_ADDRESS,
} from "@/lib/chains/ethereum";
import { erc721Abi, settlementAbi } from "@/lib/contracts/settlement";
import { runWrite } from "@/lib/chains/tx";
import { ZERO_ADDRESS } from "@/lib/orders/eip712";
import { isCollectionBid } from "@/lib/collection-bids";
import { quoteFees } from "@/lib/fees";
import { formatEth, rarityRankBadgeClass, shortAddress, timeUntil } from "@/lib/utils";
import type { TradeOffer } from "@/lib/types";

const statusVariant = {
  open: "default",
  completed: "success",
  cancelled: "destructive",
  expired: "warning",
} as const;

const statusLabel = {
  open: "Open Deal",
  completed: "Handshake Completed",
  cancelled: "Deal Cancelled",
  expired: "Deal Expired",
} as const;

export default function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: offer, isLoading, refetch } = useOffer(id);
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [working, setWorking] = useState<
    "accept" | "cancel" | "approve" | "deposit" | "withdraw" | null
  >(null);

  /**
   * Refresh everything a settled/cancelled deal invalidates: this offer, the
   * public/dashboard feeds, the wallet's NFT ownership, escrow balances, and
   * notifications. Keeps the UI from showing stale ownership/approval data.
   */
  function refreshAfterTx() {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["offers"] });
    queryClient.invalidateQueries({ queryKey: ["incoming-offers"] });
    queryClient.invalidateQueries({ queryKey: ["wallet-nfts"] });
    queryClient.invalidateQueries({ queryKey: ["wallet-nfts-infinite"] });
    queryClient.invalidateQueries({ queryKey: ["escrow-balance"] });
    queryClient.invalidateQueries({ queryKey: ["escrow-status"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  }

  const proceedsQuery = useQuery({
    queryKey: ["claimable-proceeds", offer?.id, address],
    enabled:
      !!offer && !!address && !!publicClient && offer.status === "completed",
    queryFn: () =>
      publicClient!.readContract({
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "escrowBalance",
        args: [address! as Address],
      }),
  });

  // Pre-flight: read on-chain preconditions so a doomed accept is caught with
  // a specific reason instead of a generic "would revert" after the fact.
  const dealHealth = useDealHealth(offer, address);

  const escrowQuery = useQuery({
    queryKey: ["escrow-status", offer?.id, address],
    enabled:
      !!offer &&
      !!publicClient &&
      offer.status === "open" &&
      BigInt(offer.makerEthAmount) > 0n,
    queryFn: async () => {
      const balance = await publicClient!.readContract({
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "escrowBalance",
        args: [offer!.makerAddress as Address],
      });

      const required = quoteFees(
        BigInt(offer!.makerEthAmount),
        0n,
        BigInt(offer!.feeBps)
      ).makerEscrowRequired;

      return {
        balance,
        required,
        shortfall: balance >= required ? 0n : required - balance,
      };
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-10">
        <Skeleton className="mb-6 h-10 w-64" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="container mx-auto px-4 py-20">
        <EmptyState title="Deal not found" body="This deal does not exist." />
      </div>
    );
  }

  const makerNfts = offer.nfts.filter((n) => n.side === "maker");
  const takerNfts = offer.nfts.filter((n) => n.side === "taker");
  const makerEth = BigInt(offer.makerEthAmount);
  const takerEth = BigInt(offer.takerEthAmount);
  const connectedAddress = address?.toLowerCase();
  const expectedProceeds =
    connectedAddress === offer.makerAddress.toLowerCase()
      ? takerEth
      : connectedAddress === (offer.takerAddress ?? "").toLowerCase()
        ? makerEth
        : 0n;
  const claimableProceeds =
    offer.status === "completed" && expectedProceeds > 0n
      ? expectedProceeds < (proceedsQuery.data ?? 0n)
        ? expectedProceeds
        : (proceedsQuery.data ?? 0n)
      : 0n;
  const hasCollectionBid = takerNfts.some(isCollectionBid);
  const isMaker = address?.toLowerCase() === offer.makerAddress.toLowerCase();
  const isDesignatedTaker =
    !offer.takerAddress || address?.toLowerCase() === offer.takerAddress.toLowerCase();
  const isExpired = offer.expiry * 1000 < Date.now();
  const offerChainId = Number(offer.chainId);
  const isWrongOfferChain = offerChainId !== ETH_MAINNET_CHAIN_ID;
  const isWrongWalletChain = !!address && chainId !== ETH_MAINNET_CHAIN_ID;
  const takerFeeQuote = quoteFees(
    makerEth,
    takerEth,
    BigInt(offer.feeBps),
    BigInt(offer.flatFee)
  );
  const showAcceptAction =
    offer.status === "open" &&
    !!address &&
    !isMaker &&
    isDesignatedTaker &&
    !hasCollectionBid;
  const dealBlockers = dealHealth.data?.blockers ?? [];
  const hasDealBlocker = dealBlockers.length > 0;
  const canAccept =
    showAcceptAction &&
    !isExpired &&
    !isWrongOfferChain &&
    !isWrongWalletChain &&
    !hasDealBlocker;

  function buildOrder(o: TradeOffer) {
    return {
      maker: o.makerAddress as Address,
      taker: (o.takerAddress ?? ZERO_ADDRESS) as Address,
      makerNFTs: o.nfts
        .filter((n) => n.side === "maker")
        .map((n) => ({
          contractAddress: n.contractAddress as Address,
          tokenId: BigInt(n.tokenId),
        })),
      takerNFTs: o.nfts
        .filter((n) => n.side === "taker")
        .map((n) => ({
          contractAddress: n.contractAddress as Address,
          tokenId: BigInt(n.tokenId),
        })),
      makerEthAmount: BigInt(o.makerEthAmount),
      takerEthAmount: BigInt(o.takerEthAmount),
      feeBps: BigInt(o.feeBps),
      flatFee: BigInt(o.flatFee),
      nonce: BigInt(o.nonce),
      expiry: BigInt(o.expiry),
    };
  }

  async function ensureApprovals(o: TradeOffer, side: "maker" | "taker") {
    if (!publicClient || !address) return;

    const contracts = Array.from(
      new Set(
        o.nfts
          .filter((n) => n.side === side)
          // collection-wide bids have no concrete token to approve
          .filter((n) => !isCollectionBid(n))
          .map((n) => n.contractAddress.toLowerCase())
      )
    );

    for (const contract of contracts) {
      const approved = await publicClient.readContract({
        address: contract as Address,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [address, SETTLEMENT_CONTRACT_ADDRESS],
      });

      if (!approved) {
        toast.info(
          `Approving ${shortAddress(contract)}: this grants the settlement contract permission to transfer NFTs in this collection when a deal you signed or accepted executes. Revocable anytime.`
        );

        await runWrite({
          publicClient,
          writeContractAsync,
          account: address,
          walletChainId: chainId,
          expectedChainId: ETH_MAINNET_CHAIN_ID,
          label: `Approve ${shortAddress(contract)}`,
          address: contract as Address,
          abi: erc721Abi,
          functionName: "setApprovalForAll",
          args: [SETTLEMENT_CONTRACT_ADDRESS, true] as const,
        });
      }
    }
  }

  async function handleDeposit() {
    if (!offer || !publicClient || !address || !escrowQuery.data) return;

    setWorking("deposit");
    try {
      await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: "Deposit escrow",
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "deposit",
        value: escrowQuery.data.shortfall,
        onSubmitted: () => toast.info("Depositing escrow…"),
      });

      toast.success("Escrow funded — your deal is now fillable");
      escrowQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["escrow-balance"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Deposit failed");
    } finally {
      setWorking(null);
    }
  }

  async function handleMakerApprove() {
    if (!offer) return;

    setWorking("approve");
    try {
      await ensureApprovals(offer, "maker");
      toast.success("Your NFTs are approved for settlement");
    } catch (err: any) {
      toast.error(err?.message ?? "Approval failed");
    } finally {
      setWorking(null);
    }
  }

  async function handleAccept() {
    if (!offer || !publicClient || !address) return;

    setWorking("accept");
    try {
      // Taker must approve their requested NFTs before settlement can simulate.
      await ensureApprovals(offer, "taker");

      const { hash } = await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: "Accept deal",
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "fulfillTrade",
        args: [buildOrder(offer), offer.signature as `0x${string}`],
        value: takerFeeQuote.takerPays,
        onSubmitted: () => toast.info("Executing trade on-chain…"),
      });

      const res = await fetch(`/api/offers/${offer.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash, takerAddress: address }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Trade executed but handshake update failed");
      }

      toast.success(
        "Handshake completed 🎉 ETH proceeds are now withdrawable from escrow."
      );
      refreshAfterTx();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to execute trade");
    } finally {
      setWorking(null);
    }
  }

  async function handleClaimProceeds() {
    if (!publicClient || !address || claimableProceeds <= 0n) return;

    setWorking("withdraw");
    try {
      await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: "Claim proceeds",
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "withdraw",
        args: [claimableProceeds],
        onSubmitted: () => toast.info("Claiming proceeds…"),
      });
      toast.success(`Claimed ${formatEth(claimableProceeds)} ETH proceeds`);
      proceedsQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["escrow-balance"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to claim proceeds");
    } finally {
      setWorking(null);
    }
  }

  async function handleCancel() {
    if (!offer || !publicClient || !address) return;

    setWorking("cancel");
    try {
      const { hash } = await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: "Cancel deal",
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "cancelNonce",
        args: [BigInt(offer.nonce)],
        onSubmitted: () => toast.info("Cancelling on-chain…"),
      });

      const res = await fetch(`/api/offers/${offer.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash, walletAddress: address }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Cancelled on-chain but status update failed");
      }

      toast.success("Deal cancelled");
      refreshAfterTx();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to cancel");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Deal</h1>
        <Badge variant={statusVariant[offer.status]}>
          {statusLabel[offer.status]}
        </Badge>
        {offer.requiredMaxRarityRank != null && (
          <Badge
            variant="outline"
            className={rarityRankBadgeClass(offer.requiredMaxRarityRank)}
          >
            Top {offer.requiredMaxRarityRank.toLocaleString()}
          </Badge>
        )}
        {offer.isPrivate && (
          <Badge variant="secondary">
            <Lock className="mr-1 h-3 w-3" /> private
          </Badge>
        )}
        {offer.dealRoomId && (
          <a
            href={`/rooms/${offer.dealRoomId}`}
            className="inline-flex items-center rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-2.5 py-0.5 text-xs font-medium text-ethereum-purple hover:bg-ethereum-purple/20"
          >
            🤝 Negotiated in a Deal Room
          </a>
        )}
        {offer.status === "open" && !isExpired && (
          <span className="text-sm text-muted-foreground">
            expires in {timeUntil(offer.expiry)}
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
          <SideCard
            title={`Maker gives — ${shortAddress(offer.makerAddress)}`}
            nfts={makerNfts}
            eth={makerEth}
          />
          <div className="flex justify-center pt-10">
            <ArrowLeftRight className="h-6 w-6 text-ethereum-purple" />
          </div>
          <SideCard
            title={
              offer.takerAddress
                ? `Taker gives — ${shortAddress(offer.takerAddress)}`
                : "Taker gives — anyone"
            }
            nfts={takerNfts}
            eth={takerEth}
          />
        </div>

        <div className="space-y-4">
          <FeeBreakdown
            makerEthAmount={makerEth}
            takerEthAmount={takerEth}
            feeBps={BigInt(offer.feeBps)}
            flatSwapFee={BigInt(offer.flatFee)}
          />

          {showAcceptAction && (
            <>
              {hasDealBlocker && (
                <div className="space-y-1.5 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    This deal can&apos;t be settled right now
                  </div>
                  <ul className="ml-1 list-inside list-disc space-y-1 text-red-200/90">
                    {dealBlockers.map((b) => (
                      <li key={b.code}>{b.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {takerNfts.length > 0 && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  Accepting first approves the settlement contract to transfer
                  the requested NFT(s) from your wallet — this is a collection-wide{" "}
                  <code>setApprovalForAll</code> that stays until you revoke it.
                  Only the exact NFTs in this signed deal move now; settlement is
                  simulated before you pay any gas.
                </p>
              )}
              <Button
                className="w-full"
                size="lg"
                disabled={!canAccept || working !== null}
                onClick={handleAccept}
              >
                {working === "accept" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Settling…
                  </>
                ) : (
                  takerFeeQuote.takerPays > 0n
                    ? `Accept & pay ${formatEth(takerFeeQuote.takerPays)} ETH`
                    : "Accept Deal"
                )}
              </Button>
              {!canAccept && !hasDealBlocker && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                  {isExpired
                    ? "This deal has expired and can no longer be accepted."
                    : isWrongOfferChain
                      ? `This deal was signed for chain ${offerChainId} and can't be settled on chain ${ETH_MAINNET_CHAIN_ID}.`
                      : isWrongWalletChain
                        ? `Switch your wallet to Ethereum (chain ${ETH_MAINNET_CHAIN_ID}) to accept and pay for this deal.`
                        : "This deal can't be accepted right now."}
                </p>
              )}
              <SuggestChangesButton offer={offer} viewer={address!} />
              <p className="text-center text-xs text-muted-foreground">
                Want different terms? Open a private Deal Room — drafts are
                free and can never move assets.
              </p>
            </>
          )}

          {address &&
            offer.status === "open" &&
            !isMaker &&
            !isDesignatedTaker && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                This private deal is reserved for {shortAddress(offer.takerAddress ?? "")}.
                Connect that wallet to accept and pay for it.
              </p>
            )}

          {hasCollectionBid && offer.status === "open" && !isMaker && (
            <div className="space-y-3 rounded-lg border border-ethereum-purple/30 bg-ethereum-purple/10 p-3 text-sm text-foreground">
              <p>
                This is a collection-wide buy deal. The maker is offering ETH
                for any matching NFT in the requested collection, so choose one
                of your NFTs and send them a private deal to complete the
                handshake.
              </p>
              <a
                href={`/create?taker=${offer.makerAddress}&private=1`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Propose Private Deal
              </a>
            </div>
          )}

          {offer.status === "open" &&
            escrowQuery.data &&
            escrowQuery.data.shortfall > 0n && (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                <p>
                  This deal needs {formatEth(escrowQuery.data.required)} ETH in
                  maker escrow ({formatEth(escrowQuery.data.balance)} funded).
                  {!isMaker && " It can't be accepted until the maker deposits."}
                </p>
                {isMaker && (
                  <Button
                    className="w-full"
                    disabled={working !== null}
                    onClick={handleDeposit}
                  >
                    {working === "deposit" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Depositing…
                      </>
                    ) : (
                      `Deposit ${formatEth(escrowQuery.data.shortfall)} ETH escrow`
                    )}
                  </Button>
                )}
              </div>
            )}

          {isMaker && offer.status === "open" && makerNfts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Approval grants the settlement contract permission to transfer
                NFTs in the offered collection(s) — a collection-wide{" "}
                <code>setApprovalForAll</code> that stays until you revoke it.
                Nothing moves until a taker accepts and settles this signed deal.
              </p>
              <Button
                className="w-full"
                variant="secondary"
                disabled={working !== null}
                onClick={handleMakerApprove}
              >
                {working === "approve" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Approving…
                  </>
                ) : (
                  "Approve my NFTs for settlement"
                )}
              </Button>
            </div>
          )}

          {isMaker && offer.status === "open" && (
            <Button
              className="w-full"
              variant="destructive"
              disabled={working !== null}
              onClick={handleCancel}
            >
              {working === "cancel" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
                </>
              ) : (
                "Cancel Deal (on-chain)"
              )}
            </Button>
          )}

          {isWrongOfferChain && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
              This deal was signed for chain {offer.chainId} and can&apos;t be
              settled on chain {ETH_MAINNET_CHAIN_ID}.
            </p>
          )}

          {!address && offer.status === "open" && (
            <p className="text-sm text-muted-foreground">
              Connect your wallet to accept this deal.
            </p>
          )}

          {offer.status === "completed" && expectedProceeds > 0n && address && (
            <div className="space-y-3 rounded-lg border border-ethereum-purple/30 bg-ethereum-purple/10 p-3 text-sm text-foreground">
              <div className="space-y-1">
                <p className="font-semibold text-ethereum-purple">
                  Claim sale proceeds
                </p>
                <p className="text-muted-foreground">
                  Settlement credited {formatEth(expectedProceeds)} ETH to your
                  withdrawable escrow balance instead of sending a direct wallet
                  transfer. Claim it here when you want the ETH in your wallet.
                </p>
              </div>
              {claimableProceeds > 0n ? (
                <Button
                  className="w-full"
                  disabled={working !== null}
                  onClick={handleClaimProceeds}
                >
                  {working === "withdraw" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Claiming…
                    </>
                  ) : (
                    `Claim ${formatEth(claimableProceeds)} ETH proceeds`
                  )}
                </Button>
              ) : (
                <p className="rounded-md border border-border/70 bg-background/50 p-2 text-xs text-muted-foreground">
                  No claimable proceeds detected for this sale right now. If you
                  already withdrew from escrow, the proceeds may already be in
                  your wallet.
                </p>
              )}
            </div>
          )}

          {offer.completedTxHash && (
            <TxLink label="Settlement transaction" hash={offer.completedTxHash} />
          )}
          {offer.cancelledTxHash && (
            <TxLink label="Cancellation transaction" hash={offer.cancelledTxHash} />
          )}
        </div>
      </div>
    </div>
  );
}

function SideCard({
  title,
  nfts,
  eth,
}: {
  title: string;
  nfts: TradeOffer["nfts"];
  eth: bigint;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {nfts.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {nfts.map((nft) => (
              <div key={nft.id} className="space-y-1">
                <NFTCard nft={nft} />
                {isCollectionBid(nft) ? (
                  <p className="text-[11px] text-muted-foreground">
                    Any token from {shortAddress(nft.contractAddress)}
                  </p>
                ) : (
                  <a
                    href={explorerTokenUrl(nft.contractAddress, nft.tokenId)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-ethereum-purple"
                    title={nft.contractAddress}
                  >
                    {shortAddress(nft.contractAddress)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No NFTs</p>
        )}

        {eth > 0n && (
          <p className="text-lg font-semibold text-ethereum-purple">
            + {formatEth(eth)} ETH
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TxLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 text-sm text-ethereum-purple hover:underline"
    >
      {label} <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}