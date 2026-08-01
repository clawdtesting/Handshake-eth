"use client";

import { useState } from "react";
import { Gem, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { NFTMedia } from "@/components/ui/nft-media";
import {
  useCollectionRarity,
  type CollectionRarity,
  type RarityTrait,
} from "@/hooks/use-rarity";
import { explorerAddressUrl } from "@/lib/chains/ethereum";

export default function RarityPage() {
  const [input, setInput] = useState("");
  const [contract, setContract] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useCollectionRarity(contract);

  function submit() {
    const c = input.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(c)) setContract(c.toLowerCase());
  }

  return (
    <div className="container mx-auto px-4 pb-20">
      <section className="py-12">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ethereum-purple">
          <Gem className="h-3.5 w-3.5" /> Rarity
        </p>
        <h1 className="text-3xl font-semibold">Collection rarity</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Paste any Ethereum NFT contract address to see its trait breakdown —
          every trait, its values, and how rare each one is.
        </p>
      </section>

      {/* Contract input */}
      <div className="flex max-w-xl items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="0x… contract address"
          spellCheck={false}
          className="w-full bg-transparent py-1.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
        <button
          onClick={submit}
          className="shrink-0 rounded-md bg-ethereum-purple px-4 py-1.5 text-sm font-semibold text-ethereum-black hover:bg-ethereum-purple/90"
        >
          Load
        </button>
      </div>
      {input && !/^0x[0-9a-fA-F]{40}$/.test(input.trim()) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Enter a full 42-character contract address (0x…).
        </p>
      )}

      {contract && (
        <div className="mt-8">
          {isLoading ? (
            <div className="grid gap-5 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              title="Couldn't load rarity"
              body={(error as Error)?.message ?? "Try again in a moment."}
            />
          ) : data ? (
            <RarityResult data={data} contract={contract} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function RarityResult({
  data,
  contract,
}: {
  data: CollectionRarity;
  contract: string;
}) {
  if (data.types.length === 0) {
    return (
      <EmptyState
        title="No trait data"
        body="Alchemy has no traits for this contract on Ethereum mainnet — the collection may be on another chain (Base, Polygon…), not indexed, or its tokens have no on-chain attributes."
      />
    );
  }
  return (
    <div>
      {/* Collection header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-border">
          <NFTMedia
            imageUrl={data.image}
            alt={data.name ?? "collection"}
            className="h-full w-full object-cover"
          />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {data.name ?? "Unnamed collection"}
          </h2>
          <a
            href={explorerAddressUrl(contract)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-muted-foreground hover:text-ethereum-purple"
          >
            {contract.slice(0, 8)}…{contract.slice(-6)}
          </a>
          {data.totalSupply != null && (
            <span className="ml-2 text-xs text-muted-foreground">
              · {data.totalSupply.toLocaleString()} items
            </span>
          )}
        </div>
      </div>

      {data.source === "tokens" && (
        <p className="mb-4 text-xs text-muted-foreground">
          Tallied from {data.sampled.toLocaleString()} tokens&apos; metadata
          {data.truncated
            ? " (large collection — rarities are approximate from a sample)."
            : "."}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {data.types.map((t) => (
          <TraitCard key={t.traitType} type={t} />
        ))}
      </div>
    </div>
  );
}

function TraitCard({ type }: { type: RarityTrait }) {
  const total = type.values.reduce((s, v) => s + v.count, 0);
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold capitalize">{type.traitType}</h3>
          <span className="text-xs text-muted-foreground">
            {type.distinctValues} values
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">Trait</th>
                <th className="py-1 text-right font-normal">Items</th>
                <th className="py-1 text-right font-normal">Rarity</th>
              </tr>
            </thead>
            <tbody>
              {type.values.map((v) => {
                const pct = total > 0 ? (v.count / total) * 100 : 0;
                return (
                  <tr key={v.value} className="border-t border-border/40">
                    <td className="py-1.5 pr-2 truncate">{v.value}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {v.count.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      <span className="font-medium text-ethereum-purple">
                        {pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
