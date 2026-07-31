/**
 * Loser flavour lines for the end of a fight, rendered as
 * `just t00ns #<loser> <taunt>`. Picked deterministically per fight so a given
 * matchup+seed always shows the same line (and a Rematch rerolls it).
 */
export const TAUNTS = [
  "is officially exit liquidity.",
  "is NGMI.",
  "got farmed.",
  "is coping.",
  "got rekt.",
  "faded the alpha.",
  "paper-handed the fight.",
  "bought the top.",
  "sold the bottom.",
  "lost to pure alpha.",
  "couldn't cook.",
  "got rugged by reality.",
  "needs better traits.",
  "forgot to mint luck.",
  "got one-tapped.",
  "got ratio'd.",
  "lost the gas war.",
  "should've HODLed confidence.",
  "brought common vibes.",
  "wasn't built on-chain.",
  "got sent back to reveal.",
  "is delisting itself.",
  "missed the meta.",
  "has weak aura.",
  "got liquidated.",
  "is all floor, no alpha.",
  "couldn't survive mainnet.",
  "got sent to testnet.",
  "forgot to stake courage.",
  "is now community lore.",
] as const;

/** Draw lines, when neither T00n wins. */
export const DRAW_LINES = [
  "both t00ns ran out of gas.",
  "both t00ns fought to a stalemate.",
  "GGs — nobody caught the top.",
] as const;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable taunt for a fight, keyed by a seed string. */
export function pickTaunt(seed: string): string {
  return TAUNTS[hash(seed) % TAUNTS.length];
}

export function pickDraw(seed: string): string {
  return DRAW_LINES[hash(seed) % DRAW_LINES.length];
}
