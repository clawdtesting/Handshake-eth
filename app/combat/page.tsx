"use client";

import { useEffect, useMemo, useState } from "react";
import { Swords, Play, Pause, RotateCcw, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NFTMedia } from "@/components/ui/nft-media";
import { useBurntTokenLookup } from "@/hooks/use-burnt";
import {
  deriveFighter,
  simulate,
  type CombatEvent,
  type CombatResult,
  type Fighter,
} from "@/lib/combat/engine";
import { cn } from "@/lib/utils";

function currentHp(result: CombatResult, idx: number, tokenId: string): number {
  const f = tokenId === result.a.tokenId ? result.a : result.b;
  let hp = f.maxHp;
  for (let i = 0; i < idx && i < result.events.length; i++) {
    const e = result.events[i];
    if (e.defender === tokenId) hp = e.defenderHp;
  }
  return hp;
}

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

  const fighters = useMemo<{ a: Fighter; b: Fighter } | null>(() => {
    if (!idA || !idB) return null;
    return { a: deriveFighter(idA), b: deriveFighter(idB) };
  }, [idA, idB]);

  const result = useMemo<CombatResult | null>(() => {
    if (!fighters) return null;
    return simulate(fighters.a, fighters.b, seed);
  }, [fighters, seed]);

  // Reset playback whenever the matchup or seed changes.
  useEffect(() => {
    setIdx(0);
    setPlaying(true);
  }, [idA, idB, seed]);

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

function Arena({
  result,
  idx,
  lastEvent,
  done,
  playing,
  onTogglePlay,
  onRematch,
  onReplay,
  nameOf,
  imageA,
  imageB,
}: {
  result: CombatResult;
  idx: number;
  lastEvent: CombatEvent | null;
  done: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  onRematch: () => void;
  onReplay: () => void;
  nameOf: (id: string) => string;
  imageA: string | null;
  imageB: string | null;
}) {
  const { a, b } = result;
  const hpA = currentHp(result, idx, a.tokenId);
  const hpB = currentHp(result, idx, b.tokenId);
  const winnerName = result.winner ? nameOf(result.winner) : null;

  return (
    <div className="space-y-4">
      {/* HP header */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <HpBar name={nameOf(a.tokenId)} hp={hpA} max={a.maxHp} align="left" />
        <span className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
          VS
        </span>
        <HpBar name={nameOf(b.tokenId)} hp={hpB} max={b.maxHp} align="right" />
      </div>

      {/* Arena */}
      <Card className="overflow-hidden">
        <CardContent className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[220px_1fr_220px]">
          <StatPanel fighter={a} image={imageA} name={nameOf(a.tokenId)} fainted={hpA <= 0} />

          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-border/40 bg-gradient-to-b from-ethereum-purple/5 to-transparent p-4 text-center">
            {done ? (
              <div className="flex flex-col items-center gap-2">
                <Trophy className="h-8 w-8 text-amber-400" />
                <p className="text-lg font-semibold">
                  {winnerName ? `${winnerName} wins!` : "Draw!"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.rounds} rounds · {result.events.length} moves
                </p>
              </div>
            ) : lastEvent ? (
              <EventLine event={lastEvent} nameOf={nameOf} />
            ) : (
              <p className="text-sm text-muted-foreground">Fight!</p>
            )}

            <div className="mt-2 flex items-center gap-2">
              {done ? (
                <button
                  onClick={onReplay}
                  className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-sm hover:border-ethereum-purple/40"
                >
                  <RotateCcw className="h-4 w-4" /> Replay
                </button>
              ) : (
                <button
                  onClick={onTogglePlay}
                  className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-sm hover:border-ethereum-purple/40"
                >
                  {playing ? (
                    <>
                      <Pause className="h-4 w-4" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" /> Play
                    </>
                  )}
                </button>
              )}
              <button
                onClick={onRematch}
                className="flex items-center gap-1.5 rounded-md bg-ethereum-purple/15 px-3 py-1.5 text-sm text-ethereum-purple hover:bg-ethereum-purple/25"
              >
                <Swords className="h-4 w-4" /> Rematch
              </button>
            </div>
          </div>

          <StatPanel
            fighter={b}
            image={imageB}
            name={nameOf(b.tokenId)}
            fainted={hpB <= 0}
            mirror
          />
        </CardContent>
      </Card>

      {/* Combat log */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Combat log
          </h2>
          <ol className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {result.events.slice(0, idx).map((e, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                  {i + 1}
                </span>
                <EventLine event={e} nameOf={nameOf} compact />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function EventLine({
  event,
  nameOf,
  compact,
}: {
  event: CombatEvent;
  nameOf: (id: string) => string;
  compact?: boolean;
}) {
  const attacker = nameOf(event.attacker);
  const defender = nameOf(event.defender);
  if (event.type === "dodge") {
    return (
      <span className={compact ? "text-muted-foreground" : "text-base"}>
        <b>{defender}</b> dodged <b>{attacker}</b>&apos;s attack
      </span>
    );
  }
  const crit = event.type === "crit";
  return (
    <span className={compact ? "" : "text-base"}>
      <b>{attacker}</b> hits <b>{defender}</b> for{" "}
      <span
        className={cn(
          "font-semibold",
          crit ? "text-amber-400" : "text-red-400",
        )}
      >
        {event.damage}
        {crit && " CRIT!"}
      </span>
    </span>
  );
}

function HpBar({
  name,
  hp,
  max,
  align,
}: {
  name: string;
  hp: number;
  max: number;
  align: "left" | "right";
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  const color =
    pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {Math.round(hp)}/{max}
        </span>
      </div>
      <div
        className={cn(
          "h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]",
          align === "right" && "flex justify-end",
        )}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatPanel({
  fighter,
  image,
  name,
  fainted,
  mirror,
}: {
  fighter: Fighter;
  image: string | null;
  name: string;
  fainted: boolean;
  mirror?: boolean;
}) {
  const stats: [string, number | string][] = [
    ["ATK", `${fighter.atkMin}–${fighter.atkMax}`],
    ["SPD", fighter.spd],
    ["CRIT", fighter.crit],
    ["PIERCE", fighter.pierce],
    ["BLOCK", fighter.block],
    ["HIT", fighter.hit],
    ["DODGE", fighter.dodge],
  ];
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-3">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-border",
            fainted && "grayscale",
          )}
        >
          <NFTMedia
            imageUrl={image}
            alt={name}
            className={cn("h-full w-full object-cover", mirror && "-scale-x-100")}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="text-xs text-muted-foreground">HP {fighter.maxHp}</span>
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {stats.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
