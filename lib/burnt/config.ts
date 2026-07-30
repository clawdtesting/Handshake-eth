/**
 * Configuration for the "Burnt" page — a public burn tracker for a single
 * collection whose holders are voluntarily burning pieces "for the culture".
 *
 * Everything here is overridable by env so the same code can point at a
 * different collection, correct the original mint size, or teach it about a
 * bespoke burn contract without a code change.
 */

const DEFAULT_COLLECTION =
  "0x902d94ba5bfc0cb408d1a6ca4b8f255d845e50e9" as const;

/** How many were minted originally, before any burning. */
const DEFAULT_INITIAL_SUPPLY = 5000;

// The two universal sinks: the zero address (a real ERC-721 `_burn` moves the
// token here and it stops existing) and the conventional 0x…dEaD address (the
// token still exists but is provably unrecoverable). Both count as "gone".
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
export const DEAD_ADDRESS =
  "0x000000000000000000000000000000000000dead" as const;

function isAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function envAddress(name: string, fallback: string): `0x${string}` {
  const raw = process.env[name]?.trim().toLowerCase();
  return (raw && isAddress(raw) ? raw : fallback) as `0x${string}`;
}

/** The tracked collection contract, lowercased. */
export const BURNT_COLLECTION_ADDRESS = envAddress(
  "BURNT_COLLECTION_ADDRESS",
  DEFAULT_COLLECTION,
);

export const BURNT_INITIAL_SUPPLY = (() => {
  const raw = Number(process.env.BURNT_INITIAL_SUPPLY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_INITIAL_SUPPLY;
})();

/**
 * Every address that means "burned". Zero and dead are always included; extra
 * sinks (e.g. a project-specific burn contract that holds tokens rather than
 * destroying them) can be added via a comma-separated BURNT_EXTRA_BURN_ADDRESSES.
 */
export const BURN_ADDRESSES: readonly `0x${string}`[] = (() => {
  const extra = (process.env.BURNT_EXTRA_BURN_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(isAddress) as `0x${string}`[];
  return Array.from(new Set([ZERO_ADDRESS, DEAD_ADDRESS, ...extra]));
})();

const BURN_SET = new Set<string>(BURN_ADDRESSES.map((a) => a.toLowerCase()));

/** True when an address is one of the configured burn sinks. */
export function isBurnAddress(address?: string | null): boolean {
  return !!address && BURN_SET.has(address.toLowerCase());
}
