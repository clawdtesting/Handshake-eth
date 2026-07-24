"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NFTCard, NFTListItem } from "@/components/trade/nft-card";
import { EmptyState } from "@/components/empty-state";
import { useCollectionPrices, useWalletNFTsInfinite } from "@/hooks/use-market";
import {
  useAllowedCollections,
  useCollectionApprovals,
  useTransferRestrictedCollections,
  type ApprovalState,
} from "@/hooks/use-approvals";
import { ApproveCollectionButton } from "@/components/trade/approve-collection-button";
import { cn, prettyCollectionName, shortAddress } from "@/lib/utils";
import { FEATURED_COLLECTIONS } from "@/lib/featured-collections";
import type { NFTAsset } from "@/lib/types";

function nftKey(n: { contractAddress: string; tokenId: string }) {
  return `${n.contractAddress.toLowerCase()}:${n.tokenId}`;
}

const FEATURED_CONTRACTS = FEATURED_COLLECTIONS.map((collection) =>
  collection.address.toLowerCase(),
);
const FEATURED_CONTRACT_SET = new Set(FEATURED_CONTRACTS);

/**
 * NFT picker with an OpenSea-style collection filter on the left. Loads the
 * wallet progressively. Every page is verified against the settlement
 * allowlist and wallet approvals before its NFTs enter the selector.
 */
