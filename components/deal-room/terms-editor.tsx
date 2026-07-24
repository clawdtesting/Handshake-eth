"use client";

import { useMemo, useState } from "react";
import { parseEther } from "viem";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NFTMedia } from "@/components/ui/nft-media";
import { Skeleton } from "@/components/ui/skeleton";
import { useWalletNFTs } from "@/hooks/use-market";
import { diffDrafts } from "@/lib/deal-rooms/diff";
import { cn, formatEth, prettyCollectionName, shortAddress } from "@/lib/utils";
import type { DealRoomDraft, DealRoomRevision, RevisionNFT } from "@/lib/types";
import type { NFTAsset } from "@/lib/types";

/**
 * Counter composer: edit either side of the draft — pick NFTs straight from
 * each wallet's live inventory, adjust ETH, set the offer expiry, add a note.
 * Drafts cost nothing and move nothing; the sticky diff bar keeps the changes
 * vs the answered round visible while editing.
 */

const EXPIRY_CHOICES = [
  { label: "1 hour", seconds: 3_600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "3 days", seconds: 3 * 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
] as const;

function toRevisionNFT(a: NFTAsset): RevisionNFT {
  return {
    contractAddress: a.contractAddress.toLowerCase(),
    tokenId: a.tokenId,
    collectionName: a.collectionName,
    name: a.name,
    imageUrl: a.imageUrl,
    rarityRank: a.rarityRank ?? null,
  };
}

function nftKey(n: { contractAddress: string; tokenId: string }): string {
  return `${n.contractAddress.toLowerCase()}:${n.tokenId}`;
}

function SidePicker({
  label,
  wallet,
  selected,
  onToggle,
  monValue,
  onMonChange,
  initialCollection = null,
}: {
  label: string;
  wallet: string;
  selected: RevisionNFT[];
  onToggle: (nft: RevisionNFT) => void;
  monValue: string;
  onMonChange: (v: string) => void;
  /** Pre-select a collection's filter (e.g. seeded from a wanted post). */
  initialCollection?: string | null;
}) {
  const { data, isLoading } = useWalletNFTs(wallet);
  // First-step collection filter: the user picks a collection before any NFTs
  // are shown, so a large wallet isn't dumped all at once.
  const [collectionFilter, setCollectionFilter] = useState<string | null>(
    initialCollection ? initialCollection.toLowerCase() : null,
  );
  const selectedKeys = useMemo(
    () => new Set(selected.map(nftKey)),
    [selected]
  );

  const collections = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const nft of data?.nfts ?? []) {
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
  }, [data]);

  const visibleNfts = useMemo(
    () =>
      collectionFilter
        ? (data?.nfts ?? []).filter(
            (nft) => nft.contractAddress.toLowerCase() === collectionFilter
          )
        : [],
    [data, collectionFilter]
  );

  return (
    <div className="flex-1 space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Add ETH, NFTs, or both — either side can be ETH-only.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          ETH amount
        </label>
        <Input
          inputMode="decimal"
          placeholder="0"
          value={monValue}
          onChange={(e) => onMonChange(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((nft) => (
            <button
              key={nftKey(nft)}
              type="button"
              onClick={() => onToggle(nft)}
              className="group flex items-center gap-1 rounded-full border border-ethereum-purple/40 bg-ethereum-purple/10 py-0.5 pl-2 pr-1 text-xs"
              title="Remove from draft"
            >
              {nft.name ?? `#${nft.tokenId}`}
              <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Collection
        </label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
          value={collectionFilter ?? ""}
          disabled={isLoading || collections.length === 0}
          onChange={(e) => setCollectionFilter(e.target.value || null)}
        >
          <option value="">
            {isLoading
              ? "Loading collections…"
              : collections.length === 0
                ? "No collections found"
                : "Choose a collection…"}
          </option>
          {collections.map((c) => (
            <option key={c.address} value={c.address}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
      </div>

      {!isLoading && !collectionFilter ? (
        <div className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
          Pick a collection to see its NFTs.
        </div>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
          {isLoading ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-md" />
              ))}
            </div>
          ) : !data?.nfts?.length ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No NFTs found for {shortAddress(wallet)}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {visibleNfts.map((asset) => {
                const nft = toRevisionNFT(asset);
                const active = selectedKeys.has(nftKey(nft));
                return (
                  <button
                    key={nftKey(nft)}
                    type="button"
                    onClick={() => onToggle(nft)}
                    className={cn(
                      "overflow-hidden rounded-md border text-left transition",
                      active
                        ? "border-ethereum-purple ring-1 ring-ethereum-purple"
                        : "border-border opacity-80 hover:opacity-100"
                    )}
                    title={`${nft.collectionName ?? ""} #${nft.tokenId}`}
                  >
                    <NFTMedia
                      imageUrl={nft.imageUrl}
                      alt={nft.name ?? `#${nft.tokenId}`}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="truncate px-1 py-0.5 text-[10px]">
                      {nft.name ?? `#${nft.tokenId}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TermsEditor({
  base,
  viewerWallet,
  onSubmit,
  onClose,
  submitting,
  initialMakerCollection = null,
}: {
  /** The revision being countered — the editor starts from its terms. */
  base: DealRoomRevision;
  viewerWallet: string;
  onSubmit: (draft: DealRoomDraft, note: string | null) => void;
  onClose: () => void;
  submitting: boolean;
  /** Pre-select the maker side's collection filter (e.g. from a wanted post). */
  initialMakerCollection?: string | null;
}) {
  const [makerNFTs, setMakerNFTs] = useState<RevisionNFT[]>(base.makerNFTs);
  const [takerNFTs, setTakerNFTs] = useState<RevisionNFT[]>(base.takerNFTs);
  const [makerEth, setMakerEth] = useState(
    BigInt(base.makerEthAmount) > 0n ? formatEth(base.makerEthAmount, 18) : ""
  );
  const [takerEth, setTakerEth] = useState(
    BigInt(base.takerEthAmount) > 0n ? formatEth(base.takerEthAmount, 18) : ""
  );
  const [expirySeconds, setExpirySeconds] = useState<number>(86_400);
  const [note, setNote] = useState("");

  const toggle =
    (setter: React.Dispatch<React.SetStateAction<RevisionNFT[]>>) =>
    (nft: RevisionNFT) =>
      setter((prev) => {
        const key = nftKey(nft);
        if (prev.some((p) => nftKey(p) === key)) {
          return prev.filter((p) => nftKey(p) !== key);
        }
        if (prev.length >= 20) {
          toast.error("Max 20 NFTs per side");
          return prev;
        }
        return [...prev, nft];
      });

  const draft: DealRoomDraft | null = useMemo(() => {
    try {
      return {
        makerAddress: base.makerAddress,
        takerAddress: base.takerAddress,
        makerNFTs,
        takerNFTs,
        makerEthAmount: (makerEth ? parseEther(makerEth) : 0n).toString(),
        takerEthAmount: (takerEth ? parseEther(takerEth) : 0n).toString(),
        feeBps: base.feeBps,
        flatFee: base.flatFee,
        offerExpiry: Math.floor(Date.now() / 1000) + expirySeconds,
      };
    } catch {
      return null;
    }
  }, [base, makerNFTs, takerNFTs, makerEth, takerEth, expirySeconds]);

  const chips = useMemo(
    () => (draft ? diffDrafts(base, draft) : []),
    [base, draft]
  );

  const viewerIsMaker =
    base.makerAddress.toLowerCase() === viewerWallet.toLowerCase();
  const makerLabel = viewerIsMaker
    ? "You give (your wallet)"
    : `${shortAddress(base.makerAddress)} gives`;
  const takerLabel = viewerIsMaker
    ? `${shortAddress(base.takerAddress)} gives`
    : "You give (your wallet)";

  const canSubmit =
    !!draft &&
    (draft.makerNFTs.length > 0 || BigInt(draft.makerEthAmount) > 0n) &&
    (draft.takerNFTs.length > 0 || BigInt(draft.takerEthAmount) > 0n);

  return (
    <Card className="border-ethereum-purple/40">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Counter round {base.revisionNumber}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close editor">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row">
          <SidePicker
            label={makerLabel}
            wallet={base.makerAddress}
            selected={makerNFTs}
            onToggle={toggle(setMakerNFTs)}
            monValue={makerEth}
            onMonChange={setMakerEth}
            initialCollection={initialMakerCollection}
          />
          <SidePicker
            label={takerLabel}
            wallet={base.takerAddress}
            selected={takerNFTs}
            onToggle={toggle(setTakerNFTs)}
            monValue={takerEth}
            onMonChange={setTakerEth}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Final offer valid for
            </label>
            <div className="flex gap-1.5">
              {EXPIRY_CHOICES.map((c) => (
                <Button
                  key={c.seconds}
                  type="button"
                  size="sm"
                  variant={expirySeconds === c.seconds ? "default" : "outline"}
                  onClick={() => setExpirySeconds(c.seconds)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">
              Note (optional, visible in this room)
            </label>
            <Input
              maxLength={240}
              placeholder="Throw in 5 ETH and it's done."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {/* Sticky-feel diff bar: what this counter changes */}
        <div className="rounded-md border border-border bg-secondary/40 p-2.5">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">
            Changes vs round {base.revisionNumber}
          </div>
          {chips.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No changes yet — a counter must change something.
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip, i) => (
                <span
                  key={i}
                  className="rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-2 py-0.5 text-xs"
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Drafts are free and non-executable. Nothing moves until the final
            deal is signed and settled.
          </p>
          <Button
            disabled={!canSubmit || chips.length === 0 || submitting}
            onClick={() => draft && onSubmit(draft, note.trim() || null)}
          >
            {submitting ? "Proposing…" : "Propose revision"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
