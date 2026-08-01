/**
 * Trait → stat system for the Battle Sheet (and, later, trait-driven combat).
 *
 * Each trait TYPE governs one combat stat (clothes = Armor, hands = Attack …).
 * Within a type, a token's specific value grants a bonus scaled by that value's
 * RARITY: the rarer the trait, the bigger the stat it gives.
 *
 * This file is the single source of truth — retune the mapping or the numbers
 * here and both the sheet and any stat derivation follow.
 */

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

/** "all" = a wildcard trait that buffs every stat a little (e.g. specials). */
export type TraitEffect = StatKey | "all";

/**
 * Trait type (lowercased) → stat it governs. The eight real trait types map
 * one-to-one onto the eight stats; `specials` is a wildcard that buffs all.
 * Unknown/extra types fall back to `null` (cosmetic). Edit freely.
 */
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

/** Peak bonus a single trait can add to a stat (a 1-of-1 value). */
export const MAX_TRAIT_BONUS = 40;

/**
 * Rarity as a 0–1 share: count of tokens with this value / tokens in the type.
 * Lower = rarer.
 */
export function rarityRatio(count: number, typeTotal: number): number {
  if (typeTotal <= 0) return 0;
  return Math.min(1, Math.max(0, count / typeTotal));
}

/**
 * Stat bonus this value grants: rarer → bigger. A unique value approaches
 * MAX_TRAIT_BONUS; a value on half the collection gives about half.
 */
export function rarityBonus(
  count: number,
  typeTotal: number,
  max = MAX_TRAIT_BONUS,
): number {
  return Math.round((1 - rarityRatio(count, typeTotal)) * max);
}
