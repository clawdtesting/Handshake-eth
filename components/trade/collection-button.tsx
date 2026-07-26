"use client";

import { cn } from "@/lib/utils";
import {
  collectionApprovalDetail,
  type CollectionTradeSignals,
  type FeaturedCollection,
} from "@/lib/featured-collections";
import { SafeCollectionImage } from "@/components/ui/safe-collection-image";
import { CollectionStatusDot } from "@/components/trade/collection-status-dot";

export function CollectionButton({
  collection,
  active,
  onClick,
  signals,
}: {
  collection: FeaturedCollection;
  active: boolean;
  onClick: () => void;
  /** Live trade-readiness signals; drives the dot colour and tooltip. */
  signals?: CollectionTradeSignals;
}) {
  const detail = collectionApprovalDetail(collection, signals ?? {});
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      )}
    >
      <span className="relative inline-flex shrink-0">
        <SafeCollectionImage
          collectionAddress={collection.address}
          alt=""
          className="h-5 w-5 rounded-sm"
          fallbackSrc={collection.image}
        />
        <CollectionStatusDot
          status={detail.status}
          validatorOk={detail.validatorOk}
          handshakeOk={detail.handshakeOk}
          validatorGated={detail.validatorGated}
          className="absolute -right-1 -top-1"
        />
      </span>
      {collection.name}
    </button>
  );
}
