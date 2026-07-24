#!/usr/bin/env node
/*
 * CollectionProposed / CollectionRemoved watcher for the Handshake contract.
 *
 * Why this exists: adding a collection to the allowlist is timelocked by
 * ADD_DELAY (48h) precisely so a compromised owner key CANNOT whitelist a
 * malicious collection and drain in the same block — it sits publicly pending
 * for the whole window. That defense is only real if SOMEONE is watching the
 * CollectionProposed event during the window and can removeCollection (instant)
 * before it becomes tradable. This script is that watcher.
 *
 * It is read-only (no private key, no gas). For every CollectionProposed it:
 *   - flags whether the collection is an EXPECTED (known) one or a NEW/unknown
 *     one (unknown => loud alert),
 *   - prints how long until it becomes tradable (the window you have to react),
 *   - runs the same upgradeable-proxy check as the fork test (EIP-1967 / beacon
 *     / EIP-1822 slots) and warns if the proposed collection is a proxy — the
 *     exact residual risk the allowlist cannot otherwise cover,
 *   - optionally POSTs the alert to ALERT_WEBHOOK_URL (Slack/Discord-style
 *     { text } payload) so it can page a human.
 * CollectionRemoved events are logged as informational.
 *
 * Modes:
 *   default        continuous tail (polls new blocks every POLL_INTERVAL_MS)
 *   --once         single catch-up scan to chain head, then exit (for cron)
 *
 * Resumable: the last scanned block is persisted to STATE_FILE so cron runs are
 * incremental and never miss (or re-alert) a proposal.
 *
 * Usage:
 *   export ETH_MAINNET_RPC_URL=https://rpc.ethereum.xyz
 *   export HANDSHAKE_ADDRESS=
 *   # optional:
 *   #   export ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
 *   #   export KNOWN_COLLECTIONS=0xabc...,0xdef...   # expected set (defaults to seeds)
 *   #   export START_BLOCK=12345678                  # first run lower bound
 *   #   export LOOKBACK_BLOCKS=500000                # first-run default window
 *   #   export POLL_INTERVAL_MS=15000
 *   #   export STATE_FILE=scripts/.collections-watch-state.json
 *   node scripts/watch-collections.mjs            # continuous
 *   node scripts/watch-collections.mjs --once     # one-shot (cron)
 *   # or: npm run watch:collections
 */

import { createPublicClient, http, getAddress, isAddress, parseAbiItem } from "viem";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

const RPC = process.env.ETH_MAINNET_RPC_URL ?? "https://rpc.ethereum.xyz";
const HANDSHAKE = process.env.HANDSHAKE_ADDRESS;
const EXPLORER = process.env.NEXT_PUBLIC_ETH_MAINNET_EXPLORER_URL ?? "https://etherscan.io";
const WEBHOOK = process.env.ALERT_WEBHOOK_URL ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const LOOKBACK_BLOCKS = BigInt(process.env.LOOKBACK_BLOCKS ?? 500_000);
const MAX_RANGE = 5_000n; // chunk size for getLogs to stay within RPC limits
const STATE_FILE = process.env.STATE_FILE ?? "scripts/.collections-watch-state.json";
const ONCE = process.argv.includes("--once");

if (!HANDSHAKE || !isAddress(HANDSHAKE)) {
  console.error("Set HANDSHAKE_ADDRESS to the deployed Handshake contract address.");
  process.exit(2);
}
const address = getAddress(HANDSHAKE);

// Expected collections (defaults to the launch seed set). Anything proposed that
// is NOT in here is treated as unexpected and alerted loudly.
const DEFAULT_KNOWN = [
  "0x818030837E8350ba63E64d7dC01A547fA73c8279",
  "0x2a0001f3D4c98881376F8d36B3C61f163d84a095",
  "0x200723A706de0013316E5cd8EBa2b3f53DD90c29",
  "0x36982448e77658b8F58F4665696e3173D1e696C2",
  "0xcbdFaD1bfb6A4414DD4D84B7A6420dc43683deB0",
  "0xaEAA920165fD7ce58a0E0772Ffc97F06626572cD",
  "0x9F8514cEBee138b61806d4651f51d26C8098b463",
];
const known = new Set(
  (process.env.KNOWN_COLLECTIONS
    ? process.env.KNOWN_COLLECTIONS.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_KNOWN
  ).map((a) => getAddress(a).toLowerCase())
);

// EIP-1967 implementation & beacon slots, EIP-1822 (UUPS) proxiable slot.
const PROXY_SLOTS = [
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bec8",
];

const proposedEvent = parseAbiItem(
  "event CollectionProposed(address indexed collection, uint256 allowedAt)"
);
const removedEvent = parseAbiItem("event CollectionRemoved(address indexed collection)");

const client = createPublicClient({ transport: http(RPC) });

// --------------------------------------------------------------------------
// State (resumable last-scanned block)
// --------------------------------------------------------------------------

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveState(lastBlock) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ lastBlock: lastBlock.toString(), address }, null, 2));
  } catch (e) {
    console.error(`WARN: could not persist state to ${STATE_FILE}: ${e.message}`);
  }
}

