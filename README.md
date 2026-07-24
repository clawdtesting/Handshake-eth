# Handshake

[![contracts](https://github.com/0XNatasim/NFT/actions/workflows/contracts.yml/badge.svg)](https://github.com/0XNatasim/NFT/actions/workflows/contracts.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Solidity 0.8.28](https://img.shields.io/badge/Solidity-0.8.28-363636)

A peer-to-peer NFT trading marketplace for the Ethereum ecosystem — no bots, no snipers. Users negotiate and exchange NFTs directly wallet-to-wallet — NFT-for-NFT, NFT+ETH, ETH-for-NFT, private wallet-targeted offers — settled atomically by a non-custodial smart contract.

> The on-chain settlement contract keeps its original name (`Handshake`) and EIP-712 domain (`EthereumMarket`) — these are baked into the deployed bytecode and every signature, so they must not be renamed. "Handshake" is the product brand only.

It's a trading desk, not a sniping ground: off-chain signed orders (free to create), offer expirations, private offers, wallet reputation, and no instant floor-sniping mechanics.

## Deal Rooms — Live Haggle 🤝

Handshake's negotiation layer: a **private, real-time deal room** for any two wallets. Counter each other's terms freely — drafts are signature-less and can never move assets — watch the changes land live (presence + delta chips per round), and when you both agree, the maker signs **one** EIP-712 order that settles atomically in sub-second Ethereum finality. Bots can't outbid a deal they can't see.

- Enter from any offer (**Suggest changes**), the Wanted board (**Haggle live**), or `/rooms/new` with any wallet.
- One rule makes it safe: *only the final mutually-agreed revision is ever executable.* Replacing a live signed offer requires retiring its nonce on-chain first, so two versions of a deal can never coexist.
- No smart-contract changes — the deployed, verified settlement contract is reused as-is.

Full design & threat model: [`docs/deal-rooms.md`](docs/deal-rooms.md).

## Quick start (run it in 3 minutes)

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

Minimum `.env.local` to click around against the live mainnet deployment:

| Variable | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` | a free Supabase project — run the files in `supabase/migrations/` (in order) in its SQL editor |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | free at cloud.reown.com |
| `ALCHEMY_API_KEY` (or `OPENSEA_API_KEY` + `NFT_PROVIDER=opensea`) | free tier, powers NFT indexing |
| `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` | already set — the verified mainnet contract below |

Tests: `npm test` (app) · `npm run contracts:test` (Foundry). Typecheck: `npm run typecheck`.

## Architecture

```
┌─────────────┐   sign EIP-712 order    ┌──────────────────┐
│   Maker      │ ──────────────────────► │  Next.js API      │
│  (wallet)    │        (no gas)         │  + Supabase       │
└─────────────┘                          │  (signed orders,  │
                                         │   reputation,     │
┌─────────────┐   browse / accept       │   wanted board)   │
│   Taker      │ ◄────────────────────── └──────────────────┘
│  (wallet)    │
└──────┬──────┘
       │ fulfillTrade(order, signature) + msg.value
       ▼
┌──────────────────────────────┐
│ Handshake.sol     │  EIP-712 verify · nonce/replay ·
│ (Ethereum, non-custodial)        │  expiry · ownership · approvals ·
└──────────────────────────────┘  atomic NFT+ETH transfer · pausable
```

- **Orders are off-chain.** Makers sign EIP-712 `TradeOrder` structs; the signature and order live in Supabase. Creating/listing an offer costs zero gas.
- **Settlement is on-chain and atomic.** The taker calls `fulfillTrade`. The contract verifies the maker's signature, nonce, expiry, designated taker, NFT ownership, and approvals — then moves all NFTs and ETH in one transaction. Any failure reverts everything.
- **Maker-side ETH** comes from a self-managed escrow on the settlement contract (`deposit`/`withdraw`). The owner can never touch user balances. Taker-side ETH is `msg.value`.
- **Status updates are trustless.** The API only marks an offer completed after verifying the `TradeExecuted` event in the tx receipt, and only marks it cancelled after verifying the `TradeCancelled` event for that maker+nonce — so a fill can't be mislabeled as a cancellation.

### Fees

- The fee both parties agree to is **baked into the signed order** (`feeBps`, `flatFee`), so the owner can never change the fee on an already-signed order. Default `feeBps = 100` (1%) on **each ETH leg**, hard-capped at `MAX_FEE_BPS = 500` (5%).
- Pure NFT-for-NFT swaps pay **no percentage fee**; an optional `flatFee` (capped at `MAX_FLAT_SWAP_FEE = 1 ETH`) can apply so swap-heavy volume still generates revenue.
- Fees use **pull payments**: they accrue to `pendingFees[feeRecipient]` and are claimed via `withdrawFees()`, so a reverting fee recipient can never brick a trade.

## File tree

```
contracts/
  foundry.toml
  src/Handshake.sol                 # settlement contract
  test/                             # Foundry suite (unit + fuzz + invariant + fork)
    HandshakeAllowlist.t.sol        #   allowlist / timelock / lying-collection
    HandshakeSolvency.t.sol         #   fuzzed solvency invariant (EOA payouts)
    HandshakeFallbackSolvency.t.sol #   solvency when every payout hits the escrow fallback
    HandshakeAdversarial.t.sol      #   reentrancy at the NFT callback (both legs), payout griefing
    HandshakeFeeMath.t.sol          #   fuzzed fee accrual + solvency across all inputs
    HandshakeUpgradeableRisk.t.sol  #   upgradeable-collection allowlist theft demo
    HandshakeForkCollections.t.sol  #   fork check of the real seeded collections
    mocks/                          #   MockERC721, LyingERC721, ReentrantTaker/Maker,
                                    #   GasGriefingReceiver, ReturnBomber, RejectingReceiver,
                                    #   MaliciousProxy721
  script/Deploy.s.sol
  lib/forge-std/                    # vendored
app/
  page.tsx                          # homepage: hero, how-it-works, feed, stats
  create/page.tsx                   # trade builder + EIP-712 signing
  offers/[id]/page.tsx              # offer detail, accept / cancel flows
  account/page.tsx                  # my NFTs, offers, history, reputation
  wanted/page.tsx                   # wanted board
  api/
    config/  nfts/  stats/  reputation/  wanted/
    offers/  offers/[id]/  offers/[id]/cancel/  offers/[id]/complete/
components/
  layout/header.tsx  wallet/network-guard.tsx
  trade/{nft-card,offer-card,fee-breakdown}.tsx
  ui/{button,card,input,badge,skeleton}.tsx
lib/
  chains/ethereum.ts                   # all Ethereum config (env-driven)
  chains/client.ts                  # server-side viem public client
  orders/eip712.ts                  # order types, hashing, EOA + EIP-1271 verification
  fees.ts                           # fee math (mirrors the contract)
  featured-collections.ts           # curated / seeded collection list
  contracts/settlement.ts           # ABI
  nft/{provider.ts,index.ts,pricing.ts,providers/{alchemy,opensea}.ts}
  supabase/server.ts  db/offers.ts  validation/offers.ts  rate-limit.ts
scripts/
  verify-allowlist.mjs              # post-deploy allowlist verification (read-only)
  verify-contract.mjs               # source verification wrapper
  watch-collections.mjs             # CollectionProposed watcher / alerter (read-only)
  reconcile-offers.mjs              # tails TradeExecuted/TradeCancelled -> offer status (backstop)
supabase/migrations/                # init + order-fee-fields + nft-rarity
tests/                              # vitest: fee math, validation, EIP-712, wanted-auth
docs/
  SECURITY_AUDIT.md                 # adversarial production-readiness audit
  slither-findings.md               # static-analysis triage (signal vs noise)
SECURITY.md                         # disclosure policy + scope
.github/workflows/
  contracts.yml                     # forge build & test (+ nightly seeded-collection fork job)
  collection-watch.yml              # hourly CollectionProposed watcher (opt-in)
```

## Deployed contracts

| Network | Handshake | Status |
| --- | --- | --- |
| Ethereum Mainnet (chain 1) | not yet deployed — TBD |

No Ethereum deployment exists yet; deployment and verification remain pending.

After deployment, publish and verify the Solidity `0.8.28` / optimizer 1000 / EVM `cancun` build on Etherscan. This is the
build with order-bound fees, the flat-fee cap, pull-payment fees, and the
`Pausable` emergency stop.

## Vercel deployment

Before promoting a Vercel deployment to production:

1. Apply every migration in `supabase/migrations/` to production Supabase and
   configure its allowed site and redirect URLs for the production domain.
2. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`,
   `NEXT_PUBLIC_ETH_MAINNET_RPC_URL`, `ETH_MAINNET_RPC_URL`, and `CRON_SECRET`
   in Vercel. Public variables are embedded in browser bundles; use a
   domain-restricted public RPC key that does not share server credentials.
3. Set `NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS` and `HANDSHAKE_ADDRESS` only
   after the audited Ethereum deployment exists. Until then, treat the site as
   a preview and do not present settlement as live.
4. Do **not** add `PRIVATE_KEY_DEPLOYER` to Vercel. Deployment keys belong in a
   dedicated deployment environment, not the web application runtime.
5. Allow the production domain and intentional preview domains in WalletConnect
   and NFT-provider dashboards. Avoid wildcard preview origins for production
   API credentials wherever the provider supports an origin allowlist.

`vercel.json` schedules protected deal-room reconciliation daily as a baseline
for low-frequency hosting plans. Prompt expiry reconciliation needs a plan that
supports an hourly schedule; change the cron only after confirming plan limits.

## Testing

Contracts run on Foundry (compiled with the exact deployed toolchain, solc
`0.8.28`); the app runs on Vitest. Both run in CI on every push
(`.github/workflows/contracts.yml`).

**Contract suite** (`contracts/test/`)

| Suite | What it proves |
| --- | --- |
| `HandshakeAllowlist` | Allowlist gating, the 48h/instant timelock asymmetry, and that a lying-`ownerOf` collection is excluded before it is ever called. |
| `HandshakeSolvency` (invariant) | `balance == Σescrow + ΣpendingFees` holds across arbitrary deposit / settle / propose / remove / warp sequences. |
| `HandshakeFallbackSolvency` (invariant) | Same solvency invariant when **every** payout is forced through the post-interaction escrow-credit fallback. |
| `HandshakeAdversarial` | Reentrancy at the mid-settlement NFT callback on **both** legs (contract taker and EIP-1271 contract maker re-entering `withdraw`/`withdrawFees`) unwinds the trade; gas-griefing and return-bomb payout recipients fall back to a recoverable escrow credit; dual-ETH-leg fees exact with off-by-one payments rejected. |
| `HandshakeFeeMath` (fuzz) | Fee accrual is exact and solvency holds for all `makerEth`/`takerEth`/`feeBps` and the flat-fee branch, including the fee caps and the integer-division rounding boundary. |
| `HandshakeUpgradeableRisk` | Executable demo of the one residual risk: an allowlisted **upgradeable** collection can swap in a lying `ownerOf` and enable theft — and that instant `removeCollection` stops it. |
| `HandshakeForkCollections` (fork) | The real seeded Ethereum collections are non-upgradeable, ERC-721, and transferable. Self-skips without `ETH_MAINNET_RPC_URL`; runs nightly / on demand. |

Static analysis (Slither) triage is in [`docs/slither-findings.md`](docs/slither-findings.md);
the full adversarial writeup is in [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md).

**App suite** (`tests/`) — Vitest covers fee math, Zod input validation, EIP-712
order hashing/verification, and wanted-board signature auth.

## Security review

Vulnerability disclosure policy: [`SECURITY.md`](SECURITY.md). Detailed writeups:
[`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) (adversarial audit) and
[`docs/slither-findings.md`](docs/slither-findings.md) (static analysis). No
independent external audit has been performed yet.

**Contract.** EIP-712 signatures (EOA + EIP-1271 smart wallets) bound to chain id + verifying contract; **fees (bps + flat) are baked into the signed order** so they can't change after signing, capped by `MAX_FEE_BPS`/`MAX_FLAT_SWAP_FEE`; per-maker nonce map prevents replay and powers on-chain cancellation; expiry enforced; designated-taker enforcement; ownership *and* approval verified before any transfer, plus a **post-transfer effectiveness check**; **collection allowlist** with an asymmetric timelock (48h add, instant remove) that excludes a lying `ownerOf` collection before it is ever called; checks-effects-interactions with `nonReentrant`; ETH proceeds auto-withdrawn with a bounded gas stipend that **falls back to a pull-payment escrow credit** so a hostile recipient can't grief/OOG settlement; **protocol fees use pull payments** (`withdrawFees`); **`Pausable`** emergency stop on settlement (escrow/fee withdrawal and cancellation stay open); custom errors throughout; `Ownable2Step` admin limited to fee config + allowlist — **no admin path can move user NFTs or escrow.**

**Test coverage.** The Foundry suite exercises the happy path, replay, fees, pause and the allowlist timelock, plus: reentrancy at the mid-settlement NFT callback on **both** legs (contract taker and EIP-1271 contract maker re-entering `withdraw`/`withdrawFees`), the `_payout` escrow-credit fallback under gas-griefing and return-bomb recipients, fuzzed **solvency** and **fee-math** invariants (incl. the fee caps and rounding boundary), an executable **upgradeable-collection** theft demo, and a **fork test** asserting the real seeded collections are non-upgradeable and transferable.

**Backend.** No private keys, no backend signing, no custody. All inputs validated with Zod. Maker signatures re-verified server-side before storing orders — **on-chain `verifyTypedData` so both EOA (ECDSA) and EIP-1271 (Safe / smart-wallet) makers are accepted**, matching the contract. The complete and cancel endpoints each verify the specific on-chain event in the submitted receipt (`TradeExecuted` / `TradeCancelled` for this maker+nonce) rather than trusting the client or a bare `nonceUsed` flag — so a fill can't be mislabeled as a cancellation. Per-IP rate limits on mutating routes (distributed via Upstash Redis when configured, in-memory otherwise). Wanted-board posts/deletes require an EIP-191 wallet signature so nobody can post or remove on another address's behalf. Supabase RLS is enabled on every table with no anon policies (service-role-only). Private offers excluded from public feeds.

**Known limitations.**
- ERC-721 only (no ERC-1155 yet); `quantity` column is forward-compatible.
- Maker-side ETH requires an escrow deposit (native tokens can't be pulled by signature). A WMON + permit path would remove this step.
- Rate limiter uses Upstash Redis when `UPSTASH_REDIS_REST_*` are set; otherwise falls back to a per-instance in-memory window (fine for single-instance/dev).
- Off-chain order book means a cancelled-in-DB-only offer would still be technically fillable — which is why cancellation is on-chain (`cancelNonce`) and the UI enforces it.
- The maker's NFT approvals must be in place before a taker accepts; the offer page surfaces approval failures from the contract but a pre-flight maker approval step in `/create` would be smoother UX.
- **Allowlist trust assumption.** The lying-`ownerOf` defense assumes every allowlisted collection is honest *and immutable*. An **upgradeable** (proxy) collection could swap in a malicious `ownerOf` after being allowlisted, reopening the theft vector — so only non-upgradeable, standard ERC-721s should be allowlisted. The `HandshakeForkCollections` fork test and the `watch-collections` script exist to catch this; `removeCollection` is instant if one is found.
- The contract owner is currently a single EOA — move it to a multisig (`Ownable2Step`) before treating this as production-grade.

## Roadmap

- Collection-wide and trait-based offers (signed with merkle criteria)
- Counter-offers and negotiation threads
- ERC-1155 support
- WMON permit flow to remove maker escrow step
- SIWE authentication, Discord linking, reputation badges & leaderboard
- Indexer service consuming `TradeExecuted`/`TradeCancelled` events for fully event-driven status updates
- Trade history analytics and referral system

## ERC721-C support

ERC721-C uses the standard ERC-721 path, but creators must authorize the deployed Handshake operator in their transfer validator. Clients should simulate settlement before signing; an unauthorized operator reverts the entire atomic trade. The team must request authorization directly from each creator and must not bypass validators.

## Royalty policy — human review required

Royalties are seller-borne and deducted from ETH consideration. Each leg is divided by item count and remainder wei go to the earliest items. An ERC-1155 item counts once regardless of quantity. NFT-only swaps intentionally pay no royalty. These decisions require review before deployment. Large mixed orders are capped at 20 items per side, but ERC-721 and ERC-1155 gas costs must be benchmarked. A fresh independent audit is required before mainnet deployment.
