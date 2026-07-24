"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, PenLine, ShieldCheck, Timer } from "lucide-react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generateNonce,
  getOrderDomain,
  ORDER_TYPES,
  type TradeOrder,
} from "@/lib/orders/eip712";
import { ETH_MAINNET_CHAIN_ID, SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { settlementAbi } from "@/lib/contracts/settlement";
import { runWrite } from "@/lib/chains/tx";
import { shortAddress } from "@/lib/utils";
import { useRoomMutations } from "@/hooks/use-deal-rooms";
import type { ReadinessReport } from "@/lib/deal-rooms/readiness";
import type { DealRoomDetail, TradeOffer } from "@/lib/types";

/**
 * The finale. Once both sides agree:
 *  - If the room replaces a live signed offer, the maker first retires its
 *    nonce on-chain (mandatory — two executable versions must never coexist).
 *  - The maker signs ONE EIP-712 TradeOrder matching the agreed terms.
 *  - The taker settles it through the existing offer flow.
 * When settled, shows the signed→settled stopwatch — Ethereum's finality is the
 * demo.
 */
export function FinalizePanel({
  room,
  sourceOffer,
  readiness,
  viewerWallet,
}: {
  room: DealRoomDetail;
  sourceOffer: TradeOffer | null;
  readiness: ReadinessReport | undefined;
  viewerWallet: string;
}) {
  const revision = room.currentRevision;
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { finalize, invalidate, cancel } = useRoomMutations(room.id);
  const [working, setWorking] = useState<null | "cancel-source" | "sign">(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  async function handleBackOut() {
    try {
      await cancel.mutateAsync({ expectedVersion: room.version });
      toast.success("You backed out — the deal is off");
      setConfirmingCancel(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to cancel the deal");
    }
  }

  if (!revision) return null;

  const viewer = viewerWallet.toLowerCase();
  const isMaker = revision.makerAddress.toLowerCase() === viewer;
  const counterparty =
    room.participantA === viewer ? room.participantB : room.participantA;

  const sourceGate = readiness?.checks.find(
    (c) => c.id === "source-nonce-retired"
  );
  const sourceNeedsCancel = sourceGate?.status === "action_required";
  const sourceIsMine =
    !!sourceOffer && sourceOffer.makerAddress.toLowerCase() === viewer;

  async function handleCancelSource() {
    if (!sourceOffer || !publicClient || !address) return;
    setWorking("cancel-source");
    try {
      const { hash } = await runWrite({
        publicClient,
        writeContractAsync,
        account: address,
        walletChainId: chainId,
        expectedChainId: ETH_MAINNET_CHAIN_ID,
        label: "Retire original offer",
        address: SETTLEMENT_CONTRACT_ADDRESS,
        abi: settlementAbi,
        functionName: "cancelNonce",
        args: [BigInt(sourceOffer.nonce)],
        onSubmitted: () => toast.info("Retiring the original offer on-chain…"),
      });
      const res = await fetch(`/api/offers/${sourceOffer.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash, walletAddress: address }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? "Cancelled on-chain but status update failed"
        );
      }
      toast.success("Original offer retired — only the new deal can settle now");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to retire the original offer");
    } finally {
      setWorking(null);
    }
  }

  async function handleSign() {
    if (!revision || !address) return;
    setWorking("sign");
    try {
      const order: TradeOrder = {
        maker: revision.makerAddress as `0x${string}`,
        taker: revision.takerAddress as `0x${string}`,
        makerNFTs: revision.makerNFTs.map((n) => ({
          standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress as `0x${string}`,
          tokenId: BigInt(n.tokenId),
        })),
        takerNFTs: revision.takerNFTs.map((n) => ({
          standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress as `0x${string}`,
          tokenId: BigInt(n.tokenId),
        })),
        makerEthAmount: BigInt(revision.makerEthAmount),
        takerEthAmount: BigInt(revision.takerEthAmount),
        feeBps: BigInt(revision.feeBps),
        flatFee: BigInt(revision.flatFee),
        nonce: generateNonce(),
        expiry: BigInt(revision.offerExpiry),
      };

      const signature = await signTypedDataAsync({
        domain: getOrderDomain(),
        types: ORDER_TYPES,
        primaryType: "TradeOrder",
        message: order,
      });

      await finalize.mutateAsync({
        expectedVersion: room.version,
        order: {
          maker: order.maker,
          taker: order.taker,
          makerNFTs: order.makerNFTs.map((n) => ({
            standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress,
            tokenId: n.tokenId.toString(),
          })),
          takerNFTs: order.takerNFTs.map((n) => ({
            standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress,
            tokenId: n.tokenId.toString(),
          })),
          makerEthAmount: order.makerEthAmount.toString(),
          takerEthAmount: order.takerEthAmount.toString(),
          feeBps: order.feeBps.toString(),
          flatFee: order.flatFee.toString(),
          nonce: order.nonce.toString(),
          expiry: order.expiry.toString(),
        },
        signature,
      });
      toast.success("Final deal signed — waiting for the other side to settle");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to sign the final deal");
    } finally {
      setWorking(null);
    }
  }

  // ---- settled: show the stopwatch -----------------------------------
  if (room.status === "settled") {
    const elapsed =
      room.signedAt && room.settledAt
        ? (new Date(room.settledAt).getTime() -
            new Date(room.signedAt).getTime()) /
          1000
        : null;
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="text-3xl">🤝</div>
          <div className="text-lg font-semibold">Handshake settled on-chain</div>
          {elapsed !== null && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-400">
              <Timer className="h-4 w-4" />
              Signed → settled in {elapsed < 60 ? `${elapsed.toFixed(1)}s` : `${Math.round(elapsed / 60)}m`}
            </div>
          )}
          {room.finalOfferId && (
            <Link
              href={`/offers/${room.finalOfferId}`}
              className="text-sm text-ethereum-purple underline-offset-4 hover:underline"
            >
              View the settled deal
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  // ---- signed: taker settles via the existing offer flow -------------
  if (room.status === "signed" && room.finalOfferId) {
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            Final deal signed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isMaker
              ? `Waiting for ${shortAddress(counterparty)} to settle. The signed offer is private and only they can accept it.`
              : "The agreed terms are signed and reserved for your wallet. Settle to complete the handshake — everything transfers in one atomic transaction."}
          </p>
          <Link
            href={`/offers/${room.finalOfferId}`}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-ethereum-purple to-fuchsia-400 px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-ethereum-purple/20 hover:from-ethereum-purple/90 hover:to-fuchsia-400/90"
          >
            {isMaker ? "View signed offer" : "Settle the handshake"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  // ---- agreed: maker signs (after the source gate clears) ------------
  if (room.status !== "agreed") return null;

  return (
    <Card className="border-ethereum-purple/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PenLine className="h-4 w-4 text-ethereum-purple" />
          Terms agreed — make it official
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sourceNeedsCancel && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-400">
              The original signed offer is still executable.
            </p>
            <p className="mt-1 text-muted-foreground">
              Retire its nonce first so only one version of this deal can ever
              settle.
            </p>
            {sourceIsMine ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={working !== null}
                onClick={handleCancelSource}
              >
                {working === "cancel-source"
                  ? "Retiring…"
                  : "Retire original offer"}
              </Button>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Waiting for {shortAddress(sourceOffer?.makerAddress ?? "")} to
                retire it.
              </p>
            )}
          </div>
        )}

        {isMaker ? (
          <>
            <p className="text-sm text-muted-foreground">
              You are signing one executable Handshake order for exactly the
              agreed terms, reserved for {shortAddress(counterparty)}. Review
              the terms above — a completed trade cannot be reversed.
            </p>
            <Button
              className="w-full"
              disabled={working !== null || sourceNeedsCancel}
              onClick={handleSign}
            >
              {working === "sign" ? "Waiting for wallet…" : "Sign final deal"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Waiting for {shortAddress(revision.makerAddress)} to sign the final
            deal. You&apos;ll settle it right after — one atomic transaction.
          </p>
        )}

        {/* Back out — nothing is signed or on-chain yet, so either side can
            still walk away before the maker signs. */}
        {confirmingCancel ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">
              Cancel this deal for good?
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={handleBackOut}
            >
              {cancel.isPending ? "Cancelling…" : "Yes, cancel"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={cancel.isPending}
              onClick={() => setConfirmingCancel(false)}
            >
              Keep it
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={working === "sign"}
            onClick={() => setConfirmingCancel(true)}
          >
            No — I don&apos;t want this deal
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
