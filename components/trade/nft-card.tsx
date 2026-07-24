"use client";

import { cn, prettyCollectionName, rarityRankBadgeClass, shortAddress } from "@/lib/utils";
import { isCollectionBid } from "@/lib/collection-bids";
import type { NFTAsset } from "@/lib/types";
import { SafeCollectionImage } from "@/components/ui/safe-collection-image";
import { NFTMedia } from "@/components/ui/nft-media";
import { useNftMediaFallback } from "@/hooks/use-nft-media-fallback";
import type { ApprovalState } from "@/hooks/use-approvals";

const APPROVAL_DOT: Record<
  Exclude<ApprovalState, "unknown">,
  { className: string; label: string }
> = {
  approved: {
    className: "bg-emerald-500",
    label: "You've approved this collection for trading",
  },
  unapproved: {
    className: "bg-red-500",
    label:
      "Your wallet hasn't approved this collection yet — one-time permission needed before trading",
  },
  pending: {
    className: "bg-amber-400 animate-pulse",
    label: "Approval pending — confirming on-chain",
  },
  restricted: {
    className: "bg-red-500",
    label:
      "Can't be traded on Handshake — this collection blocks Handshake from moving its NFTs",
  },
};

/** Small status dot showing whether a collection is approved for settlement. */
export function ApprovalDot({
  state,
  className,
}: {
  state?: ApprovalState;
  className?: string;
}) {
  if (!state || state === "unknown") return null;
  const dot = APPROVAL_DOT[state];
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background",
        dot.className,
        className,
      )}
      title={dot.label}
      aria-label={dot.label}
      role="img"
    />
  );
}

type NFTPriceSummary = {
  floorPrice: number | null;
  topOffer: number | null;
  currency: string;
} | null;

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function displayLabels(nft: NFTAsset, collectionBid: boolean) {
  const fallbackCollection =
    prettyCollectionName(nft.collectionName) ?? shortAddress(nft.contractAddress);

  if (collectionBid) {
    return {
      primary: nft.name ?? "Any NFT",
      secondary: fallbackCollection,
    };
  }

  const tokenLabel = `#${nft.tokenId}`;
  const name = nft.name?.trim();
  const escapedTokenId = nft.tokenId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailingTokenPattern = new RegExp(`\\s*#?${escapedTokenId}\\s*$`);
  const collectionFromName = name?.replace(trailingTokenPattern, "").trim();

  return {
    primary: tokenLabel,
    secondary: collectionFromName || fallbackCollection,
  };
}

function hasMedia(nft: NFTAsset) {
  return Boolean(
    nft.imageUrl ||
      nft.metadata?.["animation_url"] ||
      nft.metadata?.["animationUrl"] ||
      nft.metadata?.["image"]
  );
}

