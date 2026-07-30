/**
 * Deterministic turn-based combat for two T00ns token ids.
 *
 * Every token has stable stats derived from its id (same id → same fighter),
 * and a battle between two ids plays out identically each time unless a
 * different `seed` (a rematch counter) is supplied. Pure and side-effect free
 * so it can be unit-tested and run in the browser.
 */

export interface Fighter {
  tokenId: string;
  maxHp: number;
  atkMin: number;
  atkMax: number;
  spd: number;
  crit: number; // %
  pierce: number;
  block: number;
  hit: number;
  dodge: number;
}

export type CombatEventType = "hit" | "crit" | "dodge";

export interface CombatEvent {
  turn: number;
  attacker: string; // tokenId
  defender: string; // tokenId
  type: CombatEventType;
  damage: number;
  /** Defender HP remaining after this event. */
  defenderHp: number;
}

export interface CombatResult {
  a: Fighter;
  b: Fighter;
  events: CombatEvent[];
  /** tokenId of the winner, or null on a draw (round cap reached). */
  winner: string | null;
  rounds: number;
}

// --- deterministic RNG ---------------------------------------------------

function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scale a 0–1 roll into an integer range [min, max]. */
function span(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// --- fighter derivation --------------------------------------------------

/** Stable stat block for a token id. */
export function deriveFighter(tokenId: string): Fighter {
  const rng = mulberry32(hashSeed(`t00ns:${tokenId}`));
  const atkMin = span(rng, 6, 20);
  const atkMax = atkMin + span(rng, 12, 46);
  return {
    tokenId,
    maxHp: span(rng, 120, 260),
    atkMin,
    atkMax,
    spd: span(rng, 60, 140),
    crit: span(rng, 5, 35),
    pierce: span(rng, 5, 30),
    block: span(rng, 5, 50),
    hit: span(rng, 15, 35),
    dodge: span(rng, 5, 30),
  };
}

// --- simulation ----------------------------------------------------------

const MAX_ROUNDS = 60;
const CRIT_MULTIPLIER = 1.75;

function attack(
  rng: () => number,
  attacker: Fighter,
  defender: Fighter,
  defenderHp: number,
  turn: number,
): CombatEvent {
  // Dodge: scaled by the gap between defender dodge and attacker accuracy.
  const dodgeChance = Math.max(0, Math.min(35, defender.dodge - attacker.hit * 0.5));
  if (rng() * 100 < dodgeChance) {
    return {
      turn,
      attacker: attacker.tokenId,
      defender: defender.tokenId,
      type: "dodge",
      damage: 0,
      defenderHp,
    };
  }

  let dmg = span(rng, attacker.atkMin, attacker.atkMax);
  const isCrit = rng() * 100 < attacker.crit;
  if (isCrit) dmg *= CRIT_MULTIPLIER;

  // Block, reduced by the attacker's pierce, with diminishing returns.
  const effBlock = Math.max(0, defender.block - attacker.pierce);
  dmg *= 1 - effBlock / (effBlock + 100);

  const damage = Math.max(1, Math.round(dmg));
  const hpAfter = Math.max(0, defenderHp - damage);
  return {
    turn,
    attacker: attacker.tokenId,
    defender: defender.tokenId,
    type: isCrit ? "crit" : "hit",
    damage,
    defenderHp: hpAfter,
  };
}

export function simulate(a: Fighter, b: Fighter, seed = 0): CombatResult {
  const rng = mulberry32(
    hashSeed(`fight:${a.tokenId}:${b.tokenId}:${seed}`),
  );

  // Faster fighter strikes first; ties broken by id for stability.
  const aFirst =
    a.spd !== b.spd ? a.spd > b.spd : Number(a.tokenId) <= Number(b.tokenId);

  let hpA = a.maxHp;
  let hpB = b.maxHp;
  const events: CombatEvent[] = [];
  let turn = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const order: [Fighter, Fighter][] = aFirst
      ? [[a, b], [b, a]]
      : [[b, a], [a, b]];

    for (const [attacker, defender] of order) {
      if (hpA <= 0 || hpB <= 0) break;
      turn++;
      const defenderHp = defender.tokenId === a.tokenId ? hpA : hpB;
      const ev = attack(rng, attacker, defender, defenderHp, turn);
      if (defender.tokenId === a.tokenId) hpA = ev.defenderHp;
      else hpB = ev.defenderHp;
      events.push(ev);
    }

    if (hpA <= 0 || hpB <= 0) {
      return {
        a,
        b,
        events,
        winner: hpA <= 0 && hpB <= 0 ? null : hpA <= 0 ? b.tokenId : a.tokenId,
        rounds: round,
      };
    }
  }

  // Round cap: higher remaining HP fraction wins, else draw.
  const fracA = hpA / a.maxHp;
  const fracB = hpB / b.maxHp;
  return {
    a,
    b,
    events,
    winner: fracA === fracB ? null : fracA > fracB ? a.tokenId : b.tokenId,
    rounds: MAX_ROUNDS,
  };
}
