#!/usr/bin/env node
/*
 * Post-deploy allowlist verification for the Handshake contract.
 *
 * Read-only — no private key, no gas. For each launch-seed collection it reads
 * isCollectionAllowed (expected: true) and collectionAllowedAt (expected: > 0),
 * then reads a control address that must NOT be allowed. Prints a table and
 * exits non-zero if any check fails, so it can gate a deploy pipeline.
 *
 * Usage:
 *   export ETH_MAINNET_RPC_URL=https://rpc.ethereum.xyz
 *   export HANDSHAKE_ADDRESS=0x...          # the freshly deployed contract
 *   # optional: override the seed set (comma-separated addresses)
 *   # export INITIAL_COLLECTIONS=0xabc...,0xdef...
 *   node scripts/verify-allowlist.mjs
 *   # or: npm run verify:allowlist
 */

import { createPublicClient, http, getAddress, isAddress } from "viem";

const RPC = process.env.ETH_MAINNET_RPC_URL ?? "https://rpc.ethereum.xyz";
const HANDSHAKE = process.env.HANDSHAKE_ADDRESS;

if (!HANDSHAKE || !isAddress(HANDSHAKE)) {
  console.error(
    "Set HANDSHAKE_ADDRESS to the deployed Handshake contract address.",
  );
  process.exit(2);
}

// Launch seed set (name → address). Overridden by INITIAL_COLLECTIONS if set —
// keep this in sync with what you actually passed at deploy time. T00ns is the
// sole launch collection on Ethereum mainnet; all Monad-era collections were
// removed post-migration.
const DEFAULT_SEED = [
  ["T00ns", "0x902D94Ba5bFc0cb408D1A6Ca4B8F255d845E50e9"],
];

const seeds = process.env.INITIAL_COLLECTIONS
  ? process.env.INITIAL_COLLECTIONS.split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => [a, a])
  : DEFAULT_SEED;

// A control address that must NOT be on the allowlist.
const CONTROL = "0x000000000000000000000000000000000000dEaD";

const abi = [
  {
    type: "function",
    name: "isCollectionAllowed",
    stateMutability: "view",
    inputs: [{ name: "c", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "collectionAllowedAt",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const client = createPublicClient({ transport: http(RPC) });
const address = getAddress(HANDSHAKE);

async function read(addr) {
  const c = getAddress(addr);
  const [allowed, allowedAt] = await Promise.all([
    client.readContract({ address, abi, functionName: "isCollectionAllowed", args: [c] }),
    client.readContract({ address, abi, functionName: "collectionAllowedAt", args: [c] }),
  ]);
  return { allowed, allowedAt };
}

let failures = 0;
console.log(`Handshake: ${address}`);
console.log(`RPC:       ${RPC}\n`);
console.log(`${"collection".padEnd(14)}  ${"allowed".padEnd(7)}  ${"allowedAt".padEnd(12)}  verdict`);
console.log("-".repeat(70));

for (const [name, addr] of seeds) {
  try {
    const { allowed, allowedAt } = await read(addr);
    const ok = allowed === true && allowedAt > 0n;
    if (!ok) failures++;
    console.log(
      `${name.slice(0, 14).padEnd(14)}  ${String(allowed).padEnd(7)}  ${String(allowedAt).padEnd(12)}  ${ok ? "PASS" : "FAIL (expected allowed)"}`,
    );
  } catch (e) {
    failures++;
    console.log(`${name.slice(0, 14).padEnd(14)}  ERROR  ${addr}: ${e.shortMessage ?? e.message}`);
  }
}

// Control must read back as not allowed.
try {
  const { allowed } = await read(CONTROL);
  const ok = allowed === false;
  if (!ok) failures++;
  console.log(
    `${"(control)".padEnd(14)}  ${String(allowed).padEnd(7)}  ${"-".padEnd(12)}  ${ok ? "PASS" : "FAIL (should NOT be allowed)"}`,
  );
} catch (e) {
  failures++;
  console.log(`${"(control)".padEnd(14)}  ERROR  ${e.shortMessage ?? e.message}`);
}

console.log("-".repeat(70));
if (failures === 0) {
  console.log(`\n✅ All checks passed: ${seeds.length} seed(s) allowed, control rejected.`);
  process.exit(0);
}
console.log(`\n❌ ${failures} check(s) failed.`);
process.exit(1);
