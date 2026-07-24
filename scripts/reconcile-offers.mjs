#!/usr/bin/env node
/*
 * Offer status reconciler for the Handshake marketplace.
 *
 * Why this exists: an offer's status flips to completed/cancelled only when the
 * CLIENT posts the settlement receipt to /api/offers/[id]/complete|cancel. If
 * the client never calls back — the taker closes the tab, a third party fills a
 * public order, or the request just fails — the trade is settled ON-CHAIN while
 * Supabase still shows the offer "open". This worker closes that gap: it tails
 * the authoritative on-chain events and reconciles the DB to match the chain.
 *
 * It is the backstop, not the primary path. The API routes stay exactly as they
 * are (they give the acting user instant feedback); this only sweeps up offers
 * the client never confirmed. It is idempotent and safe to run alongside them:
 * every write is guarded by `status = 'open'`, so if the API already finalized a
 * row this worker updates zero rows and does nothing.
 *
 * It is read-only against the chain (no private key, no gas) and writes to
 * Supabase with the service-role key — same trust boundary as the API routes.
 *
 * Events consumed (from the deployed Handshake contract):
 *   TradeExecuted(bytes32 orderHash, address maker, address taker, ...)
 *     -> the open offer with that order_hash becomes `completed`, taker recorded.
 *   TradeCancelled(address maker, uint256 nonce)
 *     -> the open offer for that (maker, nonce) becomes `cancelled`.
 *
 * When (and only when) this worker performs the transition, it mirrors the API
 * side effects: it inserts a trade_events row and bumps wallet reputation, so a
 * reconciled trade is indistinguishable from a client-confirmed one.
 *
 * Modes:
 *   default        continuous tail (polls new blocks every POLL_INTERVAL_MS)
 *   --once         single catch-up scan to chain head, then exit (for cron)
 *   --dry-run      log what WOULD change; write nothing (chain or DB)
 *
 * Resumable: the last scanned block is persisted to STATE_FILE so cron runs are
 * incremental and never miss (or re-process) a settlement.
 *
 * Usage:
 *   export ETH_MAINNET_RPC_URL=https://rpc.ethereum.xyz
 *   export HANDSHAKE_ADDRESS=
 *   export NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...            # service role (bypasses RLS)
 *   # optional:
 *   #   export CONFIRMATIONS=3                      # blocks of lag before acting
 *   #   export START_BLOCK=12345678                 # first run lower bound
 *   #   export LOOKBACK_BLOCKS=500000               # first-run default window
 *   #   export POLL_INTERVAL_MS=15000
 *   #   export STATE_FILE=scripts/.reconcile-offers-state.json
 *   node scripts/reconcile-offers.mjs            # continuous
 *   node scripts/reconcile-offers.mjs --once     # one-shot (cron)
 *   node scripts/reconcile-offers.mjs --once --dry-run
 *   # or: npm run reconcile:offers
 */

import { createPublicClient, http, getAddress, isAddress, parseAbiItem } from "viem";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

const RPC = process.env.ETH_MAINNET_RPC_URL ?? "https://rpc.ethereum.xyz";
const HANDSHAKE =
  process.env.HANDSHAKE_ADDRESS ?? process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const LOOKBACK_BLOCKS = BigInt(process.env.LOOKBACK_BLOCKS ?? 500_000);
// A state-mutating worker should trail the head so a reorg can't strand the DB
// on a rolled-back settlement. The read-only alerter can act on head; we lag.
const CONFIRMATIONS = BigInt(process.env.CONFIRMATIONS ?? 3);
const MAX_RANGE = 5_000n; // chunk size for getLogs to stay within RPC limits
const STATE_FILE = process.env.STATE_FILE ?? "scripts/.reconcile-offers-state.json";
const ONCE = process.argv.includes("--once");
const DRY_RUN = process.argv.includes("--dry-run");

if (!HANDSHAKE || !isAddress(HANDSHAKE)) {
  console.error(
    "Set HANDSHAKE_ADDRESS (or NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS) to the deployed Handshake address."
  );
  process.exit(2);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role) to reach the offers DB."
  );
  process.exit(2);
}
const address = getAddress(HANDSHAKE);

const client = createPublicClient({ transport: http(RPC) });
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Event ABIs kept local so the script has no build-time dependency on the app.
const executedEvent = parseAbiItem(
  "event TradeExecuted(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerEthAmount, uint256 takerEthAmount, uint256 protocolFee)"
);
const cancelledEvent = parseAbiItem(
  "event TradeCancelled(address indexed maker, uint256 indexed nonce)"
);

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
  if (DRY_RUN) return; // never advance the cursor on a dry run
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ lastBlock: lastBlock.toString(), address }, null, 2)
    );
  } catch (e) {
    console.error(`WARN: could not persist state to ${STATE_FILE}: ${e.message}`);
  }
}

// --------------------------------------------------------------------------
// DB side effects (mirror the API routes, only when WE do the transition)
// --------------------------------------------------------------------------

/** Insert a trade_events row. Best-effort: a failure here never blocks the sweep. */
async function recordEvent(tradeOfferId, eventType, walletAddress, txHash) {
  const { error } = await db.from("trade_events").insert({
    trade_offer_id: tradeOfferId,
    event_type: eventType,
    wallet_address: walletAddress ? walletAddress.toLowerCase() : null,
    tx_hash: txHash,
    data: { source: "reconciler" },
  });
  if (error) console.error(`WARN: recordEvent(${eventType}) failed: ${error.message}`);
}