function NFTThumbnail({
  nft,
  collectionBid,
  className,
  mediaClassName,
}: {
  nft: NFTAsset;
  collectionBid: boolean;
  className?: string;
  mediaClassName?: string;
}) {
  // When the indexer listed this token without media (common for newly
  // indexed Ethereum collections), resolve the image on-chain as a fallback.
  const needsFallback = !collectionBid && !hasMedia(nft);
  const fallback = useNftMediaFallback(nft, needsFallback);
  const resolved: NFTAsset = needsFallback
    ? {
        ...nft,
        imageUrl: fallback.imageUrl,
        metadata: nft.metadata ?? fallback.metadata,
      }
    : nft;

  return (
    <div className={cn("overflow-hidden bg-muted", className)}>
      {hasMedia(resolved) ? (
        <NFTMedia
          imageUrl={resolved.imageUrl}
          metadata={resolved.metadata}
          alt={resolved.name ?? `Token #${resolved.tokenId}`}
          className={cn(
            "h-full w-full object-cover transition-transform group-hover:scale-105",
            mediaClassName
          )}
        />
      ) : collectionBid ? (
        <SafeCollectionImage
          collectionAddress={nft.contractAddress}
          alt={nft.collectionName ?? nft.name ?? "Collection logo"}
          className={cn(
            "h-full w-full transition-transform group-hover:scale-105",
            mediaClassName
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-2xl text-muted-foreground">
          ?
        </div>
      )}
    </div>
  );
}

function NFTPriceSummary({ price, compact = false }: { price?: NFTPriceSummary; compact?: boolean }) {
  if (!price || (price.floorPrice == null && price.topOffer == null)) return null;

  return (
    <div
      className={cn(
        "flex gap-1 text-[11px]",
        compact ? "flex-col items-end text-right" : "items-center justify-between"
      )}
    >
      {price.floorPrice != null && (
        <span className="truncate font-medium text-foreground">
          {formatPrice(price.floorPrice)} {price.currency}
          <span className="ml-0.5 text-muted-foreground">floor</span>
        </span>
      )}
      {price.topOffer != null && (
        <span className="truncate text-muted-foreground">
          offer {formatPrice(price.topOffer)}
        </span>
      )}
    </div>
  );
}

export function NFTCard({
  nft,
  selected,
  onClick,
  size = "md",
  price,
  approval,
}: {
  nft: NFTAsset;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
  price?: NFTPriceSummary;
  approval?: ApprovalState;
}) {
  const collectionBid = isCollectionBid(nft);
  const labels = displayLabels(nft, collectionBid);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card text-left transition-all",
        onClick && "cursor-pointer hover:border-ethereum-purple/60",
        selected && "border-ethereum-purple ring-1 ring-ethereum-purple",
        !onClick && "cursor-default"
      )}
    >
      {nft.rarityRank != null && (
        <div
          className={cn(
            "absolute right-2 top-2 z-10 rounded-md border px-2 py-1 text-xs font-semibold shadow-lg backdrop-blur-sm",
            rarityRankBadgeClass(nft.rarityRank),
          )}
        >
          #{nft.rarityRank.toLocaleString()}
        </div>
      )}
      <div className="relative">
        <NFTThumbnail
          nft={nft}
          collectionBid={collectionBid}
          className={cn("aspect-square w-full", size === "sm" ? "max-h-28" : "")}
        />
        {approval && approval !== "unknown" && (
          <div className="absolute bottom-1.5 left-1.5 z-10">
            <ApprovalDot state={approval} className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className={cn("p-2", size === "sm" && "p-1.5")}>
        <p className="truncate text-sm font-medium">
          {labels.primary}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {labels.secondary}
        </p>
        <div className="mt-1">
          <NFTPriceSummary price={price} />
        </div>
      </div>
      {selected && (
        <div className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ethereum-purple text-xs font-bold text-ethereum-black">
          ✓
        </div>
      )}
    </button>
  );
}

export function NFTListItem({
  nft,
  selected,
  onClick,
  price,
  approval,
}: {
  nft: NFTAsset;
  selected?: boolean;
  onClick?: () => void;
  price?: NFTPriceSummary;
  approval?: ApprovalState;
}) {
  const collectionBid = isCollectionBid(nft);
  const labels = displayLabels(nft, collectionBid);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border bg-card p-2 text-left transition-all",
        onClick && "cursor-pointer hover:border-ethereum-purple/60",
        selected && "border-ethereum-purple ring-1 ring-ethereum-purple",
        !onClick && "cursor-default"
      )}
    >
      <div className="relative shrink-0">
        <NFTThumbnail
          nft={nft}
          collectionBid={collectionBid}
          className="h-14 w-14 rounded-md sm:h-16 sm:w-16"
        />
        {selected && (
          <div className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ethereum-purple text-xs font-bold text-ethereum-black">
            ✓
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{labels.primary}</p>
          {nft.rarityRank != null && (
            <span
              className={cn(
                "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                rarityRankBadgeClass(nft.rarityRank)
              )}
            >
              #{nft.rarityRank.toLocaleString()}
            </span>
          )}
        </div>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <ApprovalDot state={approval} />
          {labels.secondary}
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {shortAddress(nft.contractAddress)} · Token {nft.tokenId}
        </p>
      </div>
      <div className="shrink-0 pl-2">
        <NFTPriceSummary price={price} compact />
      </div>
    </button>
  );
}
