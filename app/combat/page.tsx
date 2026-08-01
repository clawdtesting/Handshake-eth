"use client";

import { useEffect, useMemo, useState } from "react";
import { Swords } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Arena } from "@/components/combat/arena";
import { useBurntTokenLookup, useBurntTraits } from "@/hooks/use-burnt";
import {
  deriveFighter,
  simulate,
  type CombatResult,
  type Fighter,
} from "@/lib/combat/engine";
import { buildRarityIndex, deriveFighterFromTraits } from "@/lib/combat/trait-stats";

export default function CombatPage() {
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [idA, setIdA] = useState<string | null>(null);
  const [idB, setIdB] = useState<string | null>(null);
  const [seed, setSeed] = useState(0);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);

  const lookupA = useBurntTokenLookup(idA);
  const lookupB = useBurntTokenLookup(idB);
  const { data: traitsData } = useBurntTraits();
  const rarityIndex = useMemo(
    () => (traitsData ? buildRarityIndex(traitsData.types) : null),
    [traitsData],
  );

  // Stats come from each token's real traits (rarity-weighted); id-hash is the
  // fallback when metadata/traits aren't available.
  const fighters = useMemo<{ a: Fighter; b: Fighter } | null>(() => {
    if (!idA || !idB) return null;
    const fa =
      (rarityIndex && lookupA.data?.traits
        ? deriveFighterFromTraits(idA, lookupA.data.traits, rarityIndex)
        : null) ?? deriveFighter(idA);
    const fb =
      (rarityIndex && lookupB.data?.traits
        ? deriveFighterFromTraits(idB, lookupB.data.traits, rarityIndex)
        : null) ?? deriveFighter(idB);
    return { a: fa, b: fb };
  }, [idA, idB, rarityIndex, lookupA.data, lookupB.data]);

  const result = useMemo<CombatResult | null>(() => {
    if (!fighters) return null;
    return simulate(fighters.a, fighters.b, seed);
  }, [fighters, seed]);

  // Reset playback whenever the fight (stats or seed) changes.
  useEffect(() => {
    setIdx(0);
    setPlaying(true);
  }, [result]);

  // Step through the battle.
  useEffect(() => {
    if (!result || !playing) return;
    if (idx >= result.events.length) return;
    const t = setTimeout(() => setIdx((i) => i + 1), 650);
    return () => clearTimeout(t);
  }, [result, playing, idx]);

  function startFight() {
    const a = inputA.trim().replace(/^#/, "");
    const b = inputB.trim().replace(/^#/, "");
    if (!/^\d{1,10}$/.test(a) || !/^\d{1,10}$/.test(b)) return;
    setIdA(a);
    setIdB(b);
    setSeed(0);
  }

  const bothExist =
    lookupA.data?.exists !== false && lookupB.data?.exists !== false;
  const loading = lookupA.isLoading || lookupB.isLoading;
  const done = !!result && idx >= result.events.length;
  const lastEvent =
    result && idx > 0 ? result.events[Math.min(idx, result.events.length) - 1] : null;

  const nameOf = (id: string) =>
    (id === idA ? lookupA.data?.name : lookupB.data?.name) ?? `#${id}`;

  return (
    <div className="container mx-auto px-4 pb-20">
      <section className="py-12">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ethereum-purple">
          <Swords className="h-3.5 w-3.5" /> Combat
        </p>
        <h1 className="text-3xl font-semibold">T00ns Arena</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Pick two T00ns by token id and watch them battle. Each token&apos;s
          stats are derived from its id, so the same fighters always bring the
          same kit — hit Rematch to reroll the fight.
        </p>
      </section>

      {/* Fighter pickers */}
      <Card>
        <CardContent className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-end">
          <FighterInput
            label="Fighter A"
            value={inputA}
            onChange={setInputA}
            onEnter={startFight}
          />
          <span className="self-center px-2 text-sm font-semibold text-muted-foreground">
            VS
          </span>
          <FighterInput
            label="Fighter B"
            value={inputB}
            onChange={setInputB}
            onEnter={startFight}
          />
          <button
            onClick={startFight}
            className="rounded-lg bg-ethereum-purple px-5 py-2.5 text-sm font-semibold text-ethereum-black transition-colors hover:bg-ethereum-purple/90"
          >
            Fight
          </button>
        </CardContent>
      </Card>

      {idA && idB && (
        <div className="mt-6">
          {loading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : !bothExist ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                {lookupA.data?.exists === false && (
                  <p>Token #{idA} isn&apos;t part of this collection.</p>
                )}
                {lookupB.data?.exists === false && (
                  <p>Token #{idB} isn&apos;t part of this collection.</p>
                )}
              </CardContent>
            </Card>
          ) : result ? (
            <Arena
              result={result}
              idx={idx}
              lastEvent={lastEvent}
              done={done}
              playing={playing}
              onTogglePlay={() => setPlaying((p) => !p)}
              onRematch={() => setSeed((s) => s + 1)}
              onReplay={() => {
                setIdx(0);
                setPlaying(true);
              }}
              nameOf={nameOf}
              imageA={lookupA.data?.image ?? null}
              imageB={lookupB.data?.image ?? null}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function FighterInput({
  label,
  value,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <label className="flex-1">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter()}
        inputMode="numeric"
        placeholder="Token id — e.g. 3458"
        className="w-full rounded-lg border border-border/60 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-ethereum-purple/50"
      />
    </label>
  );
}
