"use client";

import { ExternalLink } from "lucide-react";
import { NFTMedia } from "@/components/ui/nft-media";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNftMediaFallback } from "@/hooks/use-nft-media-fallback";
import { explorerTokenUrl } from "@/lib/chains/ethereum";
import {
  cn,
  formatEth,
  prettyCollectionName,
  rarityRankBadgeClass,
  shortAddress,
  timeUntil,
} from "@/lib/utils";
import type { DealRoomRevision, RevisionNFT } from "@/lib/types";

/**
 * The current draft, oriented to the viewer: "You give / You receive".
 * Same visual vocabulary as the offer page so negotiation → settlement feels
 * like one continuous surface.
 */

/**
 * One NFT on the table: image plus a readable identity block (collection,
 * token id, rarity, explorer link) so a trader always knows exactly what's
 * being swapped — even when the art fails to load.
 *
 * Resolves the token's real media on-chain the same way the propose view does.
 * A Deal Room draft only snapshots a single `imageUrl`, which is missing for
 * freshly indexed collections and wrong for animated ones (e.g. Erebus, whose
 * art is an MP4 in `animation_url`, not a still image). So we always resolve
 * tokenURI → metadata and hand the animation/image to the media layer, with
 * the snapshot `imageUrl` kept as a last-resort candidate.
 */
function RevisionNFTTile({ nft }: { nft: RevisionNFT }) {
  const collectionLabel =
    prettyCollectionName(nft.collectionName) ??
    shortAddress(nft.contractAddress);

  const fallback = useNftMediaFallback(
    { contractAddress: nft.contractAddress, tokenId: nft.tokenId },
    true,
  );

  return (
    <div className="overflow-hidden rounded-md border border-border bg-secondary/20">
      <div className="aspect-square w-full bg-muted">
        <NFTMedia
          imageUrl={nft.imageUrl}
          animationUrl={fallback.imageUrl}
          metadata={fallback.metadata}
          alt={nft.name ?? `${collectionLabel} #${nft.tokenId}`}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="space-y-1 px-2 py-1.5">
        <div
          className="truncate text-xs font-semibold text-foreground"
          title={`${collectionLabel} · ${nft.contractAddress}`}
        >
          {collectionLabel}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="max-w-full truncate text-xs text-muted-foreground">
            #{nft.tokenId}
          </span>
          {nft.rarityRank ? (
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                rarityRankBadgeClass(nft.rarityRank),
              )}
            >
              Rank #{nft.rarityRank}
            </span>
          ) : null}
        </div>
        <a
          href={explorerTokenUrl(nft.contractAddress, nft.tokenId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-ethereum-purple"
          title={nft.contractAddress}
        >
          {shortAddress(nft.contractAddress)}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

function AssetSide({
  title,
  nfts,
  ethWei,
  highlight,
}: {
  title: string;
  nfts: RevisionNFT[];
  ethWei: string;
  highlight?: boolean;
}) {
  const eth = BigInt(ethWei);
  const empty = nfts.length === 0 && eth === 0n;
  return (
    <div
      className={cn(
        "flex-1 rounded-lg border p-4",
        highlight
          ? "border-ethereum-purple/40 bg-ethereum-purple/5"
          : "border-border bg-secondary/30"
      )}
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {empty ? (
        <div className="text-sm text-muted-foreground">Nothing</div>
      ) : (
        <div className="space-y-3">
          {nfts.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {nfts.map((nft) => (
                <RevisionNFTTile
                  key={`${nft.contractAddress}:${nft.tokenId}`}
                  nft={nft}
                />
              ))}
            </div>
          )}
          {eth > 0n && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-ethereum-purple">
                {formatEth(eth)}
              </span>
              <span className="text-sm text-muted-foreground">ETH</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TermsCard({
  revision,
  viewerWallet,
  title = "Current terms",
}: {
  revision: DealRoomRevision;
  viewerWallet: string;
  title?: string;
}) {
  const viewerIsMaker =
    revision.makerAddress.toLowerCase() === viewerWallet.toLowerCase();

  const give = viewerIsMaker
    ? { nfts: revision.makerNFTs, eth: revision.makerEthAmount }
    : { nfts: revision.takerNFTs, eth: revision.takerEthAmount };
  const receive = viewerIsMaker
    ? { nfts: revision.takerNFTs, eth: revision.takerEthAmount }
    : { nfts: revision.makerNFTs, eth: revision.makerEthAmount };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="text-xs text-muted-foreground">
          Rev #{revision.revisionNumber} · offer expires {timeUntil(revision.offerExpiry)}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row">
          <AssetSide title="You give" nfts={give.nfts} ethWei={give.eth} />
          <div className="flex items-center justify-center text-2xl text-ethereum-purple sm:px-1">
            🤝
          </div>
          <AssetSide
            title="You receive"
            nfts={receive.nfts}
            ethWei={receive.eth}
            highlight
          />
        </div>
        {revision.note && (
          <p className="mt-3 rounded-md bg-secondary/50 px-3 py-2 text-sm italic text-muted-foreground">
            “{revision.note}”
          </p>
        )}
      </CardContent>
    </Card>
  );
}
