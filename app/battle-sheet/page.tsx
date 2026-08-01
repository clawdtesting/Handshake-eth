"use client";

import { ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useBurntTraits, type TraitType } from "@/hooks/use-burnt";
import {
  STAT_META,
  STAT_ORDER,
  effectForTrait,
  isIgnoredTrait,
  rarityBonus,
  type TraitEffect,
} from "@/lib/combat/trait-stats";
import { cn } from "@/lib/utils";

function effectLabel(effect: TraitEffect | null): string {
  if (!effect) return "cosmetic";
  if (effect === "all") return "All stats";
  return STAT_META[effect].label;
}

export default function BattleSheetPage() {
  const { data, isLoading, isError } = useBurntTraits();
  const types = (data?.types ?? []).filter((t) => !isIgnoredTrait(t.traitType));

  return (
    <div className="container mx-auto px-4 pb-20">
      <section className="py-12">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ethereum-purple">
          <ScrollText className="h-3.5 w-3.5" /> Battle Sheet
        </p>
        <h1 className="text-3xl font-semibold">How traits become stats</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every trait type powers one combat stat, and the rarer your trait, the
          bigger the bonus. Here&apos;s every trait, its rarity, and what it
          grants.
        </p>
      </section>

      {/* Stat legend */}
      <Card className="mb-8">
        <CardContent className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            The stats
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {STAT_ORDER.map((s) => (
              <div key={s}>
                <p className="text-sm font-semibold">{STAT_META[s].label}</p>
                <p className="text-xs text-muted-foreground">{STAT_META[s].blurb}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <EmptyState
          title="Couldn't load traits"
          body="The trait summary didn't respond. Try again in a moment."
        />
      ) : isLoading ? (
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {types.map((t) => (
            <TraitCard key={t.traitType} type={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraitCard({ type }: { type: TraitType }) {
  const effect = effectForTrait(type.traitType);
  const total = type.values.reduce((sum, v) => sum + v.count, 0);
  // Rarest first — those grant the biggest bonuses.
  const rows = [...type.values].sort((a, b) => a.count - b.count);
  const isSpecials = type.traitType.trim().toLowerCase() === "specials";

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold capitalize">{type.traitType}</h3>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              effect
                ? "bg-ethereum-purple/15 text-ethereum-purple"
                : "bg-white/[0.04] text-muted-foreground",
            )}
          >
            → {effectLabel(effect)}
          </span>
        </div>

        {isSpecials && (
          <p className="mb-3 -mt-1 text-xs text-amber-300/80">
            The 1/1 legendaries — no other traits, ranked #1. They fight with max
            stats across the board.
          </p>
        )}

        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">Trait</th>
                <th className="py-1 text-right font-normal">Rarity</th>
                <th className="py-1 text-right font-normal">
                  {effect ? "Bonus" : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const pct = total > 0 ? (v.count / total) * 100 : 0;
                const bonus = rarityBonus(v.count, total);
                return (
                  <tr key={v.value} className="border-t border-border/40">
                    <td className="py-1.5 pr-2">
                      <span className="truncate">{v.value}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({v.count})
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {effect ? (
                        <span className="font-semibold text-amber-400">+{bonus}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
