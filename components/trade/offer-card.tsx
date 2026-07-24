"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, Lock } from "lucide-react";
import type { TradeOffer } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { NFTCard } from "@/components/trade/nft-card";
import { isCollectionBid } from "@/lib/collection-bids";
import {
  cn,
  rarityRankBadgeClass,
  shortAddress,
  timeUntil,
  formatEth,
  prettyCollectionName,
} from "@/lib/utils";

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

export function OfferCard({
  offer,
  ownership,
}: {
  offer: TradeOffer;
  ownership?: "incoming" | "created";
}) {
  const makerNfts = offer.nfts.filter((n) => n.side === "maker");
  const takerNfts = offer.nfts.filter((n) => n.side === "taker");
  const showExpiry = offer.status === "open" && offer.expiry > Date.now() / 1000;
  const isIncoming = ownership === "incoming";
  const isCreated = ownership === "created";

  return (
    <Link
      href={`/offers/${offer.id}`}
      className={cn(
        "block rounded-xl border bg-card p-4 transition-colors hover:border-ethereum-purple/50",
        isIncoming && "border-cyan-300/25 hover:border-cyan-300/50",
        isCreated && "border-ethereum-purple/30"
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {isIncoming && <OwnershipBadge kind="incoming" />}
          {isCreated && <OwnershipBadge kind="created" />}
          {offer.isPrivate && <PrivateBadge />}
        </div>
        <div className="flex items-center gap-2">
          {offer.requiredMaxRarityRank != null && (
            <Badge
              variant="outline"
              className={rarityRankBadgeClass(offer.requiredMaxRarityRank)}
            >
              Top {offer.requiredMaxRarityRank.toLocaleString()}
            </Badge>
          )}
          <Badge variant={statusVariant[offer.status]}>
            {statusLabel[offer.status]}
          </Badge>
          {showExpiry && (
            <span className="text-xs text-muted-foreground">
              expires in {timeUntil(offer.expiry)}
            </span>
          )}
        </div>
      </div>

      {ownership && (
        <div className="mb-3 grid gap-2 rounded-lg border border-border/70 bg-background/50 p-3 text-xs sm:grid-cols-2">
          <p className="font-semibold uppercase tracking-wide text-foreground">
            {isIncoming ? "Incoming" : "Created by you"}
          </p>
          <p className="text-muted-foreground sm:text-right">
            {isIncoming ? "Maker: " : "Recipient: "}
            <span className="font-mono text-foreground">
              {shortAddress(isIncoming ? offer.makerAddress : offer.takerAddress)}
            </span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TradeSide nfts={makerNfts} eth={offer.makerEthAmount} label="Maker gives" />
        <ArrowLeftRight className="h-5 w-5 text-ethereum-purple" />
        <TradeSide nfts={takerNfts} eth={offer.takerEthAmount} label="Taker gives" />
      </div>
    </Link>
  );
}

function OwnershipBadge({ kind }: { kind: "incoming" | "created" }) {
  const isIncoming = kind === "incoming";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        isIncoming
          ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-200"
          : "border-ethereum-purple/40 bg-ethereum-purple/10 text-ethereum-purple"
      )}
    >
      {isIncoming ? "Needs Action" : "Created by You"}
    </span>
  );
}

export function OfferListItem({ offer }: { offer: TradeOffer }) {
  const makerNfts = offer.nfts.filter((n) => n.side === "maker");
  const takerNfts = offer.nfts.filter((n) => n.side === "taker");
  const showExpiry = offer.status === "open" && offer.expiry > Date.now() / 1000;

  return (
    <Link
      href={`/offers/${offer.id}`}
      className="block overflow-x-auto rounded-xl border bg-card px-4 py-3 transition-colors hover:border-ethereum-purple/50"
    >
      <div className="flex min-w-max items-center gap-3 whitespace-nowrap text-sm">
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
        {offer.isPrivate && <PrivateBadge />}
        <span className="text-muted-foreground">
          Maker {shortAddress(offer.makerAddress)}
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          Maker gives:
          <TradeSideInline nfts={makerNfts} eth={offer.makerEthAmount} />
        </span>
        <ArrowLeftRight className="h-4 w-4 shrink-0 text-ethereum-purple" />
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          Taker gives:
          <TradeSideInline nfts={takerNfts} eth={offer.takerEthAmount} />
        </span>
        {showExpiry && (
          <span className="text-xs text-muted-foreground">
            expires in {timeUntil(offer.expiry)}
          </span>
        )}
      </div>
    </Link>
  );
}

function PrivateBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-orange-400/40 bg-orange-400/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-orange-300">
      <Lock className="h-3 w-3" />
      Private
    </span>
  );
}

function TradeSide({
  nfts,
  eth,
  label,
}: {
  nfts: TradeOffer["nfts"];
  eth: string;
  label: string;
}) {
  const monAmount = BigInt(eth);

  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {nfts.slice(0, 4).map((nft) => (
          <NFTCard key={nft.id} nft={nft} size="sm" />
        ))}
      </div>
      {nfts.length > 4 && (
        <p className="mt-1 text-xs text-foreground">+{nfts.length - 4} more</p>
      )}
      {monAmount > 0n && (
        <p className="mt-1.5 text-sm font-semibold text-ethereum-purple">
          {formatEth(monAmount)} ETH
        </p>
      )}
      {nfts.length === 0 && monAmount === 0n && (
        <p className="text-sm text-muted-foreground">Nothing</p>
      )}
    </div>
  );
}

function TradeSideInline({
  nfts,
  eth,
}: {
  nfts: TradeOffer["nfts"];
  eth: string;
}) {
  const monAmount = BigInt(eth);

  if (nfts.length === 0 && monAmount === 0n) {
    return <span className="text-muted-foreground">Nothing</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {monAmount > 0n && (
        <AssetPill kind="eth">{formatEth(monAmount)} ETH</AssetPill>
      )}
      {nfts.slice(0, 2).map((nft) => (
        <AssetPill key={nft.id} kind="nft">
          {formatNftSummary(nft)}
        </AssetPill>
      ))}
      {nfts.length > 2 && (
        <AssetPill kind="nft">+{nfts.length - 2} NFTs</AssetPill>
      )}
    </span>
  );
}

function AssetPill({
  kind,
  children,
}: {
  kind: "eth" | "nft";
  children: ReactNode;
}) {
  const className =
    kind === "eth"
      ? "border-ethereum-purple/40 bg-ethereum-purple/10 text-ethereum-purple"
      : "border-cyan-400/40 bg-cyan-400/10 text-cyan-200";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      <span className="mr-1 opacity-70">{kind.toUpperCase()}</span>
      {children}
    </span>
  );
}

function formatNftSummary(nft: TradeOffer["nfts"][number]) {
  const collection =
    prettyCollectionName(nft.collectionName) ?? shortAddress(nft.contractAddress);

  if (isCollectionBid(nft)) {
    return `Any ${collection}`;
  }

  return `${collection} #${nft.tokenId}`;
}
