"use client";

import { useState } from "react";
import { Flame, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { NFTMedia } from "@/components/ui/nft-media";
import {
  useBurntStats,
  useBurntTokens,
  type BurntStatus,
  type BurntToken,
} from "@/hooks/use-burnt";
import {
  explorerAddressUrl,
  explorerTokenUrl,
} from "@/lib/chains/ethereum";
import { cn, shortAddress } from "@/lib/utils";

const FILTERS: { key: BurntStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "burned", label: "Burnt" },
  { key: "alive", label: "Alive" },
];

function fmt(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

export default function BurntPage() {
  const { data: stats, isLoading: loadingStats } = useBurntStats();
  const [filter, setFilter] = useState<BurntStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const collectionName = stats?.collection.name ?? "the collection";
  const collectionAddress = stats?.collection.address ?? "";

  function toggle(tokenId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tokenId)) next.delete(tokenId);
      else next.add(tokenId);
      return next;
    });
  }

  return (
    <div className="container mx-auto px-4 pb-32">
      {/* Hero */}
      <section className="py-12">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-amber-400">
          <Flame className="h-3.5 w-3.5" /> Burnt
        </p>
        <h1 className="text-3xl font-semibold">Burnt for the culture</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Holders of{" "}
          {collectionAddress ? (
            <a
              href={explorerAddressUrl(collectionAddress)}
              target="_blank"
              rel="noreferrer"
              className="text-ethereum-purple hover:underline"
            >
              {collectionName}
            </a>
          ) : (
            collectionName
          )}{" "}
          are voluntarily burning their pieces. Track what&apos;s gone, browse
          every token, and see who&apos;s sent the most to the flames.
        </p>
      </section>

      {/* Data-syncing notice: live supply couldn't be read this cycle. */}
      {stats && stats.diagnostics && !stats.diagnostics.supplyKnown && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Live burn data is still syncing from the indexer — showing the
          original mint for now. Refresh in a moment.
        </div>
      )}

      {/* Burn progress */}
      <BurnProgress
        loading={loadingStats}
        burnPct={stats?.supply.burnPct ?? 0}
        totalBurned={stats?.supply.totalBurned}
        initialSupply={stats?.collection.initialSupply}
      />

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Original mint"
          value={fmt(stats?.collection.initialSupply)}
          loading={loadingStats}
        />
        <StatCard
          label="Total burnt"
          value={fmt(stats?.supply.totalBurned)}
          accent="amber"
          hint={
            stats
              ? `${stats.supply.trueBurned.toLocaleString()} destroyed · ${stats.supply.burnedToDead.toLocaleString()} to dead`
              : undefined
          }
          loading={loadingStats}
        />
        <StatCard
          label="Still alive"
          value={fmt(stats?.supply.alive)}
          accent="emerald"
          loading={loadingStats}
        />
        <StatCard
          label="Burn rate"
          value={stats ? `${stats.supply.burnPct}%` : "—"}
          accent="amber"
          loading={loadingStats}
        />
      </div>

      {/* Leaderboard + gallery */}
      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        <TopBurners
          loading={loadingStats}
          burners={stats?.topBurners ?? []}
        />

        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg border border-border/60 p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    filter === f.key
                      ? "bg-ethereum-purple/15 text-ethereum-purple"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {selected.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selected.size} selected
              </span>
            )}
          </div>

          <TokenGallery
            filter={filter}
            selected={selected}
            onToggle={toggle}
          />
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <SelectionBar
          selected={selected}
          collectionAddress={collectionAddress}
          onClear={() => setSelected(new Set())}
          onRemove={toggle}
        />
      )}
    </div>
  );
}

