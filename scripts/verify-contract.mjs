#!/usr/bin/env node
/*
 * Verify the deployed Handshake contract on Ethereum explorers.
 *
 * This wrapper avoids fragile multi-line shell pastes: it preflights that code
 * exists at the target address, ABI-encodes the three-argument constructor, and
 * then invokes forge verify-contract with one argument vector.
 */

import { spawnSync } from "node:child_process";
import { createPublicClient, http, isAddress, getAddress } from "viem";

const env = process.env;
const RPC = env.ETH_MAINNET_RPC_URL ?? env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL ?? "https://rpc.ethereum.xyz";
const CHAIN_ID = env.CHAIN_ID ?? env.NEXT_PUBLIC_CHAIN_ID ?? "1";
const CONTRACT = env.HANDSHAKE_ADDRESS ?? env.NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS;
const OWNER = env.CONTRACT_OWNER;
const FEE_RECIPIENT = env.FEE_RECIPIENT_ADDRESS;
const INITIAL_COLLECTIONS = parseAddressList(env.INITIAL_COLLECTIONS ?? "");
const VERIFIER = env.VERIFIER ?? "sourcify";
const SOURCIFY_URL = env.SOURCIFY_VERIFIER_URL ?? "https://sourcify-api-ethereum.blockvision.org/";
const ETHERSCAN_URL = env.ETHERSCAN_VERIFIER_URL ?? `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`;

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(2);
}

function parseAddressList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (!isAddress(item)) fail(`Invalid address in INITIAL_COLLECTIONS: ${item}`);
      return getAddress(item);
    });
}

function requireAddress(name, value) {
  if (!value || !isAddress(value)) fail(`Set ${name} to a valid address.`);
  return getAddress(value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: options.stdio ?? "pipe", encoding: "utf8" });
  if (result.error?.code === "ENOENT") fail(`${command} is not installed or not on PATH.`);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`${command} ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

const contract = requireAddress("HANDSHAKE_ADDRESS or NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS", CONTRACT);
const owner = requireAddress("CONTRACT_OWNER", OWNER);
const feeRecipient = requireAddress("FEE_RECIPIENT_ADDRESS", FEE_RECIPIENT);

console.log(`Handshake: ${contract}`);
console.log(`RPC:       ${RPC}`);
console.log(`Chain:     ${CHAIN_ID}`);
console.log(`Verifier:  ${VERIFIER}`);

const client = createPublicClient({ transport: http(RPC) });
const code = await client.getBytecode({ address: contract }).catch((error) => {
  fail(`Could not read contract code from ${RPC}: ${error.shortMessage ?? error.message}`);
});
if (!code || code === "0x") {
  fail(`No contract code found at ${contract} on chain ${CHAIN_ID}. Check the address, RPC, and mainnet chain id.`);
}
console.log(`Code:      found (${(code.length - 2) / 2} bytes)`);

const constructorArgs = run("cast", [
  "abi-encode",
  "constructor(address,address,address[])",
  owner,
  feeRecipient,
  `[${INITIAL_COLLECTIONS.join(",")}]`,
]);
console.log(`Ctor args: ${constructorArgs}`);

const forgeArgs = [
  "verify-contract",
  "--root",
  "contracts",
  contract,
  "src/Handshake.sol:Handshake",
  "--chain",
  CHAIN_ID,
  "--compiler-version",
  "0.8.28",
  "--num-of-optimizations",
  "1000",
  "--evm-version",
  "cancun",
  "--constructor-args",
  constructorArgs,
  "--verifier",
  VERIFIER,
];

if (VERIFIER === "sourcify") {
  forgeArgs.push("--verifier-url", SOURCIFY_URL);
} else if (VERIFIER === "etherscan") {
  forgeArgs.push("--verifier-url", ETHERSCAN_URL);
  if (!env.ETHERSCAN_API_KEY) fail("Set ETHERSCAN_API_KEY when VERIFIER=etherscan.");
  forgeArgs.push("--etherscan-api-key", env.ETHERSCAN_API_KEY);
} else if (env.VERIFIER_URL) {
  forgeArgs.push("--verifier-url", env.VERIFIER_URL);
}

if (env.WATCH !== "false") forgeArgs.push("--watch");

console.log(`\nRunning: forge ${forgeArgs.join(" ")}\n`);
run("forge", forgeArgs, { stdio: "inherit" });