/** Bump reputation via the same RPC the API uses. Best-effort. */
async function bumpReputation(walletAddress, field) {
  const { error } = await db.rpc("bump_wallet_reputation", {
    p_wallet: walletAddress.toLowerCase(),
    p_field: field,
  });
  if (error) console.error(`WARN: bumpReputation(${field}) failed: ${error.message}`);
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------

async function handleExecuted(log) {
  const orderHash = log.args.orderHash.toLowerCase();
  const taker = getAddress(log.args.taker).toLowerCase();
  const txHash = log.transactionHash;

  if (DRY_RUN) {
    const { data } = await db
      .from("trade_offers")
      .select("id, maker_address")
      .eq("order_hash", orderHash)
      .eq("status", "open");
    for (const row of data ?? []) {
      console.log(
        `[dry-run] would COMPLETE offer ${row.id} (order ${orderHash}) taker=${taker} tx=${txHash}`
      );
    }
    return;
  }

  // Guarded transition: open -> completed. If the API (or a prior run) already
  // finalized this offer, zero rows match and we skip all side effects.
  const { data: updated, error } = await db
    .from("trade_offers")
    .update({ status: "completed", taker_address: taker, completed_tx_hash: txHash })
    .eq("order_hash", orderHash)
    .eq("status", "open")
    .select("id, maker_address");
  if (error) {
    console.error(`ERROR: complete update failed for order ${orderHash}: ${error.message}`);
    return;
  }

  for (const row of updated ?? []) {
    console.log(`✅ reconciled COMPLETE offer ${row.id} (order ${orderHash}) tx=${txHash}`);
    await recordEvent(row.id, "completed", taker, txHash);
    await bumpReputation(row.maker_address, "completed_trades_count");
    await bumpReputation(taker, "completed_trades_count");
  }
}

async function handleCancelled(log) {
  const maker = getAddress(log.args.maker).toLowerCase();
  const nonce = log.args.nonce.toString();
  const txHash = log.transactionHash;

  if (DRY_RUN) {
    const { data } = await db
      .from("trade_offers")
      .select("id")
      .eq("maker_address", maker)
      .eq("nonce", nonce)
      .eq("status", "open");
    for (const row of data ?? []) {
      console.log(
        `[dry-run] would CANCEL offer ${row.id} (maker=${maker} nonce=${nonce}) tx=${txHash}`
      );
    }
    return;
  }

  const { data: updated, error } = await db
    .from("trade_offers")
    .update({ status: "cancelled", cancelled_tx_hash: txHash })
    .eq("maker_address", maker)
    .eq("nonce", nonce)
    .eq("status", "open")
    .select("id");
  if (error) {
    console.error(
      `ERROR: cancel update failed for maker=${maker} nonce=${nonce}: ${error.message}`
    );
    return;
  }

  for (const row of updated ?? []) {
    console.log(`🚫 reconciled CANCEL offer ${row.id} (maker=${maker} nonce=${nonce}) tx=${txHash}`);
    await recordEvent(row.id, "cancelled", maker, txHash);
    await bumpReputation(maker, "cancelled_trades_count");
  }
}

// --------------------------------------------------------------------------
// Scanning
// --------------------------------------------------------------------------

async function scanRange(fromBlock, toBlock) {
  for (let start = fromBlock; start <= toBlock; start += MAX_RANGE) {
    const end = start + MAX_RANGE - 1n > toBlock ? toBlock : start + MAX_RANGE - 1n;
    const [executed, cancelled] = await Promise.all([
      client.getLogs({ address, event: executedEvent, fromBlock: start, toBlock: end }),
      client.getLogs({ address, event: cancelledEvent, fromBlock: start, toBlock: end }),
    ]);
    // Process in chain order so events read chronologically.
    const all = [...executed, ...cancelled].sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? Number(a.logIndex - b.logIndex)
        : Number(a.blockNumber - b.blockNumber)
    );
    for (const log of all) {
      if (log.eventName === "TradeExecuted") await handleExecuted(log);
      else await handleCancelled(log);
    }
  }
}

/** Head minus confirmation lag, floored at 0. */
async function safeHead() {
  const head = await client.getBlockNumber();
  return head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;
}

async function main() {
  const head = await safeHead();
  const state = loadState();

  let fromBlock;
  if (state?.lastBlock) {
    fromBlock = BigInt(state.lastBlock) + 1n;
  } else if (process.env.START_BLOCK) {
    fromBlock = BigInt(process.env.START_BLOCK);
  } else {
    fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  }

  console.log("Handshake offer status reconciler");
  console.log(`  contract : ${address}`);
  console.log(`  rpc      : ${RPC}`);
  console.log(`  supabase : ${SUPABASE_URL}`);
  console.log(`  confirms : ${CONFIRMATIONS} block(s) behind head`);
  console.log(`  from blk : ${fromBlock}  ->  head-${CONFIRMATIONS} ${head}`);
  console.log(`  mode     : ${ONCE ? "once (catch-up then exit)" : "continuous tail"}${DRY_RUN ? " + dry-run" : ""}`);

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
  console.log(`\nReconciling new settlements every ${POLL_INTERVAL_MS}ms … (Ctrl-C to stop)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const current = await safeHead();
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
