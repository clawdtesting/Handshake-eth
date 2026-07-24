"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NFTCard, NFTListItem } from "@/components/trade/nft-card";
import { ApproveCollectionButton } from "@/components/trade/approve-collection-button";
import { EmptyState } from "@/components/empty-state";
import { useCollectionPrices, useWalletNFTsInfinite } from "@/hooks/use-market";
import {
  useAllowedCollections,
  useCollectionApprovals,
} from "@/hooks/use-approvals";
import { cn, prettyCollectionName, shortAddress } from "@/lib/utils";
import type { NFTAsset } from "@/lib/types";

export function WalletNFTs({ owner }: { owner: string }) {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useWalletNFTsInfinite(owner);

  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState<string | null>(null);
  const [selectedNft, setSelectedNft] = useState<NFTAsset | null>(null);
  const [layout, setLayout] = useState<"cards" | "list">("cards");
  const [hideUnapproved, setHideUnapproved] = useState(true);

  const nfts = useMemo<NFTAsset[]>(
    () => data?.pages.flatMap((p) => p.nfts) ?? [],
    [data]
  );

  // Load the first page only; the user pulls more via "Load more". Previously
  // this eagerly walked every page on mount (a sequential /api/nfts waterfall,
  // plus a collection-price refetch per page) which dominated dashboard load.
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
      .map(([address, v]) => ({ address, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [nfts]);

  const { data: prices } = useCollectionPrices(
    collections.map((c) => c.address)
  );

  const { stateFor: approvalState } = useCollectionApprovals(
    collections.map((c) => c.address)
  );
  const {
    isAllowed,
    isReady: allowlistReady,
    data: allowedData,
  } = useAllowedCollections(collections.map((c) => c.address));

  // Approval only applies to Handshake-supported collections. Everything else
  // the wallet holds (LP positions, vouchers, spam) has no "approve" concept,
  // so it shows no dot and is never listed as needing approval.
  const approvalFor = (contract: string) =>
    allowlistReady && !isAllowed(contract)
      ? ("unknown" as const)
      : approvalState(contract);

  const unapprovedCollections = useMemo(
    () =>
      collections.filter(
        (c) =>
          allowlistReady &&
          isAllowed(c.address) &&
          approvalState(c.address) === "unapproved",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections, approvalState, allowedData, allowlistReady]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nfts.filter((nft) => {
      if (collection && nft.contractAddress.toLowerCase() !== collection) {
        return false;
      }
      // Hide only collections we've confirmed are unapproved; keep unknown
      // (still loading) visible so nothing flickers out unexpectedly.
      if (hideUnapproved && approvalFor(nft.contractAddress) === "unapproved") {
        return false;
      }
      if (!q) return true;
      const haystack = [
        nft.name,
        nft.collectionName,
        nft.tokenId,
        nft.contractAddress,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [nfts, query, collection, hideUnapproved, approvalFor]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, token ID or collection…"
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hideUnapproved}
              onChange={(e) => setHideUnapproved(e.target.checked)}
              className="accent-ethereum-purple"
            />
            Hide unapproved
          </label>
          <LayoutToggle layout={layout} onChange={setLayout} />
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {nfts.length} NFTs
            {isFetchingNextPage && " · loading more…"}
          </p>
        </div>
      </div>

      {unapprovedCollections.length > 0 && (
        <div className="space-y-2 rounded-xl border-l-4 border-l-amber-500 border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-semibold text-amber-500">
            {unapprovedCollections.length} collection
            {unapprovedCollections.length === 1 ? "" : "s"} need your approval
            before trading
          </p>
          <p className="text-xs text-muted-foreground">
            This is a one-time wallet permission (ERC-721 setApprovalForAll) so
            the settlement contract can move these NFTs only when a deal you
            accept settles — separate from whether the collection is allowlisted
            on the protocol. It moves nothing by itself.
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

      <div className="flex flex-wrap gap-2">
        <FilterChip
          active={collection === null}
          onClick={() => setCollection(null)}
          label="All"
          count={nfts.length}
        />
        {collections.map((c) => (
          <FilterChip
            key={c.address}
            active={collection === c.address}
            onClick={() =>
              setCollection(collection === c.address ? null : c.address)
            }
            label={c.label}
            count={c.count}
          />
        ))}
      </div>

      {filtered.length > 0 ? (
        layout === "cards" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6">
            {filtered.map((nft) => (
              <NFTCard
                key={`${nft.contractAddress}:${nft.tokenId}`}
                nft={nft}
                price={prices?.[nft.contractAddress.toLowerCase()]}
                approval={approvalFor(nft.contractAddress)}
                onClick={() => setSelectedNft(nft)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((nft) => (
              <NFTListItem
                key={`${nft.contractAddress}:${nft.tokenId}`}
                nft={nft}
                price={prices?.[nft.contractAddress.toLowerCase()]}
                approval={approvalFor(nft.contractAddress)}
                onClick={() => setSelectedNft(nft)}
              />
            ))}
          </div>
        )
      ) : (
        <EmptyState
          title="No matches"
          body="No NFTs match your search or filter."
        />
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {selectedNft && (
        <div className="rounded-xl border border-ethereum-purple/30 bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ethereum-purple">
                NFT details
              </p>
              <h3 className="text-lg font-semibold">
                {selectedNft.name ?? `#${selectedNft.tokenId}`}
              </h3>
              <p className="text-sm text-foreground">
                {prettyCollectionName(selectedNft.collectionName) ??
                  shortAddress(selectedNft.contractAddress)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedNft(null)}>
              Close
            </Button>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Token ID" value={selectedNft.tokenId} />
            <Detail
              label="Contract"
              value={selectedNft.contractAddress}
              mono
            />
            <Detail
              label="Floor"
              value={
                prices?.[selectedNft.contractAddress.toLowerCase()]?.floorPrice != null
                  ? `${prices[selectedNft.contractAddress.toLowerCase()].floorPrice} ${
                      prices[selectedNft.contractAddress.toLowerCase()].currency
                    }`
                  : "Unavailable"
              }
            />
            <Detail
              label="Top offer"
              value={
                prices?.[selectedNft.contractAddress.toLowerCase()]?.topOffer != null
                  ? `${prices[selectedNft.contractAddress.toLowerCase()].topOffer} ${
                      prices[selectedNft.contractAddress.toLowerCase()].currency
                    }`
                  : "Unavailable"
              }
            />
          </div>
          <p className="mt-3 text-sm text-foreground">
            Traits and price history will appear here when the metadata provider
            includes them; the contract address and token ID are available now so
            collectors can verify the asset without leaving Handshake.
          </p>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ethereum-purple">
        {label}
      </p>
      <p className={cn("mt-1 break-all text-foreground", mono && "font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex max-w-[14rem] items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-ethereum-purple bg-ethereum-purple/10 text-ethereum-purple"
          : "border-border text-muted-foreground hover:border-ethereum-purple/50 hover:text-foreground"
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 text-xs",
          active ? "bg-ethereum-purple/20" : "bg-muted"
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
            "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
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