export function OwnedNFTPicker({
  selected,
  onToggle,
  pendingContracts,
}: {
  selected: NFTAsset[];
  onToggle: (nft: NFTAsset) => void;
  /** Collections with an in-flight approval tx — shown with a pending dot. */
  pendingContracts?: Set<string>;
}) {
  const { address } = useAccount();
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useWalletNFTsInfinite(address);

  const [query, setQuery] = useState("");
  // Empty set = no filter (show all). Otherwise show only selected contracts.
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(
    new Set()
  );
  const [layout, setLayout] = useState<"cards" | "list">("cards");

  function toggleCollection(address: string) {
    setSelectedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  }

  const nfts = useMemo<NFTAsset[]>(
    () => data?.pages.flatMap((p) => p.nfts) ?? [],
    [data]
  );

  // Keep walking the wallet in the background after the first page renders.
  // Existing verified cards remain mounted while subsequent pages load, and
  // newly discovered collections appear as soon as their checks resolve.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  ]);

  const collections = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const nft of nfts) {
      const key = nft.contractAddress.toLowerCase();
      const label =
        prettyCollectionName(nft.collectionName) ??
        shortAddress(nft.contractAddress);
      const prev = map.get(key);
      map.set(key, { label, count: (prev?.count ?? 0) + 1 });
    }
    return Array.from(map.entries())
      .map(([addr, v]) => ({ address: addr, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [nfts]);

  const { data: prices } = useCollectionPrices(
    collections.map((c) => c.address)
  );

  const contractsToVerify = useMemo(
    () =>
      Array.from(
        new Set([
          ...FEATURED_CONTRACTS,
          ...collections.map((collection) => collection.address),
        ]),
      ).sort(),
    [collections],
  );

  // Featured collections are checked as soon as the picker mounts. In most
  // wallets this warms both caches before the first NFT page has rendered.
  const approvals = useCollectionApprovals(contractsToVerify);
  const { stateFor: approvalState } = approvals;
  const approvalFor = (contract: string) =>
    approvalState(contract, pendingContracts?.has(contract.toLowerCase()));

  // Which collections Handshake actually supports (settlement allowlist). The
  // wallet holds all kinds of NFTs (LP positions, vouchers, spam) that can't
  // be traded here — those never enter the selector or the approval banner.
  const allowlist = useAllowedCollections(contractsToVerify);
  const {
    isAllowed,
    data: allowedData,
  } = allowlist;

  // Collections that pass allowlist + approval but whose own transfer validator
  // blocks the settlement contract (e.g. The 10k Squad). They stay visible so
  // the user sees them, but get a red dot and can't be selected.
  const restricted = useTransferRestrictedCollections(contractsToVerify);
  const { isRestricted } = restricted;

  const isFeatured = (contract: string) =>
    FEATURED_CONTRACT_SET.has(contract.toLowerCase());
  const isVerified = (contract: string) =>
    isAllowed(contract) && approvalFor(contract) === "approved";

  // Dot shown on each card: red for validator-restricted collections, otherwise
  // the normal approval state.
  const dotFor = (contract: string): ApprovalState =>
    isRestricted(contract) ? "restricted" : approvalFor(contract);

  // Block selecting an NFT from a restricted collection and say why.
  const handleToggle = (nft: NFTAsset) => {
    if (isRestricted(nft.contractAddress)) {
      toast.error(
        "This collection can't be traded on Handshake — the collection blocks Handshake from moving its NFTs.",
      );
      return;
    }
    onToggle(nft);
  };

  // Featured addresses provide an immediate local rejection path. The
  // contract allowlist remains authoritative, including for non-featured
  // collections, and nothing enters the selector until approval is confirmed.
  const tradableCollections = useMemo(
    () =>
      collections.filter(
        (c) =>
          (isFeatured(c.address) || isAllowed(c.address)) &&
          isVerified(c.address),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections, approvalState, pendingContracts, allowedData],
  );
  const unapprovedCollections = useMemo(
    () =>
      collections.filter(
        (c) =>
          isAllowed(c.address) &&
          approvalFor(c.address) === "unapproved",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections, approvalState, pendingContracts, allowedData],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nfts.filter((nft) => {
      if (
        selectedCollections.size > 0 &&
        !selectedCollections.has(nft.contractAddress.toLowerCase())
      ) {
        return false;
      }
      // Reject known non-featured junk immediately, while still allowing the
      // on-chain allowlist to positively admit supported dynamic collections.
      if (!isFeatured(nft.contractAddress) && !isAllowed(nft.contractAddress)) {
        return false;
      }
      // Fail closed while either network check is loading or inconclusive.
      if (!isVerified(nft.contractAddress)) {
        return false;
      }
      if (!q) return true;
      const haystack = [nft.name, nft.collectionName, nft.tokenId, nft.contractAddress]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // approvalFor/isAllowed close over approvalState/allowedData, covered below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nfts,
    query,
    selectedCollections,
    approvalState,
    pendingContracts,
    allowedData,
  ]);

  const verificationPending =
    nfts.length > 0 &&
    (allowlist.isFetching || approvals.isFetching) &&
    filtered.length === 0;
  const verificationFailed = allowlist.isError || approvals.isError;

  if (isLoading || verificationPending) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    );
  }

  if (nfts.length === 0) {
    return (
      <EmptyState
        title="No NFTs found"
        body="We couldn't find ERC-721 NFTs in this wallet on Ethereum."
      />
    );
  }

  return (
    <div className="space-y-4">
      {unapprovedCollections.length > 0 && (
        <div className="space-y-2 rounded-xl border-l-4 border-l-amber-500 border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-semibold text-amber-500">
            {unapprovedCollections.length} of your collection
            {unapprovedCollections.length === 1 ? " needs" : "s need"} approval
            to trade
          </p>
          <p className="text-xs text-muted-foreground">
            They&apos;re hidden from the selector below until approved. This is a
            one-time wallet permission (moves nothing).
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {unapprovedCollections.map((c) => (
              <div
                key={c.address}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-2"
              >
                <span className="flex items-center gap-2 truncate text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 ring-2 ring-background" />
                  <span className="truncate">{c.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({c.count})
                  </span>
                </span>
                <ApproveCollectionButton collectionAddress={c.address} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row">
        {/* Left: collections filter */}
        <aside className="md:w-56 md:shrink-0">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search collections…"
          className="mb-3"
        />
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Collections
          </span>
          {selectedCollections.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedCollections(new Set())}
              className="text-xs text-ethereum-purple hover:underline"
            >
              Clear ({selectedCollections.size})
            </button>
          )}
        </div>
        <div className="flex max-h-80 flex-row gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-y-auto md:overflow-x-visible">
          {tradableCollections.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              No approved collections yet.
            </p>
          ) : (
            tradableCollections.map((c) => (
              <CollectionRow
                key={c.address}
                checked={selectedCollections.has(c.address)}
                onClick={() => toggleCollection(c.address)}
                label={c.label}
                count={c.count}
              />
            ))
          )}
        </div>
      </aside>

      {/* Right: NFT grid */}
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {nfts.length} NFTs
            {isFetchingNextPage && " · loading the rest of your wallet…"}
          </p>
          <LayoutToggle layout={layout} onChange={setLayout} />
        </div>
        {verificationFailed ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <p className="font-medium">Couldn&apos;t verify your collections</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your NFTs were found, but collection verification failed. Check
              your connection and try again.
            </p>
            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void allowlist.refetch();
                  void approvals.refetch();
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : filtered.length > 0 ? (
          layout === "cards" ? (
            <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
              {filtered.map((nft) => (
                <NFTCard
                  key={nftKey(nft)}
                  nft={nft}
                  selected={selected.some((n) => nftKey(n) === nftKey(nft))}
                  onClick={() => handleToggle(nft)}
                  price={prices?.[nft.contractAddress.toLowerCase()]}
                  approval={dotFor(nft.contractAddress)}
                />
              ))}
            </div>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {filtered.map((nft) => (
                <NFTListItem
                  key={nftKey(nft)}
                  nft={nft}
                  selected={selected.some((n) => nftKey(n) === nftKey(nft))}
                  onClick={() => handleToggle(nft)}
                  price={prices?.[nft.contractAddress.toLowerCase()]}
                  approval={dotFor(nft.contractAddress)}
                />
              ))}
            </div>
          )
        ) : (
          <EmptyState
            title="No tradeable NFTs here"
            body="Only NFTs from approved collections are shown. If one is missing, its collection may need to be approved or added."
          />
        )}
        {hasNextPage && isFetchNextPageError && !verificationFailed && (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="secondary"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              Retry loading the rest
            </Button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function CollectionRow({
  checked,
  onClick,
  label,
  count,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors md:shrink",
        checked
          ? "border-ethereum-purple bg-ethereum-purple/10 text-ethereum-purple"
          : "border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked
            ? "border-ethereum-purple bg-ethereum-purple text-ethereum-black"
            : "border-muted-foreground/40"
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
            <path
              d="M2.5 6.5l2.5 2.5 4.5-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-full px-1.5 text-xs",
          checked ? "bg-ethereum-purple/20" : "bg-muted"
        )}
      >
        {count}
      </span>
    </button>
  );
}


function LayoutToggle({
  layout,
  onChange,
}: {
  layout: "cards" | "list";
  onChange: (layout: "cards" | "list") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background p-1">
      {(["cards", "list"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            layout === option
              ? "bg-ethereum-purple text-ethereum-black"
              : "text-muted-foreground hover:text-foreground"
          )}
          aria-pressed={layout === option}
        >
          {option === "cards" ? "Cards" : "List"}
        </button>
      ))}
    </div>
  );
}
