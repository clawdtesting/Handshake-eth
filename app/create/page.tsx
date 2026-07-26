"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { parseEther, isAddress, type Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coins,
  Globe,
  Loader2,
  Lock,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NFTCard } from "@/components/trade/nft-card";
import { OwnedNFTPicker } from "@/components/trade/owned-nft-picker";
import { COLLECTION_APPROVALS_KEY } from "@/hooks/use-approvals";
import { FeeBreakdown } from "@/components/trade/fee-breakdown";
import { EmptyState } from "@/components/empty-state";
import {
  ETH_MAINNET_CHAIN_ID,
  SETTLEMENT_CONTRACT_ADDRESS,
} from "@/lib/chains/ethereum";
import { runWrite } from "@/lib/chains/tx";
import { classifyTxError } from "@/lib/chains/tx-errors";
import {
  erc721Abi,
  findDisallowedCollections,
  settlementAbi,
} from "@/lib/contracts/settlement";
import {
  FEATURED_COLLECTIONS,
} from "@/lib/featured-collections";
import { CollectionButton } from "@/components/trade/collection-button";
import { CollectionStatusDot } from "@/components/trade/collection-status-dot";
import { CollectionSearch } from "@/components/trade/collection-search";
import { useCollectionTradeSignals } from "@/hooks/use-collection-trade-signals";
import {
  DEFAULT_EXPIRY_SECONDS,
  ExpirySelector,
  formatExpiryLabel,
} from "@/components/trade/expiry-selector";
import {
  generateNonce,
  getOrderDomain,
  ORDER_TYPES,
  ZERO_ADDRESS,
} from "@/lib/orders/eip712";
import { COLLECTION_BID_TOKEN_ID } from "@/lib/collection-bids";
import { formatEth, prettyCollectionName, shortAddress } from "@/lib/utils";
import type { CollectionSearchResult, NFTAsset } from "@/lib/types";

type Intent = "sell" | "buy" | "swap" | "custom";
type DealStep = "type" | "visibility" | "details" | "review";

const INTENTS: {
  id: Intent;
  title: string;
  blurb: string;
  icon: typeof Tag;
}[] = [
  {
    id: "sell",
    title: "Sell NFT",
    blurb: "Receive ETH for your NFT.",
    icon: Tag,
  },
  {
    id: "buy",
    title: "Buy NFT",
    blurb: "Offer ETH for an NFT you want.",
    icon: ShoppingCart,
  },
  {
    id: "swap",
    title: "Swap NFTs",
    blurb: "Exchange NFTs directly.",
    icon: Sparkles,
  },
  {
    id: "custom",
    title: "Custom Deal",
    blurb: "Combine NFTs and ETH on both sides.",
    icon: Coins,
  },
];

type Visibility = "public" | "targeted" | "private";

const VISIBILITIES: {
  id: Visibility;
  title: string;
  blurb: string;
  icon: typeof Globe;
}[] = [
  {
    id: "public",
    title: "Public — anyone can accept",
    blurb: "Listed on the open feed. The first matching wallet can fill it.",
    icon: Globe,
  },
  {
    id: "targeted",
    title: "Reserved for one wallet",
    blurb:
      "Still listed publicly, but only the wallet you name is allowed to accept.",
    icon: Users,
  },
  {
    id: "private",
    title: "Private / unlisted",
    blurb:
      "Hidden from the public feed. Only the wallet you name (with the link) can see and accept it.",
    icon: Lock,
  },
];

function nftKey(n: { contractAddress: string; tokenId: string }) {
  return `${n.contractAddress.toLowerCase()}:${n.tokenId}`;
}

export default function ProposeDealPage() {
  return (
    <Suspense fallback={null}>
      <ProposeDealForm />
    </Suspense>
  );
}

function ProposeDealForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const prefilledTaker = searchParams.get("taker") ?? "";
  const prefilledPrivate =
    searchParams.get("private") === "1" && isAddress(prefilledTaker);

  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(
    prefilledPrivate
      ? "private"
      : isAddress(prefilledTaker)
        ? "targeted"
        : "public",
  );

  const [offeredNfts, setOfferedNfts] = useState<NFTAsset[]>([]);
  const [requestedNfts, setRequestedNfts] = useState<NFTAsset[]>([]);
  const [offeredMon, setOfferedMon] = useState("");
  const [requestedMon, setRequestedMon] = useState("");
  const [requiredMaxRarityRank, setRequiredMaxRarityRank] = useState("");
  const [takerAddress, setTakerAddress] = useState(
    isAddress(prefilledTaker) ? prefilledTaker : "",
  );
  const [expirySeconds, setExpirySeconds] = useState(DEFAULT_EXPIRY_SECONDS);
  const [requestContract, setRequestContract] = useState("");
  const [selectedRequestCollection, setSelectedRequestCollection] =
    useState<CollectionSearchResult | null>(null);
  const [requestTokenId, setRequestTokenId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approvingCollections, setApprovingCollections] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<Record<string, boolean>>(
    {},
  );

  const makerEthWei = useMemo(() => {
    try {
      return offeredMon ? parseEther(offeredMon) : 0n;
    } catch {
      return 0n;
    }
  }, [offeredMon]);

  const takerEthWei = useMemo(() => {
    try {
      return requestedMon ? parseEther(requestedMon) : 0n;
    } catch {
      return 0n;
    }
  }, [requestedMon]);

  const offersNft =
    intent === "sell" || intent === "swap" || intent === "custom";
  const offersMon = intent === "buy" || intent === "custom";
  const requestsNft =
    intent === "buy" || intent === "swap" || intent === "custom";
  const requestsMon = intent === "sell" || intent === "custom";

  const hasOfferedSomething = offeredNfts.length > 0 || makerEthWei > 0n;
  const hasRequestedSomething = requestedNfts.length > 0 || takerEthWei > 0n;
  const offeredContracts = useMemo(
    () =>
      Array.from(
        new Set(offeredNfts.map((n) => n.contractAddress.toLowerCase())),
      ),
    [offeredNfts],
  );
  const collectionsNeedApproval = offeredContracts.length > 0;
  const allCollectionsApproved =
    !collectionsNeedApproval ||
    offeredContracts.every((contract) => approvalStatus[contract]);
  const isPrivate = visibility === "private";
  const needsTaker = visibility === "targeted" || visibility === "private";

  const stepOrder: DealStep[] = ["type", "visibility", "details", "review"];
  const currentStep = stepOrder[step] ?? "type";
  const steps = stepOrder.map((stepId) => {
    if (stepId === "type") return "Deal Type";
    if (stepId === "visibility") return "Visibility";
    if (stepId === "details") return "Deal Details";
    return "Review";
  });

  function toggleOffered(nft: NFTAsset) {
    setOfferedNfts((prev) =>
      prev.some((n) => nftKey(n) === nftKey(nft))
        ? prev.filter((n) => nftKey(n) !== nftKey(nft))
        : prev.length < 20
          ? [...prev, nft]
          : prev,
    );
  }

  function addRequestedNft() {
    if (!isAddress(requestContract)) {
      toast.error("Enter a valid NFT contract address");
      return;
    }

    const collection = FEATURED_COLLECTIONS.find(
      (c) => c.address.toLowerCase() === requestContract.toLowerCase(),
    );
    const isCollectionWideBuy =
      intent === "buy" && requestTokenId.trim() === "";

    if (!isCollectionWideBuy && !/^\d+$/.test(requestTokenId)) {
      toast.error("Enter a numeric token ID");
      return;
    }

    const nft: NFTAsset = {
      contractAddress: requestContract.toLowerCase(),
      tokenId: isCollectionWideBuy ? COLLECTION_BID_TOKEN_ID : requestTokenId,
      tokenStandard: "ERC721",
      name: isCollectionWideBuy
        ? `Any ${selectedRequestCollection?.name ?? collection?.name ?? "collection"} NFT`
        : `#${requestTokenId}`,
      collectionName:
        selectedRequestCollection?.name ?? collection?.name ?? null,
      imageUrl: null,
      metadata: isCollectionWideBuy ? { collectionBid: true } : null,
    };

    if (requestedNfts.some((n) => nftKey(n) === nftKey(nft))) return;

    setRequestedNfts((prev) => [...prev, nft]);
    setRequestContract("");
    setSelectedRequestCollection(null);
    setRequestTokenId("");

    if (isCollectionWideBuy) {
      toast.success(
        `Added a collection-wide buy request for ${
          nft.collectionName ?? "this collection"
        }`,
      );
      return;
    }

    fetch(
      `/api/token-metadata?contract=${nft.contractAddress}&tokenId=${nft.tokenId}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => {
        if (!meta) return;
        setRequestedNfts((prev) =>
          prev.map((n) =>
            nftKey(n) === nftKey(nft)
              ? {
                  ...n,
                  name: meta.name ?? n.name,
                  imageUrl: meta.animationUrl ?? meta.image ?? n.imageUrl,
                  collectionName:
                    n.collectionName ?? meta.collectionName ?? null,
                  metadata: meta.metadata ?? n.metadata ?? null,
                  rarityRank: meta.rarityRank ?? n.rarityRank ?? null,
                }
              : n,
          ),
        );
      })
      .catch(() => {});
  }

  const refreshApprovalStatus = useCallback(async () => {
    if (!address || !publicClient || offeredContracts.length === 0) {
      setApprovalStatus({});
      return;
    }

    const entries = await Promise.all(
      offeredContracts.map(async (contract) => {
        try {
          const approved = await publicClient.readContract({
            address: contract as Address,
            abi: erc721Abi,
            functionName: "isApprovedForAll",
            args: [address, SETTLEMENT_CONTRACT_ADDRESS],
          });
          return [contract, Boolean(approved)] as const;
        } catch {
          return [contract, false] as const;
        }
      }),
    );

    setApprovalStatus(Object.fromEntries(entries));
  }, [address, publicClient, offeredContracts]);

  useEffect(() => {
    void refreshApprovalStatus();
  }, [refreshApprovalStatus]);

  async function handleApproveCollections() {
    if (!address || !publicClient) return;

    if (chainId !== ETH_MAINNET_CHAIN_ID) {
      toast.error("Switch to the Ethereum network first");
      return;
    }

    if (!collectionsNeedApproval) {
      toast.info("Add an NFT to approve its collection first");
      return;
    }

    if (
      SETTLEMENT_CONTRACT_ADDRESS ===
      "0x0000000000000000000000000000000000000000"
    ) {
      toast.error("Settlement contract is not configured");
      return;
    }

    setApprovingCollections(true);
    try {
      for (const contract of offeredContracts) {
        const alreadyApproved = await publicClient.readContract({
          address: contract as Address,
          abi: erc721Abi,
          functionName: "isApprovedForAll",
          args: [address, SETTLEMENT_CONTRACT_ADDRESS],
        });

        if (alreadyApproved) continue;

        toast.info(
          "Approve this collection so the settlement contract can transfer its NFTs only when an accepted deal settles.",
        );

        await runWrite({
          publicClient,
          writeContractAsync,
          account: address,
          walletChainId: chainId,
          expectedChainId: ETH_MAINNET_CHAIN_ID,
          label: "Approve collection",
          address: contract as Address,
          abi: erc721Abi,
          functionName: "setApprovalForAll",
          args: [SETTLEMENT_CONTRACT_ADDRESS, true] as const,
        });
      }

      await refreshApprovalStatus();
      // Refresh the approval dots on the NFT picker cards.
      queryClient.invalidateQueries({ queryKey: [COLLECTION_APPROVALS_KEY] });
      toast.success("Collections approved");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to approve collections");
    } finally {
      setApprovingCollections(false);
    }
  }

  function validateStep(stepId: DealStep) {
    if (stepId === "type") {
      if (!intent) {
        toast.error("Pick what you'd like to do");
        return false;
      }
    }

    if (stepId === "details") {
      if (
        requiredMaxRarityRank &&
        (!/^\d+$/.test(requiredMaxRarityRank) ||
          Number(requiredMaxRarityRank) <= 0)
      ) {
        toast.error("Enter a positive maximum rarity rank");
        return false;
      }
      if (!hasOfferedSomething) {
        toast.error("Add something to your side of the deal");
        return false;
      }

      if (!hasRequestedSomething) {
        toast.error("Add what you want in return");
        return false;
      }
    }

    if (stepId === "visibility") {
      if (needsTaker && !isAddress(takerAddress)) {
        toast.error("Enter a valid wallet address for this deal");
        return false;
      }
    }

    return true;
  }

  function goNext() {
    if (!validateStep(currentStep)) return;
    setStep((s) => Math.min(s + 1, 3));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSign() {
    if (!address) return;

    if (chainId !== ETH_MAINNET_CHAIN_ID) {
      toast.error("Switch to the Ethereum network first");
      return;
    }

    if (!hasOfferedSomething || !hasRequestedSomething) {
      toast.error("Your deal is incomplete");
      return;
    }

    if (needsTaker && !isAddress(takerAddress)) {
      toast.error("This deal needs a valid taker wallet address");
      return;
    }

    if (
      SETTLEMENT_CONTRACT_ADDRESS ===
      "0x0000000000000000000000000000000000000000"
    ) {
      toast.error("Settlement contract is not configured");
      return;
    }

    setSubmitting(true);
    try {
      if (collectionsNeedApproval && !allCollectionsApproved) {
        throw new Error(
          "Approve your selected NFT collections before proposing this deal.",
        );
      }

      // Allowlist gate (UX): don't let a maker sign an order whose collections
      // the settlement contract would reject with CollectionNotAllowed at fill
      // time. Fail-open — if the contract predates the allowlist or the read is
      // inconclusive, findDisallowedCollections returns nothing and we proceed;
      // the on-chain check remains the real enforcement.
      if (publicClient) {
        const disallowed = await findDisallowedCollections(
          publicClient,
          SETTLEMENT_CONTRACT_ADDRESS,
          [...offeredNfts, ...requestedNfts].map((n) => n.contractAddress),
        );
        if (disallowed.length > 0) {
          const shown = disallowed
            .map((c) => `${c.slice(0, 6)}…${c.slice(-4)}`)
            .join(", ");
          throw new Error(
            `These collections aren't approved for trading on Handshake yet: ${shown}. ` +
              `A collection must be allowlisted (and past its timelock) before an offer using it can settle.`,
          );
        }
      }

      let feeBps = 100n;
      let flatFee = 0n;

      if (publicClient) {
        [feeBps, flatFee] = await Promise.all([
          publicClient.readContract({
            address: SETTLEMENT_CONTRACT_ADDRESS,
            abi: settlementAbi,
            functionName: "feeBps",
          }),
          publicClient.readContract({
            address: SETTLEMENT_CONTRACT_ADDRESS,
            abi: settlementAbi,
            functionName: "flatSwapFee",
          }),
        ]);
      }

      const nonce = generateNonce();
      const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);
      const effectiveTaker = needsTaker ? takerAddress.toLowerCase() : "";
      const taker = (effectiveTaker || ZERO_ADDRESS) as Address;

      const order = {
        maker: address.toLowerCase() as Address,
        taker,
        makerNFTs: offeredNfts.map((n) => ({
          standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress as Address,
          tokenId: BigInt(n.tokenId),
        })),
        takerNFTs: requestedNfts.map((n) => ({
          standard: 0 as const,
          amount: 1n,
          contractAddress: n.contractAddress as Address,
          tokenId: BigInt(n.tokenId),
        })),
        makerEthAmount: makerEthWei,
        takerEthAmount: takerEthWei,
        feeBps,
        flatFee,
        nonce,
        expiry,
      };

      const signature = await signTypedDataAsync({
        domain: getOrderDomain(),
        types: ORDER_TYPES,
        primaryType: "TradeOrder",
        message: order,
      });

      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: ETH_MAINNET_CHAIN_ID,
          makerAddress: address,
          takerAddress: effectiveTaker || null,
          makerNFTs: offeredNfts.map((n) => ({ ...n })),
          takerNFTs: requestedNfts.map((n) => ({ ...n })),
          makerEthAmount: makerEthWei.toString(),
          takerEthAmount: takerEthWei.toString(),
          feeBps: Number(feeBps),
          flatFee: flatFee.toString(),
          nonce: nonce.toString(),
          expiry: Number(expiry),
          signature,
          isPrivate,
          requiredMaxRarityRank: requiredMaxRarityRank
            ? Number(requiredMaxRarityRank)
            : null,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to propose deal");

      toast.success("Deal proposed");
      router.push(`/offers/${body.offer.id}`);
    } catch (err: any) {
      // Classify wallet-signature / RPC errors (e.g. user rejection) into a
      // friendly message; clean API errors fall through unchanged.
      toast.error(classifyTxError(err).userMessage);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-20">
        <EmptyState
          title="Connect your wallet"
          body="Connect a wallet to propose a deal."
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Propose a Deal</h1>
        <p className="mt-2 text-foreground/85">
          Build a public or private NFT deal. Trade NFTs, ETH, or both with
          another collector.
        </p>
      </div>

      <Stepper
        steps={steps}
        current={step}
        onJump={(i) => i < step && setStep(i)}
      />

      <div className="mt-8">
        {currentStep === "type" && (
          <StepIntent intent={intent} onPick={setIntent} />
        )}

        {currentStep === "details" && (
          <StepDetails
            intent={intent!}
            offersNft={offersNft}
            offersMon={offersMon}
            requestsNft={requestsNft}
            requestsMon={requestsMon}
            offeredNfts={offeredNfts}
            requestedNfts={requestedNfts}
            toggleOffered={toggleOffered}
            pendingApprovalContracts={
              approvingCollections ? new Set(offeredContracts) : undefined
            }
            offeredMon={offeredMon}
            setOfferedMon={setOfferedMon}
            requestedMon={requestedMon}
            setRequestedMon={setRequestedMon}
            makerEthWei={makerEthWei}
            requestContract={requestContract}
            setRequestContract={setRequestContract}
            selectedRequestCollection={selectedRequestCollection}
            setSelectedRequestCollection={setSelectedRequestCollection}
            requestTokenId={requestTokenId}
            setRequestTokenId={setRequestTokenId}
            addRequestedNft={addRequestedNft}
            setRequestedNfts={setRequestedNfts}
            requiredMaxRarityRank={requiredMaxRarityRank}
            setRequiredMaxRarityRank={setRequiredMaxRarityRank}
          />
        )}

        {currentStep === "visibility" && (
          <StepVisibility
            visibility={visibility}
            onPick={setVisibility}
            takerAddress={takerAddress}
            setTakerAddress={setTakerAddress}
            needsTaker={needsTaker}
            expirySeconds={expirySeconds}
            setExpirySeconds={setExpirySeconds}
          />
        )}

        {currentStep === "review" && (
          <StepReview
            intent={intent!}
            offeredNfts={offeredNfts}
            requestedNfts={requestedNfts}
            makerEthWei={makerEthWei}
            takerEthWei={takerEthWei}
            visibility={visibility}
            takerAddress={takerAddress}
            expirySeconds={expirySeconds}
            requiredMaxRarityRank={requiredMaxRarityRank}
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={step === 0 || submitting}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < 3 ? (
          <Button onClick={goNext}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-2 sm:flex-row">
            {collectionsNeedApproval && (
              <Button
                size="lg"
                variant={allCollectionsApproved ? "secondary" : "default"}
                disabled={
                  submitting || approvingCollections || allCollectionsApproved
                }
                onClick={handleApproveCollections}
              >
                {approvingCollections ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Approving…
                  </>
                ) : allCollectionsApproved ? (
                  <>
                    <ShieldCheck className="h-4 w-4" /> Collections approved
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" /> Approve collections
                  </>
                )}
              </Button>
            )}
            <Button
              size="lg"
              disabled={
                submitting || approvingCollections || !allCollectionsApproved
              }
              onClick={handleSign}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for
                  signature…
                </>
              ) : (
                "Propose Deal (free, no gas to list)"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({
  steps,
  current,
  onJump,
}: {
  steps: string[];
  current: number;
  onJump: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJump(i)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </button>
            <span
              className={`hidden text-sm sm:inline ${
                active ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className="mx-1 h-px flex-1 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepIntent({
  intent,
  onPick,
}: {
  intent: Intent | null;
  onPick: (i: Intent) => void;
}) {
  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">
        What kind of deal would you like to propose?
      </h2>
      <p className="mb-6 text-sm text-foreground">
        Choose a deal type, and we&apos;ll only ask for the details that matter.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {INTENTS.map((opt) => {
          const Icon = opt.icon;
          const selected = intent === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPick(opt.id)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? "border-ethereum-purple bg-ethereum-purple/15 shadow-lg shadow-ethereum-purple/10 ring-1 ring-ethereum-purple"
                  : "border-ethereum-purple/30 bg-ethereum-purple/5 hover:border-ethereum-purple hover:bg-ethereum-purple/10"
              }`}
            >
              <span
                className={`mt-0.5 rounded-lg p-2 ${
                  selected
                    ? "bg-ethereum-purple text-ethereum-black"
                    : "bg-ethereum-purple/15 text-ethereum-purple"
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="flex items-center gap-2 font-medium">
                  {opt.title}
                  {opt.id === "custom" && (
                    <span className="rounded-full border border-ethereum-purple/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ethereum-purple">
                      Advanced
                    </span>
                  )}
                </span>
                <span className="block text-sm text-foreground">
                  {opt.blurb}
                </span>
              </span>
              {selected && (
                <Check className="ml-auto h-5 w-5 text-ethereum-purple" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepDetails(props: {
  intent: Intent;
  offersNft: boolean;
  offersMon: boolean;
  requestsNft: boolean;
  requestsMon: boolean;
  offeredNfts: NFTAsset[];
  requestedNfts: NFTAsset[];
  toggleOffered: (n: NFTAsset) => void;
  offeredMon: string;
  setOfferedMon: (v: string) => void;
  requestedMon: string;
  setRequestedMon: (v: string) => void;
  makerEthWei: bigint;
  requestContract: string;
  setRequestContract: (v: string) => void;
  selectedRequestCollection: CollectionSearchResult | null;
  setSelectedRequestCollection: (v: CollectionSearchResult | null) => void;
  requestTokenId: string;
  setRequestTokenId: (v: string) => void;
  addRequestedNft: () => void;
  setRequestedNfts: React.Dispatch<React.SetStateAction<NFTAsset[]>>;
  requiredMaxRarityRank: string;
  setRequiredMaxRarityRank: (v: string) => void;
  pendingApprovalContracts?: Set<string>;
}) {
  const {
    offersNft,
    offersMon,
    requestsNft,
    requestsMon,
    offeredNfts,
    requestedNfts,
    toggleOffered,
    pendingApprovalContracts,
    offeredMon,
    setOfferedMon,
    requestedMon,
    setRequestedMon,
    makerEthWei,
    requestContract,
    setRequestContract,
    selectedRequestCollection,
    setSelectedRequestCollection,
    requestTokenId,
    setRequestTokenId,
    addRequestedNft,
    setRequestedNfts,
    requiredMaxRarityRank,
    setRequiredMaxRarityRank,
  } = props;

  const selectedRarityNft = requestedNfts.find((n) => n.rarityRank != null);
  const { signalsFor } = useCollectionTradeSignals(
    FEATURED_COLLECTIONS.map((c) => c.address),
  );

  useEffect(() => {
    if (!selectedRarityNft) setRequiredMaxRarityRank("");
  }, [selectedRarityNft, setRequiredMaxRarityRank]);

  const canAddRequestedNft =
    isAddress(requestContract) &&
    (/^\d+$/.test(requestTokenId) ||
      (props.intent === "buy" && requestTokenId.trim() === ""));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>You give</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {offersNft && (
            <>
              <p className="text-sm text-muted-foreground">
                Your NFTs ({offeredNfts.length} selected, max 20) — pick a
                collection on the left, then tap to add/remove.
              </p>
              <OwnedNFTPicker
                selected={offeredNfts}
                onToggle={toggleOffered}
                pendingContracts={pendingApprovalContracts}
              />
              <p className="rounded-lg border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
                Don&apos;t see your NFT? Only approved collections can be
                traded.{" "}
                <a
                  href="https://x.com/Handshake_NFT"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ethereum-purple hover:underline"
                >
                  Request a collection on X
                </a>
                .
              </p>
              {offeredNfts.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Selected ({offeredNfts.length})
                  </p>
                  {offeredNfts.map((nft) => (
                    <div
                      key={nftKey(nft)}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate">
                        {prettyCollectionName(nft.collectionName) ??
                          shortAddress(nft.contractAddress)}{" "}
                        <span className="font-medium">#{nft.tokenId}</span>
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-red-400 hover:underline"
                        onClick={() => toggleOffered(nft)}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {offersMon && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                ETH you give
              </label>
              <Input
                placeholder="0.0"
                inputMode="decimal"
                value={offeredMon}
                onChange={(e) => setOfferedMon(e.target.value)}
              />
              {makerEthWei > 0n && (
                <p className="mt-1.5 text-xs text-amber-400">
                  ETH you offer must be deposited (plus the protocol fee) into
                  the settlement escrow before the deal can be accepted. You
                  control the escrow and can withdraw anytime.
                </p>
              )}
            </div>
          )}

          {!offersNft && !offersMon && (
            <p className="text-sm text-muted-foreground">
              Nothing to configure here for this deal type.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>You get</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {requestsNft && (
            <>
              <p className="text-sm text-muted-foreground">
                The NFT(s) you want, by contract + token ID. For buy deals,
                select a collection and leave Token ID empty to offer ETH for
                any NFT in that collection; holders can answer with a private
                deal.
              </p>
              <div className="flex flex-wrap gap-2">
                {FEATURED_COLLECTIONS.map((c) => (
                  <CollectionButton
                    key={c.address}
                    collection={c}
                    active={
                      requestContract.toLowerCase() === c.address.toLowerCase()
                    }
                    signals={signalsFor(c.address)}
                    onClick={() => {
                      setRequestContract(c.address);
                      setSelectedRequestCollection(null);
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CollectionStatusDot status="open" />
                  Tradeable
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CollectionStatusDot status="pending" />
                  One approval missing
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CollectionStatusDot status="locked" />
                  Trading locked
                </span>
              </div>
              <CollectionSearch
                selected={selectedRequestCollection}
                onSelect={(collection) => {
                  setSelectedRequestCollection(collection);
                  if (collection.contractAddress) {
                    setRequestContract(collection.contractAddress);
                  } else {
                    setRequestContract("");
                    toast.info(
                      "Collection selected, but contract resolution is pending/unavailable.",
                    );
                  }
                }}
              />
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
                <Input
                  placeholder="NFT contract address (0x…)"
                  value={requestContract}
                  onChange={(e) => {
                    setRequestContract(e.target.value);
                    setSelectedRequestCollection(null);
                  }}
                />
                <Input
                  placeholder={
                    props.intent === "buy" ? "Token ID (optional)" : "Token ID"
                  }
                  className="w-full"
                  value={requestTokenId}
                  onChange={(e) => setRequestTokenId(e.target.value)}
                />
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant={canAddRequestedNft ? "default" : "secondary"}
                  onClick={addRequestedNft}
                >
                  Add
                </Button>
              </div>
              {selectedRarityNft && (
                <div className="space-y-2 rounded-lg border border-ethereum-purple/25 bg-ethereum-purple/10 p-3">
                  <div>
                    <p className="text-sm font-medium">Rarity</p>
                    <p className="text-xs text-muted-foreground">
                      Optional: require the accepting NFT to rank at or above a
                      numeric OpenSea rarity rank. For example, 100 means Top
                      100.
                    </p>
                  </div>
                  <label className="block text-xs font-medium text-muted-foreground">
                    Maximum rarity rank
                  </label>
                  <Input
                    placeholder={`Current token: #${selectedRarityNft.rarityRank}`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={requiredMaxRarityRank}
                    onChange={(e) =>
                      setRequiredMaxRarityRank(
                        e.target.value.replace(/\D/g, ""),
                      )
                    }
                  />
                </div>
              )}
              {requestedNfts.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {requestedNfts.map((nft) => (
                    <NFTCard
                      key={nftKey(nft)}
                      nft={nft}
                      selected
                      onClick={() =>
                        setRequestedNfts((prev) =>
                          prev.filter((n) => nftKey(n) !== nftKey(nft)),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {requestsMon && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                ETH you want to receive
              </label>
              <Input
                placeholder="0.0"
                inputMode="decimal"
                value={requestedMon}
                onChange={(e) => setRequestedMon(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StepVisibility({
  visibility,
  onPick,
  takerAddress,
  setTakerAddress,
  needsTaker,
  expirySeconds,
  setExpirySeconds,
}: {
  visibility: Visibility;
  onPick: (v: Visibility) => void;
  takerAddress: string;
  setTakerAddress: (v: string) => void;
  needsTaker: boolean;
  expirySeconds: number;
  setExpirySeconds: (v: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-xl font-semibold">
          Who can see and accept it?
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Control whether the deal is public, reserved, or hidden.
        </p>
        <div className="grid gap-3">
          {VISIBILITIES.map((opt) => {
            const Icon = opt.icon;
            const selected = visibility === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onPick(opt.id)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50 hover:bg-secondary/40"
                }`}
              >
                <span
                  className={`mt-0.5 rounded-lg p-2 ${
                    selected
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-medium">{opt.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {opt.blurb}
                  </span>
                </span>
                {selected && <Check className="ml-auto h-5 w-5 text-primary" />}
              </button>
            );
          })}
        </div>

        {needsTaker && (
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium">
              Wallet allowed to accept
            </label>
            <Input
              placeholder="0x… the counterparty's wallet"
              value={takerAddress}
              onChange={(e) => setTakerAddress(e.target.value)}
            />
            {takerAddress && !isAddress(takerAddress) && (
              <p className="mt-1 text-xs text-red-400">Not a valid address</p>
            )}
          </div>
        )}
      </div>

      <ExpirySelector
        value={expirySeconds}
        onChange={setExpirySeconds}
        helpText="Enter any positive duration. The deal expires after this amount of time once you sign it."
      />
    </div>
  );
}

function StepReview({
  intent,
  offeredNfts,
  requestedNfts,
  makerEthWei,
  takerEthWei,
  visibility,
  takerAddress,
  expirySeconds,
  requiredMaxRarityRank,
}: {
  intent: Intent;
  offeredNfts: NFTAsset[];
  requestedNfts: NFTAsset[];
  makerEthWei: bigint;
  takerEthWei: bigint;
  visibility: Visibility;
  takerAddress: string;
  expirySeconds: number;
  requiredMaxRarityRank: string;
}) {
  const intentLabel = INTENTS.find((i) => i.id === intent)?.title ?? "Deal";
  const visLabel = VISIBILITIES.find((v) => v.id === visibility)?.title ?? "";
  const expiryLabel = formatExpiryLabel(expirySeconds);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Review &amp; sign</h2>
        <Card>
          <CardContent className="space-y-4 p-5">
            <ReviewRow label="Deal type" value={intentLabel} />
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewSide
                title="You give"
                nfts={offeredNfts}
                eth={makerEthWei}
              />
              <ReviewSide
                title="You get"
                nfts={requestedNfts}
                eth={takerEthWei}
              />
            </div>
            <ReviewRow label="Visibility" value={visLabel} />
            {(visibility === "targeted" || visibility === "private") && (
              <ReviewRow
                label="Reserved for"
                value={
                  isAddress(takerAddress)
                    ? `${takerAddress.slice(0, 8)}…${takerAddress.slice(-4)}`
                    : "—"
                }
              />
            )}
            {requiredMaxRarityRank && (
              <ReviewRow
                label="Rarity requirement"
                value={`Top ${Number(requiredMaxRarityRank).toLocaleString()}`}
              />
            )}
            <ReviewRow label="Expires in" value={expiryLabel} />
          </CardContent>
        </Card>
        {offeredNfts.length > 0 && (
          <p className="text-xs text-amber-400">
            Before signing, approve each selected collection so the settlement
            contract can transfer your NFT only if this deal is accepted and
            settled on-chain.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Signing proposes an off-chain deal — free, no gas. Nothing moves until
          a counterparty accepts and settles on-chain. You can cancel anytime
          with an on-chain cancellation.
        </p>
      </div>
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <FeeBreakdown
          makerEthAmount={makerEthWei}
          takerEthAmount={takerEthWei}
        />
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ReviewSide({
  title,
  nfts,
  eth,
}: {
  title: string;
  nfts: NFTAsset[];
  eth: bigint;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {nfts.length === 0 && eth === 0n && (
        <p className="text-sm text-muted-foreground">Nothing</p>
      )}
      {nfts.map((n) => (
        <p key={nftKey(n)} className="truncate text-sm">
          {n.name ?? `#${n.tokenId}`}{" "}
          <span className="text-muted-foreground">
            ({n.contractAddress.slice(0, 8)}…)
          </span>
        </p>
      ))}
      {eth > 0n && (
        <p className="text-sm font-semibold text-ethereum-purple">
          + {formatEth(eth)} ETH
        </p>
      )}
    </div>
  );
}
