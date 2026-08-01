/**
 * Trait → stat system for the Battle Sheet and trait-driven combat.
 *
 * Each trait TYPE governs one combat stat (clothes = Armor, hands = Attack …).
 * A token's specific value grants a bonus scaled by how rare it is *relative to
 * the commonest value in its type* — so the rarest trait maxes the stat and the
 * commonest gives nothing, which spreads tokens out instead of bunching them at
 * the top (individual trait shares are all small).
 *
 * `specials` = the 1/1 legendaries: they have no other traits and are ranked
 * #1, so they fight with every stat maxed.
 *
 * This file is the single source of truth — retune here and the sheet and the
 * fighter derivation both follow.
 */

import type { Fighter } from "@/lib/combat/engine";

export type StatKey =
  | "hp"
  | "atk"
  | "block"
  | "crit"
  | "pierce"
  | "hit"
  | "dodge"
  | "spd";

export const STAT_META: Record<StatKey, { label: string; blurb: string }> = {
  hp: { label: "HP", blurb: "How much damage it can take." },
  atk: { label: "Attack", blurb: "Damage dealt per hit." },
  block: { label: "Armor", blurb: "Reduces incoming damage." },
  crit: { label: "Crit", blurb: "Chance to land a critical hit." },
  pierce: { label: "Pierce", blurb: "Cuts through the enemy's armor." },
  hit: { label: "Accuracy", blurb: "Chance to connect." },
  dodge: { label: "Dodge", blurb: "Chance to avoid an attack." },
  spd: { label: "Speed", blurb: "Strikes first." },
};

export const STAT_ORDER: StatKey[] = [
  "hp",
  "atk",
  "block",
  "crit",
  "pierce",
  "hit",
  "dodge",
  "spd",
];

/** "all" = a wildcard trait that maxes every stat (the 1/1 specials). */
export type TraitEffect = StatKey | "all";

const TRAIT_STAT: Record<string, TraitEffect> = {
  "belly pocket": "spd",
  clothes: "block", // Armor
  eyes: "crit",
  hands: "atk",
  head: "hit",
  mouth: "pierce",
  nose: "dodge",
  skin: "hp",
  specials: "all",
};

/** Trait types we don't use at all — not shown, no effect (e.g. backgrounds). */
export const IGNORED_TRAITS = new Set<string>(["backgrounds"]);

export function isIgnoredTrait(traitType: string): boolean {
  return IGNORED_TRAITS.has(traitType.trim().toLowerCase());
}

export function effectForTrait(traitType: string): TraitEffect | null {
  if (isIgnoredTrait(traitType)) return null;
  return TRAIT_STAT[traitType.trim().toLowerCase()] ?? null;
}

/** Peak bonus a single trait can add to a stat (the rarest value in its type). */
export const MAX_TRAIT_BONUS = 40;

/** True rarity share: tokens with this value / tokens in the type (for display). */
export function rarityRatio(count: number, typeTotal: number): number {
  if (typeTotal <= 0) return 0;
  return Math.min(1, Math.max(0, count / typeTotal));
}

/**
 * Stat bonus a value grants, relative to the commonest value in its type:
 * commonest → 0, rarest → ~MAX. This is the combat-relevant "power" of a trait.
 */
export function traitBonus(
  count: number,
  typeMaxCount: number,
  max = MAX_TRAIT_BONUS,
): number {
  if (typeMaxCount <= 0) return 0;
  return Math.round((1 - Math.min(1, count / typeMaxCount)) * max);
}

// ---------------------------------------------------------------------------
// Fighter derivation from real traits
// ---------------------------------------------------------------------------

export interface TraitPair {
  traitType: string;
  value: string;
}

export interface RarityIndex {
  get(typeLower: string): { maxCount: number; counts: Map<string, number> } | undefined;
}

/** Build a rarity lookup from the trait-summary types. */
export function buildRarityIndex(
  types: { traitType: string; values: { value: string; count: number }[] }[],
): RarityIndex {
  const map = new Map<string, { maxCount: number; counts: Map<string, number> }>();
  for (const t of types) {
    const counts = new Map<string, number>();
    let maxCount = 0;
    for (const v of t.values) {
      counts.set(v.value, v.count);
      if (v.count > maxCount) maxCount = v.count;
    }
    map.set(t.traitType.trim().toLowerCase(), { maxCount, counts });
  }
  return map;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const lerp = (a: number, b: number, p: number) => Math.round(a + (b - a) * clamp01(p));

function statsFromPower(
  tokenId: string,
  power: Record<StatKey, number>,
): Fighter {
  const atkMin = lerp(6, 20, power.atk);
  return {
    tokenId,
    maxHp: lerp(120, 260, power.hp),
    atkMin,
    atkMax: atkMin + lerp(12, 46, power.atk),
    spd: lerp(60, 140, power.spd),
    crit: lerp(5, 35, power.crit),
    pierce: lerp(5, 30, power.pierce),
    block: lerp(5, 50, power.block),
    hit: lerp(15, 35, power.hit),
    dodge: lerp(5, 30, power.dodge),
  };
}

/**
 * Derive a fighter from a token's real traits + the collection rarity index.
 * Returns null when there are no usable traits, so the caller can fall back to
 * the id-hash fighter. A specials (1/1) token maxes every stat.
 */
export function deriveFighterFromTraits(
  tokenId: string,
  traits: TraitPair[],
  index: RarityIndex,
): Fighter | null {
  if (!traits || traits.length === 0) return null;

  const power: Record<StatKey, number> = {
    hp: 0,
    atk: 0,
    block: 0,
    crit: 0,
    pierce: 0,
    hit: 0,
    dodge: 0,
    spd: 0,
  };

  const isSpecial = traits.some((t) => effectForTrait(t.traitType) === "all");
  if (isSpecial) {
    for (const k of STAT_ORDER) power[k] = 1;
    return statsFromPower(tokenId, power);
  }

  let matched = false;
  for (const t of traits) {
    const eff = effectForTrait(t.traitType);
    if (!eff || eff === "all") continue;
    const entry = index.get(t.traitType.trim().toLowerCase());
    if (!entry) continue;
    const count = entry.counts.get(t.value) ?? 0;
    const p = entry.maxCount > 0 ? 1 - count / entry.maxCount : 0;
    power[eff] = Math.max(power[eff], clamp01(p));
    matched = true;
  }
  if (!matched) return null;

  return statsFromPower(tokenId, power);
}