function BurnProgress({
  loading,
  burnPct,
  totalBurned,
  initialSupply,
}: {
  loading: boolean;
  burnPct: number;
  totalBurned?: number;
  initialSupply?: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="mb-2 flex items-end justify-between">
          <span className="text-sm text-muted-foreground">
            Burnt of original mint
          </span>
          {loading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <span className="text-2xl font-semibold text-amber-400">
              {burnPct}%
            </span>
          )}
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-[width] duration-700"
            style={{ width: `${loading ? 0 : Math.min(100, burnPct)}%` }}
          />
        </div>
        {!loading && (
          <p className="mt-2 text-xs text-muted-foreground">
            {fmt(totalBurned)} of {fmt(initialSupply)} gone
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "amber" | "emerald";
  loading: boolean;
}) {
  const valueColor =
    accent === "amber"
      ? "text-amber-400"
      : accent === "emerald"
        ? "text-emerald-400"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-20" />
        ) : (
          <p className={cn("mt-1 text-2xl font-semibold", valueColor)}>
            {value}
          </p>
        )}
        {hint && !loading && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function TopBurners({
  loading,
  burners,
}: {
  loading: boolean;
  burners: { address: string; count: number }[];
}) {
  return (
    <Card className="h-fit">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" />
          <h2 className="font-semibold">Top burners</h2>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : burners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No burns recorded yet.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {burners.map((b, i) => (
              <li
                key={b.address}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="w-5 text-right text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <a
                    href={explorerAddressUrl(b.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate hover:text-ethereum-purple hover:underline"
                  >
                    {shortAddress(b.address)}
                  </a>
                </span>
                <span className="shrink-0 font-medium text-amber-400">
                  {b.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TokenGallery({
  filter,
  selected,
  onToggle,
}: {
  filter: BurntStatus;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBurntTokens(filter);

  const tokens = data?.pages.flatMap((p) => p.tokens) ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load tokens"
        body="The indexer didn't respond. Try again in a moment."
      />
    );
  }

  if (tokens.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        body={
          filter === "burned"
            ? "No tokens have been burnt to a dead address yet."
            : "No tokens to show."
        }
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tokens.map((token) => (
          <TokenCard
            key={token.tokenId}
            token={token}
            selected={selected.has(token.tokenId)}
            onToggle={() => onToggle(token.tokenId)}
          />
        ))}
      </div>
      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-md border border-ethereum-purple/30 px-4 py-2 text-sm text-ethereum-purple transition-colors hover:bg-ethereum-purple/10 disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}

function TokenCard({
  token,
  selected,
  onToggle,
}: {
  token: BurntToken;
  selected: boolean;
  onToggle: () => void;
}) {
  const burned = token.status === "burned";
  return (
    <button
      onClick={onToggle}
      className={cn(
        "group relative overflow-hidden rounded-xl border text-left transition-all",
        selected
          ? "border-ethereum-purple ring-2 ring-ethereum-purple/50"
          : "border-border/60 hover:border-ethereum-purple/40",
      )}
    >
      <div className="relative aspect-square w-full bg-white/[0.03]">
        <NFTMedia
          imageUrl={token.image}
          alt={token.name ?? `#${token.tokenId}`}
          className={cn(
            "h-full w-full object-cover transition-transform group-hover:scale-105",
            burned && "grayscale",
          )}
        />
        <div className="absolute left-2 top-2">
          <Badge variant={burned ? "destructive" : "success"}>
            {burned ? "Burnt" : "Alive"}
          </Badge>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 p-2">
        <span className="truncate text-sm font-medium">
          {token.name ?? `#${token.tokenId}`}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          #{token.tokenId}
        </span>
      </div>
    </button>
  );
}

function SelectionBar({
  selected,
  collectionAddress,
  onClear,
  onRemove,
}: {
  selected: Set<string>;
  collectionAddress: string;
  onClear: () => void;
  onRemove: (id: string) => void;
}) {
  const ids = Array.from(selected);
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ethereum-purple/20 bg-background/90 backdrop-blur">
      <div className="container mx-auto flex items-center gap-3 px-4 py-3">
        <span className="shrink-0 text-sm font-medium">
          {ids.length} selected
        </span>
        <div className="flex flex-1 gap-1.5 overflow-x-auto">
          {ids.map((id) => (
            <a
              key={id}
              href={
                collectionAddress
                  ? explorerTokenUrl(collectionAddress, id)
                  : "#"
              }
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="group flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-xs hover:border-ethereum-purple/40"
            >
              <span className="text-muted-foreground group-hover:text-ethereum-purple">
                #{id}
              </span>
              <X
                className="h-3 w-3 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(id);
                }}
              />
            </a>
          ))}
        </div>
        <button
          onClick={onClear}
          className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
