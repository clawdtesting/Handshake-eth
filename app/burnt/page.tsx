"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Flame,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { NFTMedia } from "@/components/ui/nft-media";
import {
  useBurntStats,
  useBurntTokens,
  useBurntTraits,
  useBurntTokenLookup,
  type BurntStatus,
  type BurntToken,
  type SelectedTrait,
  type TraitType,
  type TraitLeaderRow,
} from "@/hooks/use-burnt";
import { explorerAddressUrl, explorerTokenUrl } from "@/lib/chains/ethereum";
import { cn, shortAddress } from "@/lib/utils";

const FILTERS: { key: BurntStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "burned", label: "Burnt" },
  { key: "alive", label: "Alive" },
];

function fmt(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

function traitId(t: SelectedTrait): string {
  return `${t.traitType}~${t.value}`;
}

export default function BurntPage() {
  const { data: stats, isLoading: loadingStats } = useBurntStats();
  const { data: traits, isLoading: loadingTraits } = useBurntTraits();
  const [filter, setFilter] = useState<BurntStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [selectedTraits, setSelectedTraits] = useState<SelectedTrait[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchId, setSearchId] = useState<string | null>(null);

  function submitSearch() {
    const id = searchInput.trim().replace(/^#/, "");
    setSearchId(/^\d{1,10}$/.test(id) ? id : null);
  }

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

  function toggleTrait(t: SelectedTrait) {
    setSelectedTraits((prev) => {
      const id = traitId(t);
      return prev.some((p) => traitId(p) === id)
        ? prev.filter((p) => traitId(p) !== id)
        : [...prev, t];
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

      {stats && stats.diagnostics && !stats.diagnostics.supplyKnown && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Live burn data is still syncing from the indexer — showing the
          original mint for now. Refresh in a moment.
        </div>
      )}

      <BurnProgress
        loading={loadingStats}
        burnPct={stats?.supply.burnPct ?? 0}
        totalBurned={stats?.supply.totalBurned}
        initialSupply={stats?.collection.initialSupply}
      />

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
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
          label="Unique burners"
          value={fmt(stats?.uniqueBurners)}
          accent="amber"
          hint="distinct wallets"
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

      {/* Token ID lookup */}
      <div className="mt-8">
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitSearch()}
            inputMode="numeric"
            placeholder="Check a token ID — e.g. 3458"
            className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {(searchInput || searchId) && (
            <button
              onClick={() => {
                setSearchInput("");
                setSearchId(null);
              }}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={submitSearch}
            className="shrink-0 rounded-md bg-ethereum-purple/15 px-3 py-1.5 text-sm text-ethereum-purple hover:bg-ethereum-purple/25"
          >
            Look up
          </button>
        </div>
        {searchId && (
          <TokenLookupResult
            id={searchId}
            collectionAddress={collectionAddress}
          />
        )}
      </div>

      {/* Leaderboards + gallery */}
      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        <div className="space-y-6">
          <TopBurners loading={loadingStats} burners={stats?.topBurners ?? []} />
          <BurntTraitsBoard
            loading={loadingTraits}
            types={traits?.types ?? []}
            onPick={(row) =>
              toggleTrait({ traitType: row.traitType, value: row.value })
            }
            selected={selectedTraits}
          />
        </div>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
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
              <button
                onClick={() => setTraitsOpen(true)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  selectedTraits.length > 0
                    ? "border-ethereum-purple/50 bg-ethereum-purple/10 text-ethereum-purple"
                    : "border-border/60 text-muted-foreground hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Traits
                {selectedTraits.length > 0 && (
                  <span className="rounded-full bg-ethereum-purple/20 px-1.5 text-xs">
                    {selectedTraits.length}
                  </span>
                )}
              </button>
            </div>
            {selected.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selected.size} selected
              </span>
            )}
          </div>

          {/* Active trait chips */}
          {selectedTraits.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {selectedTraits.map((t) => (
                <button
                  key={traitId(t)}
                  onClick={() => toggleTrait(t)}
                  className="flex items-center gap-1.5 rounded-full border border-ethereum-purple/40 bg-ethereum-purple/10 px-3 py-1 text-xs text-ethereum-purple hover:bg-ethereum-purple/20"
                >
                  <span className="text-muted-foreground">{t.traitType}:</span>
                  {t.value}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button
                onClick={() => setSelectedTraits([])}
                className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}

          <TokenGallery
            filter={filter}
            traits={selectedTraits}
            selected={selected}
            onToggle={toggle}
          />
        </div>
      </div>

      {selected.size > 0 && (
        <SelectionBar
          selected={selected}
          collectionAddress={collectionAddress}
          onClear={() => setSelected(new Set())}
          onRemove={toggle}
        />
      )}

      <TraitsDrawer
        open={traitsOpen}
        onClose={() => setTraitsOpen(false)}
        loading={loadingTraits}
        types={traits?.types ?? []}
        selected={selectedTraits}
        onToggle={toggleTrait}
        onClear={() => setSelectedTraits([])}
      />
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
          <p className="text-sm text-muted-foreground">No burns recorded yet.</p>
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

function BurntTraitsBoard({
  loading,
  types,
  onPick,
  selected,
}: {
  loading: boolean;
  types: TraitType[];
  onPick: (row: TraitLeaderRow) => void;
  selected: SelectedTrait[];
}) {
  const [typeFilter, setTypeFilter] = useState<string>("All");

  // The selected type isn't in the data yet on first load; fall back to All.
  const activeType =
    typeFilter === "All" || types.some((t) => t.traitType === typeFilter)
      ? typeFilter
      : "All";

  const rows: TraitLeaderRow[] = useMemo(() => {
    const src =
      activeType === "All"
        ? types
        : types.filter((t) => t.traitType === activeType);
    return src
      .flatMap((t) =>
        t.values.map((v) => ({
          traitType: t.traitType,
          value: v.value,
          burnt: v.burnt,
          total: v.count,
          burntPct: v.count > 0 ? Math.round((v.burnt / v.count) * 1000) / 10 : 0,
        })),
      )
      .filter((r) => r.burnt > 0)
      .sort((a, b) => b.burntPct - a.burntPct || b.burnt - a.burnt)
      .slice(0, 12);
  }, [types, activeType]);

  const isSel = (r: TraitLeaderRow) =>
    selected.some((s) => s.traitType === r.traitType && s.value === r.value);

  return (
    <Card className="h-fit">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" />
          <h2 className="font-semibold">Most-burnt traits</h2>
        </div>

        {/* Trait-type selector — narrows the ranking to one category. */}
        <div className="relative mb-3">
          <select
            value={activeType}
            onChange={(e) => setTypeFilter(e.target.value)}
            disabled={loading || types.length === 0}
            className="w-full appearance-none rounded-lg border border-border/60 bg-transparent py-2 pl-3 pr-8 text-sm capitalize outline-none focus:border-ethereum-purple/50 disabled:opacity-50"
          >
            <option value="All">All traits</option>
            {types.map((t) => (
              <option key={t.traitType} value={t.traitType}>
                {t.traitType}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {activeType === "All"
              ? "No trait data yet."
              : `No burnt ${activeType} yet.`}
          </p>
        ) : (
          <ol className="space-y-2.5">
            {rows.map((r) => (
              <li key={`${r.traitType}~${r.value}`}>
                <button
                  onClick={() => onPick(r)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
                    isSel(r)
                      ? "bg-ethereum-purple/10 text-ethereum-purple"
                      : "hover:bg-white/[0.03]",
                  )}
                >
                  <span className="min-w-0 truncate">
                    <span className="truncate">{r.value}</span>{" "}
                    {activeType === "All" && (
                      <span className="text-xs text-muted-foreground">
                        {r.traitType}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 text-xs">
                    <span className="font-semibold text-amber-400">
                      {r.burntPct}%
                    </span>
                    <span className="text-muted-foreground">
                      {r.burnt}/{r.total}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TokenLookupResult({
  id,
  collectionAddress,
}: {
  id: string;
  collectionAddress: string;
}) {
  const { data, isLoading, isError } = useBurntTokenLookup(id);

  if (isLoading) {
    return (
      <Card className="mt-3">
        <CardContent className="flex gap-4 p-4">
          <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data || data.exists === false) {
    return (
      <Card className="mt-3">
        <CardContent className="p-4 text-sm text-muted-foreground">
          No token <span className="font-medium text-foreground">#{id}</span>{" "}
          found in this collection.
        </CardContent>
      </Card>
    );
  }

  const burned = data.status === "burnt";
  return (
    <Card className="mt-3">
      <CardContent className="flex gap-4 p-4">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-white/[0.03]">
          <NFTMedia
            imageUrl={data.image ?? null}
            alt={data.name ?? `#${id}`}
            className={cn("h-full w-full object-cover", burned && "grayscale")}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">
              {data.name ?? `#${id}`}
            </span>
            <Badge variant={burned ? "destructive" : "success"}>
              {burned ? "Burnt" : "Alive"}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Token #{id}
            {data.owner ? ` · held by ${shortAddress(data.owner)}` : ""}
          </p>
          {data.traits && data.traits.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.traits.map((t) => (
                <span
                  key={`${t.traitType}~${t.value}`}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-xs"
                >
                  <span className="text-muted-foreground">{t.traitType}:</span>{" "}
                  {t.value}
                </span>
              ))}
            </div>
          )}
          {collectionAddress && (
            <a
              href={explorerTokenUrl(collectionAddress, id)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-ethereum-purple hover:underline"
            >
              View on Etherscan →
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TokenGallery({
  filter,
  traits,
  selected,
  onToggle,
}: {
  filter: BurntStatus;
  traits: SelectedTrait[];
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
  } = useBurntTokens(filter, traits);

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
        title="Nothing here"
        body={
          traits.length > 0
            ? "No tokens match the selected traits in this view."
            : filter === "burned"
              ? "No tokens have been burnt yet."
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

function TraitsDrawer({
  open,
  onClose,
  loading,
  types,
  selected,
  onToggle,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  types: TraitType[];
  selected: SelectedTrait[];
  onToggle: (t: SelectedTrait) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selectedIds = useMemo(
    () => new Set(selected.map((s) => `${s.traitType}~${s.value}`)),
    [selected],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return types;
    return types
      .map((t) => ({
        ...t,
        values: t.values.filter((v) =>
          v.value.toLowerCase().includes(q) ||
          t.traitType.toLowerCase().includes(q),
        ),
      }))
      .filter((t) => t.values.length > 0);
  }, [types, q]);

  function toggleExpand(traitType: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(traitType)) next.delete(traitType);
      else next.add(traitType);
      return next;
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      {/* Panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-ethereum-purple/20 bg-background shadow-xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <h2 className="text-lg font-semibold">Traits</h2>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear ({selected.length})
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="border-b border-border/60 p-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search traits"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No traits found.
            </p>
          ) : (
            visible.map((t) => {
              const isOpen = expanded.has(t.traitType) || q.length > 0;
              return (
                <div key={t.traitType} className="border-b border-border/40">
                  <button
                    onClick={() => toggleExpand(t.traitType)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02]"
                  >
                    <span className="font-medium capitalize">{t.traitType}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      {t.distinctValues}
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="pb-2">
                      {t.values.map((v) => {
                        const id = `${t.traitType}~${v.value}`;
                        const checked = selectedIds.has(id);
                        return (
                          <li key={id}>
                            <button
                              onClick={() =>
                                onToggle({ traitType: t.traitType, value: v.value })
                              }
                              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-white/[0.02]"
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  checked
                                    ? "border-ethereum-purple bg-ethereum-purple text-ethereum-black"
                                    : "border-border",
                                )}
                              >
                                {checked && <span className="text-[10px]">✓</span>}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {v.value}
                              </span>
                              {v.burnt > 0 && (
                                <span className="shrink-0 text-xs font-medium text-amber-400">
                                  {v.count > 0
                                    ? Math.round((v.burnt / v.count) * 1000) / 10
                                    : 0}
                                  %
                                </span>
                              )}
                              {v.burnt > 0 && (
                                <span className="shrink-0 text-xs text-amber-400/70">
                                  {v.burnt}🔥
                                </span>
                              )}
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {v.count}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
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
                collectionAddress ? explorerTokenUrl(collectionAddress, id) : "#"
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
