"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Pause, Play, RotateCcw, Swords, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NFTMedia } from "@/components/ui/nft-media";
import { CutoutImage } from "@/components/ui/cutout-image";
import type { CombatEvent, CombatResult, Fighter } from "@/lib/combat/engine";
import { pickDraw, pickLoserLine } from "@/lib/combat/taunts";
import { cn } from "@/lib/utils";

/** HP of a fighter after applying the first `idx` events. */
export function currentHp(
  result: CombatResult,
  idx: number,
  tokenId: string,
): number {
  const f = tokenId === result.a.tokenId ? result.a : result.b;
  let hp = f.maxHp;
  for (let i = 0; i < idx && i < result.events.length; i++) {
    const e = result.events[i];
    if (e.defender === tokenId) hp = e.defenderHp;
  }
  return hp;
}

export function Arena({
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
  hideControls,
  overlayAction,
}: {
  result: CombatResult;
  idx: number;
  lastEvent: CombatEvent | null;
  done: boolean;
  playing?: boolean;
  onTogglePlay?: () => void;
  onRematch?: () => void;
  onReplay?: () => void;
  nameOf: (id: string) => string;
  imageA: string | null;
  imageB: string | null;
  hideControls?: boolean;
  /** Rendered inside the winner overlay, under the result text. */
  overlayAction?: ReactNode;
}) {
  const { a, b } = result;
  const hpA = currentHp(result, idx, a.tokenId);
  const hpB = currentHp(result, idx, b.tokenId);

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

      {/* Animated battle stage */}
      <BattleStage
        result={result}
        idx={idx}
        lastEvent={lastEvent}
        done={done}
        imageA={imageA}
        imageB={imageB}
        nameA={nameOf(a.tokenId)}
        nameB={nameOf(b.tokenId)}
        hpA={hpA}
        hpB={hpB}
        overlayAction={overlayAction}
      />

      {/* Controls */}
      {!hideControls && (
        <div className="flex items-center justify-center gap-2">
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
      )}

      {/* Stat panels */}
      <div className="grid grid-cols-2 gap-4">
        <StatPanel fighter={a} image={imageA} name={nameOf(a.tokenId)} fainted={hpA <= 0} />
        <StatPanel
          fighter={b}
          image={imageB}
          name={nameOf(b.tokenId)}
          fainted={hpB <= 0}
          mirror
        />
      </div>

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

interface Pop {
  key: number;
  side: "a" | "b";
  text: string;
  crit: boolean;
  dodge: boolean;
}

function BattleStage({
  result,
  idx,
  lastEvent,
  done,
  imageA,
  imageB,
  nameA,
  nameB,
  hpA,
  hpB,
  overlayAction,
}: {
  result: CombatResult;
  idx: number;
  lastEvent: CombatEvent | null;
  done: boolean;
  imageA: string | null;
  imageB: string | null;
  nameA: string;
  nameB: string;
  hpA: number;
  hpB: number;
  overlayAction?: ReactNode;
}) {
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<Pop | null>(null);

  // Drive sprite motion from each combat event.
  useEffect(() => {
    if (!lastEvent) return;
    const attackerIsA = lastEvent.attacker === result.a.tokenId;
    const atkEl = (attackerIsA ? aRef : bRef).current;
    const defEl = (attackerIsA ? bRef : aRef).current;
    const dir = attackerIsA ? 1 : -1; // A lunges right, B lunges left
    const defenderSide: "a" | "b" = attackerIsA ? "b" : "a";

    atkEl?.animate(
      [
        { transform: "translateX(0)" },
        { transform: `translateX(${dir * 46}px) scale(1.06)`, offset: 0.45 },
        { transform: "translateX(0)" },
      ],
      { duration: 430, easing: "ease-out" },
    );

    if (lastEvent.type === "dodge") {
      defEl?.animate(
        [
          { transform: "translateY(0)" },
          { transform: `translateY(-26px) translateX(${dir * 12}px)`, offset: 0.5 },
          { transform: "translateY(0)" },
        ],
        { duration: 430, easing: "ease-out" },
      );
      setPop({ key: idx, side: defenderSide, text: "DODGE", crit: false, dodge: true });
    } else {
      defEl?.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-7px)" },
          { transform: "translateX(7px)" },
          { transform: "translateX(-4px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 300, easing: "ease-in-out", delay: 110 },
      );
      setPop({
        key: idx,
        side: defenderSide,
        text: `-${lastEvent.damage}`,
        crit: lastEvent.type === "crit",
        dodge: false,
      });
    }
  }, [idx, lastEvent, result]);

  return (
    <div className="relative h-64 overflow-hidden rounded-xl border border-border/40 bg-gradient-to-b from-ethereum-purple/10 via-background to-fuchsia-500/5">
      {/* ground line */}
      <div className="absolute inset-x-0 bottom-14 h-px bg-white/10" />

      {/* current action text */}
      <div className="absolute inset-x-0 top-3 flex justify-center px-4">
        {!done && lastEvent && (
          <span className="rounded-full bg-background/70 px-3 py-1 text-xs backdrop-blur">
            <EventLine
              event={lastEvent}
              nameOf={(id) => (id === result.a.tokenId ? nameA : nameB)}
              compact
            />
          </span>
        )}
      </div>

      <Sprite
        ref={aRef}
        image={imageA}
        name={nameA}
        side="a"
        fainted={hpA <= 0}
        pop={pop?.side === "a" ? pop : null}
      />
      <Sprite
        ref={bRef}
        image={imageB}
        name={nameB}
        side="b"
        fainted={hpB <= 0}
        pop={pop?.side === "b" ? pop : null}
      />

      {/* Winner overlay */}
      {done &&
        (() => {
          const winnerId = result.winner;
          const loserId = winnerId
            ? winnerId === result.a.tokenId
              ? result.b.tokenId
              : result.a.tokenId
            : null;
          const seed = `${winnerId ?? "draw"}:${loserId ?? ""}:${result.rounds}:${result.events.length}`;
          return (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 px-4 text-center backdrop-blur-sm">
              <Trophy className="h-9 w-9 text-amber-400" />
              {winnerId && loserId ? (
                <>
                  <p className="text-xl font-semibold">
                    just t00ns #{winnerId} wins!
                  </p>
                  <p className="text-sm text-amber-300/90">
                    {pickLoserLine(seed, loserId)}
                  </p>
                </>
              ) : (
                <p className="text-lg font-semibold">{pickDraw(seed)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {result.rounds} rounds · {result.events.length} moves
              </p>
              {overlayAction && <div className="mt-3">{overlayAction}</div>}
            </div>
          );
        })()}
    </div>
  );
}

const Sprite = ({
  ref,
  image,
  name,
  side,
  fainted,
  pop,
}: {
  ref: RefObject<HTMLDivElement | null>;
  image: string | null;
  name: string;
  side: "a" | "b";
  fainted: boolean;
  pop: Pop | null;
}) => {
  return (
    <div
      className={cn(
        "absolute bottom-8",
        side === "a" ? "left-6 sm:left-16" : "right-6 sm:right-16",
      )}
    >
      <div
        className={cn(!fainted && "combat-idle")}
        style={fainted ? { transform: "rotate(10deg) translateY(8px)" } : undefined}
      >
        <div ref={ref} className="relative">
          {pop && (
            <span
              key={pop.key}
              className={cn(
                "combat-float pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 text-lg font-bold",
                pop.dodge
                  ? "text-muted-foreground"
                  : pop.crit
                    ? "text-amber-400"
                    : "text-red-400",
              )}
            >
              {pop.text}
              {pop.crit && "!"}
            </span>
          )}
          {/* ground shadow */}
          <span className="absolute -bottom-1 left-1/2 h-2 w-16 -translate-x-1/2 rounded-[50%] bg-black/40 blur-sm sm:w-20" />
          <span
            className={cn(
              "block h-28 w-28 sm:h-32 sm:w-32",
              fainted && "grayscale",
            )}
          >
            <CutoutImage
              imageUrl={image}
              alt={name}
              className={cn(
                "h-full w-full object-contain [filter:drop-shadow(0_4px_5px_rgba(0,0,0,0.5))]",
                side === "b" && "-scale-x-100",
              )}
            />
          </span>
        </div>
      </div>
    </div>
  );
};

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
      <span className={cn("font-semibold", crit ? "text-amber-400" : "text-red-400")}>
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