// --------------------------------------------------------------------------
// Alerting
// --------------------------------------------------------------------------

function fmtDuration(seconds) {
  if (seconds <= 0) return "ELAPSED (already tradable)";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

async function isUpgradeableProxy(collection) {
  try {
    for (const slot of PROXY_SLOTS) {
      const v = await client.getStorageAt({ address: getAddress(collection), slot });
      if (v && BigInt(v) !== 0n) return true;
    }
  } catch {
    /* if we can't read, don't claim either way */
  }
  return false;
}

async function emit(level, lines) {
  const text = lines.join("\n");
  const prefix = level === "alert" ? "🚨🚨🚨" : level === "warn" ? "⚠️ " : "ℹ️ ";
  console.log(`\n${prefix} ${text}\n`);
  if (WEBHOOK) {
    try {
      await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${prefix} ${text}` }),
      });
    } catch (e) {
      console.error(`WARN: webhook POST failed: ${e.message}`);
    }
  }
}

async function handleProposed(log) {
  const collection = getAddress(log.args.collection);
  const allowedAt = Number(log.args.allowedAt);
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = allowedAt - nowSec;
  const isKnown = known.has(collection.toLowerCase());
  const proxy = await isUpgradeableProxy(collection);

  const lines = [
    `${isKnown ? "Expected" : "UNEXPECTED"} collection proposed to the Handshake allowlist`,
    `  collection : ${collection}${isKnown ? " (known/seed)" : " (NOT in the known set!)"}`,
    `  tradable at : ${new Date(allowedAt * 1000).toISOString()} (in ${fmtDuration(remaining)})`,
    `  tx          : ${EXPLORER}/tx/${log.transactionHash}`,
    `  collection  : ${EXPLORER}/address/${collection}`,
  ];
  if (proxy) {
    lines.push(
      "  ⚠️ UPGRADEABLE PROXY: implementation can change after listing — this is the",
      "     residual risk the allowlist cannot cover. Strongly consider removeCollection."
    );
  }
  if (!isKnown || proxy) {
    lines.push(
      `  ACTION: if unexpected, call removeCollection(${collection}) before it becomes tradable.`
    );
    await emit("alert", lines);
  } else {
    await emit("info", lines);
  }
}

async function handleRemoved(log) {
  const collection = getAddress(log.args.collection);
  await emit("info", [
    `Collection removed from the allowlist`,
    `  collection : ${collection}`,
    `  tx          : ${EXPLORER}/tx/${log.transactionHash}`,
  ]);
}

// --------------------------------------------------------------------------
// Scanning
// --------------------------------------------------------------------------

async function scanRange(fromBlock, toBlock) {
  for (let start = fromBlock; start <= toBlock; start += MAX_RANGE) {
    const end = start + MAX_RANGE - 1n > toBlock ? toBlock : start + MAX_RANGE - 1n;
    const [proposed, removed] = await Promise.all([
      client.getLogs({ address, event: proposedEvent, fromBlock: start, toBlock: end }),
      client.getLogs({ address, event: removedEvent, fromBlock: start, toBlock: end }),
    ]);
    // Order events by block so the log reads chronologically.
    const all = [...proposed, ...removed].sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? Number(a.logIndex - b.logIndex)
        : Number(a.blockNumber - b.blockNumber)
    );
    for (const log of all) {
      if (log.eventName === "CollectionProposed") await handleProposed(log);
      else await handleRemoved(log);
    }
  }
}

async function main() {
  const head = await client.getBlockNumber();
  const state = loadState();

  let fromBlock;
  if (state?.lastBlock) {
    fromBlock = BigInt(state.lastBlock) + 1n;
  } else if (process.env.START_BLOCK) {
    fromBlock = BigInt(process.env.START_BLOCK);
  } else {
    fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  }

  console.log("Handshake CollectionProposed watcher");
  console.log(`  contract : ${address}`);
  console.log(`  rpc      : ${RPC}`);
  console.log(`  known    : ${known.size} expected collection(s)`);
  console.log(`  webhook  : ${WEBHOOK ? "enabled" : "console only"}`);
  console.log(`  from blk : ${fromBlock}  ->  head ${head}`);
  console.log(`  mode     : ${ONCE ? "once (catch-up then exit)" : "continuous tail"}`);

  // Catch-up scan.
  if (fromBlock <= head) {
    await scanRange(fromBlock, head);
    saveState(head);
  }
  if (ONCE) {
    console.log("\nDone (--once).");
    return;
  }

  // Continuous tail.
  let last = head;
  console.log(`\nWatching for new events every ${POLL_INTERVAL_MS}ms … (Ctrl-C to stop)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const current = await client.getBlockNumber();
      if (current > last) {
        await scanRange(last + 1n, current);
        last = current;
        saveState(current);
      }
    } catch (e) {
      console.error(`WARN: poll failed (will retry): ${e.shortMessage ?? e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.shortMessage ?? e.message}`);
  process.exit(1);
});
