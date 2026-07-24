# Handshake Protocol — Production Security Audit

**Target:** Handshake — peer-to-peer NFT/ETH marketplace on Ethereum
**Settlement contract:** `Handshake.sol` (Solidity 0.8.28)
**Deployed address (claimed):** `` (Ethereum mainnet, chainId 1)
**Fee recipient (claimed):** `0x41678c150b0D11f18011fC3F275ee92652A89b5a`
**Audit date:** 2026-06-30
**Auditor role:** External production-readiness audit (adversarial)

> **Scope note / tooling caveat.** Foundry (`forge`/`cast`/`anvil`), Slither and
> Aderyn are not installed in this environment, and **outbound access to
> `rpc.ethereum.xyz` and the Ethereum explorer is blocked by the environment egress
> policy** (the proxy returns `403` on `CONNECT` to `rpc.ethereum.xyz:443`). As a
> result, **Phase 2 (deployed-bytecode / constructor-arg / owner verification)
> could not be executed on-chain from this session** and is listed as a
> mandatory pre-launch gate. Everything else (source review, ABI compatibility,
> EIP-712 equivalence, frontend integration, off-chain API/DB layer) was audited
> directly, and the EIP-712 digest equivalence between the frontend and the
> contract was **proven numerically** (see Phase 5). The TypeScript app
> typechecks cleanly and the 47-case JS test suite passes.

---

## Executive Summary

Handshake is a **non-custodial, atomic settlement** marketplace. Makers sign
EIP-712 orders off-chain (gasless listing); takers settle them on-chain. The
on-chain contract holds no inventory and the owner has **no power to move user
principal** — a genuinely strong, well-considered design.

The core settlement logic is **solid**. I found **no critical or high-severity
flaws in the contract's value-handling, replay protection, or signature
verification.** Checks-Effects-Interactions is respected, `ReentrancyGuard`
guards every value-moving entrypoint, fees use a pull-payment ledger so a hostile
fee recipient cannot brick trades, and the maker-agreed fee is bound into the
signed order so the owner cannot retroactively raise fees on a signed order.
EIP-712 hashing is byte-for-byte identical between the Solidity contract and the
viem frontend (independently reproduced).

The blockers to launch are **operational and centralization-related, not
algorithmic**:

1. **Deployed bytecode / owner / fee-recipient have not been verified on-chain**
   (could not be done here; must be done before launch).
2. **The owner is a single key** controlling `pause`, fee config and fee
   recipient — a single point of failure / availability risk.
3. **Production config gaps** — placeholder WalletConnect project id, and a
   block-explorer URL (`etherscan.io`) that does not match the project's stated
   explorer (`ethereumexplorer.com`), which will break every explorer link.
4. **Smart-contract / AA wallets cannot trade** — both the contract
   (`ECDSA.recover`) and the off-chain verifier require EOA signatures (no
   EIP-1271). This fails *closed* (no theft) but excludes a class of Ethereum users.

**Verdict: READY AFTER MINOR FIXES** — contingent on completing the on-chain
deployment-verification gate and the operational fixes below. No code change to
the settlement contract is *required* for safety; the recommended contract
changes are hardening/quality-of-life, not vulnerability fixes.

---

## Architecture

### System overview

```
Maker (browser)                         Taker (browser)
   │ build order (create/page.tsx)         │ open offer (offers/[id])
   │ read live feeBps/flatSwapFee on-chain │ approve taker NFTs (setApprovalForAll)
   │ setApprovalForAll on offered colls    │ runWrite → simulate → buffered gas
   │ signTypedData (EIP-712)               │ writeContract fulfillTrade{value}
   ▼                                       ▼
POST /api/offers ──► verify EIP-712 sig ──► Supabase (service-role only)
   (off-chain order book; gasless)            trade_offers / _nfts / _events
                                               │
Taker settles ─────────────────────────────►  Handshake.fulfillTrade
                                               │ verify sig, owner, approval, payment
                                               │ consume nonce, debit maker escrow
                                               │ accrue fee (pull), swap NFTs, move ETH
   POST /api/offers/[id]/complete ◄──────────  TradeExecuted(orderHash, …)
       └─ verifies receipt + event on-chain (authoritative), then marks DB completed
```

### Components reviewed

| Layer | Files |
| --- | --- |
| Contract | `contracts/src/Handshake.sol`, `script/Deploy.s.sol`, `foundry.toml`, full Foundry test suite |
| EIP-712 | `lib/orders/eip712.ts` (types, domain, hash, verify, nonce) |
| ABI / wrappers | `lib/contracts/settlement.ts` (`settlementAbi`, `erc721Abi`, error map) |
| Tx engine | `lib/chains/tx.ts` (`runWrite`), `gas.ts`, `tx-errors.ts`, `tx-log.ts` |
| Chain config | `lib/chains/ethereum.ts`, `lib/wagmi.ts`, `lib/chains/client.ts` |
| Fees | `lib/fees.ts`, `components/trade/fee-breakdown.tsx` |
| Flows | `app/create/page.tsx`, `app/offers/[id]/page.tsx`, `components/wallet/escrow-panel.tsx`, `network-guard.tsx` |
| API | `app/api/offers/route.ts`, `…/[id]/complete`, `…/[id]/cancel`, `app/api/wanted/*`, `config`, `health` |
| Data | `lib/db/offers.ts`, `lib/validation/offers.ts`, `lib/wanted/auth.ts`, `supabase/migrations/*` |

### Inheritance & dependencies

`Handshake is EIP712, ReentrancyGuard, Pausable, Ownable2Step`
(OpenZeppelin Contracts ^5.1.0), plus `ECDSA` and `IERC721`. `Ownable2Step` (not
plain `Ownable`) is correctly chosen so ownership transfer requires the new owner
to accept — preventing transfer to a wrong/dead address. No upgradeability, no
`delegatecall`, no `selfdestruct`, no `receive`/`fallback` (raw ETH sends revert
— good, prevents stuck dust). Solidity 0.8.28, optimizer on (1000 runs), EVM
`cancun`.

---

## Findings

### Severity legend
Critical (loss of funds, trivially exploitable) · High (loss of funds / severe,
conditional) · Medium (limited loss, griefing, centralization, or
correctness) · Low (minor) · Informational.

---

### C-/H- : None found in settlement value handling

No critical or high finding affects custody, replay, signature validation, fee
accounting, or atomicity. This is stated explicitly because it is the most
important result of the audit. Rationale is documented in Phases 3, 7 and 8.

---

### M-01 — Single-key owner is a centralization & availability single point of failure
**Severity:** Medium · **Type:** Centralization / availability
**Affected:** `Handshake` — `pause()`, `setFeeBps`, `setFeeRecipient`, `setFlatSwapFee`, `Ownable2Step`

**Description.** All admin power sits with one `owner` address. The owner can
`pause()` indefinitely (halting *all* new settlements) and can redirect *future*
protocol fees via `setFeeRecipient`. If that single key is lost or compromised,
an attacker can deny service to the whole marketplace (escrow withdrawal, fee
withdrawal and nonce cancellation remain available while paused — a deliberate
and good mitigation — so users can always *exit*, but no new trade can settle).

**What the owner explicitly *cannot* do (verified):** move or freeze user escrow
(`escrowBalance`), seize accrued `pendingFees` belonging to a previous recipient,
change the fee on an already-signed order (fee is bound into the signature), or
mint/drain principal. There is no upgrade path or `selfdestruct`. This bounds the
blast radius to *availability* + *future fee direction*, not principal theft.

**Exploit scenario.** Compromised owner key → `pause()` → trading frozen until a
new contract is deployed and the frontend re-pointed.

**Impact:** Medium (DoS, reputational). **Likelihood:** Low–Medium (depends on key
hygiene).

**Recommendation.** Before mainnet: set `owner` to a **multisig (e.g. 2-of-3 / 3-of-5
Safe)**, and ideally a **Timelock** in front of fee/recipient changes so users
get advance notice. Publish the owner address and its signer policy. Consider a
`maxPauseDuration` or a separate `pauser` role distinct from `owner` to reduce the
power of any single compromised key.

---

### M-02 — Deployed bytecode, owner and fee recipient are unverified (launch gate)
**Severity:** Medium (process) · **Type:** Deployment verification
**Affected:** Deployment at `0xA9E7…a277`

**Description.** Phase 2 could not be performed: this environment cannot reach
`rpc.ethereum.xyz` or the explorer (egress policy `403`). Therefore I cannot confirm
that the deployed contract's runtime bytecode matches this source compiled with
`solc 0.8.28`, optimizer `runs=1000`, EVM `cancun`; nor that the on-chain `owner`
and `feeRecipient` equal the intended addresses; nor that `feeBps`/`flatSwapFee`
hold expected values.

**Why it matters.** A frontend that points at a contract whose source you have
not verified is a trust hole regardless of how good the source is.

**Recommendation (must complete before launch).** From an environment with RPC:
```
cast code  --rpc-url https://rpc.ethereum.xyz
forge verify-bytecode 0xA9E7…a277 Handshake --rpc-url https://rpc.ethereum.xyz
cast call 0xA9E7…a277 "owner()(address)"        --rpc-url https://rpc.ethereum.xyz
cast call 0xA9E7…a277 "feeRecipient()(address)" --rpc-url https://rpc.ethereum.xyz
cast call 0xA9E7…a277 "feeBps()(uint256)"       --rpc-url https://rpc.ethereum.xyz
cast call 0xA9E7…a277 "DOMAIN_SEPARATOR via domainSeparator()(bytes32)" --rpc-url …
```
Confirm `owner` is the intended multisig (M-01), `feeRecipient ==
0x4167…9b5a`, and publish a verified source on the explorer. The `GET
/api/health` route already checks `settlementDeployed`/`chainMatches` at runtime —
wire it into uptime monitoring.

---

### M-03 — Smart-contract / Account-Abstraction wallets cannot create orders
**Severity:** Medium · **Type:** Compatibility (fails closed)
**Affected:** `fulfillTrade` (`ECDSA.recover`), `lib/orders/eip712.ts` (`verifyTypedData` without a client)

**Description.** Order authenticity is checked with raw ECDSA recovery on-chain
(`signer != order.maker → revert InvalidSignature`) and, off-chain, with viem
`verifyTypedData` **without a public client**, i.e. pure ECDSA — neither path
honours **EIP-1271** (`isValidSignature`). Safe multisigs, Argent, and other
smart-contract / AA wallets — increasingly common — produce contract signatures
that do not ECDSA-recover to the wallet address, so their orders are rejected
both at creation and at settlement.

**Impact.** No security loss (it fails closed — a forged signature still can't
settle), but a meaningful and silent **UX/market exclusion**: those users simply
cannot list.

**Recommendation.** If AA support is a goal, switch the contract from
`ECDSA.recover` to OpenZeppelin **`SignatureChecker.isValidSignatureNow`** (which
falls back to EIP-1271), and pass a `publicClient` to `verifyOrderSignature` so
the API does the same. Note this interacts with replay protection — keep the
`nonceUsed[maker][nonce]` consumption exactly as-is. If AA support is *not* a
goal for v1, document the EOA-only requirement prominently in the UI.

---

### M-04 — Off-chain order book accepts unfundable / unowned orders; UI can show stale "open" deals
**Severity:** Medium · **Type:** State desync / griefing (off-chain)
**Affected:** `app/api/offers/route.ts`, `lib/db/offers.ts`, `app/offers/[id]/page.tsx`

**Description.** `POST /api/offers` validates the EIP-712 signature but
deliberately does **not** check that the maker currently owns/has-approved the
offered NFTs, nor that escrow is funded. That is acceptable (settlement re-checks
everything atomically), but it means:

* A maker can publish many open orders all spending the **same** NFT (each has a
  fresh random nonce). Filling one makes the rest unfulfillable, but they remain
  `status='open'` in the DB until expiry. Takers see "open" deals that will
  revert.
* After an NFT is transferred out of a wallet, every resting order referencing it
  is stale-but-"open".

This is normal for an off-chain order book, and `runWrite` **simulates before
sending** (so a taker rarely pays gas for a doomed fill), but the feed can
mislead and be spammed (rate limited to 10/min/key).

**Impact:** Medium (UX confusion, wasted simulation, feed spam). **Likelihood:**
Medium.

**Recommendation.** Add a lightweight background "freshness" reconciler (or
on-read check) that flips orders to `expired`/`stale` when `ownerOf`/approval/
`nonceUsed` no longer hold, and surface a "may no longer be valid" badge.
Consider a per-maker cap on simultaneous open orders referencing the same token.

---

### M-05 — Block-explorer URL misconfiguration breaks all explorer links
**Severity:** Medium → Low (config) · **Type:** Production config
**Affected:** `lib/chains/ethereum.ts` (`ETH_MAINNET_EXPLORER_URL` default `https://etherscan.io`), `.env.example`

**Description.** The default explorer (and `.env.example`) point to
`etherscan.io`, while the project's stated explorer is `ethereumexplorer.com`.
Every `explorerTxUrl` / `explorerAddressUrl` / `explorerTokenUrl` link (settlement
tx, cancellation tx, NFT contract, address) will point at the wrong host and can
404 / mislead users verifying their own trades.

**Recommendation.** Set `NEXT_PUBLIC_ETH_MAINNET_EXPLORER_URL=https://ethereumexplorer.com`
in production and fix the default + `.env.example`. Verify the exact mainnet
explorer host and its `/tx`, `/address`, `/token` path scheme.

---

### M-06 — Placeholder WalletConnect project id in production config
**Severity:** Medium → Low · **Type:** Production config
**Affected:** `lib/wagmi.ts`

**Description.** `projectId` falls back to the literal `"handshake-dev"`. With an
invalid/placeholder WalletConnect Cloud id, WalletConnect-based mobile wallets can
fail to connect or be rate-limited, silently degrading the connect experience in
production.

**Recommendation.** Require a real `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` at build
time (fail the build if unset for production), and restrict its allowed origins in
WalletConnect Cloud.

---

### L-01 — Maker-as-contract that rejects ETH can grief takers (self-inflicted, simulated away)
**Severity:** Low · **Type:** Griefing / revert path
**Affected:** `fulfillTrade` → `_sendNative(order.maker, order.takerEthAmount)`

**Description.** If the maker is a contract that rejects native ETH and the order
has `takerEthAmount > 0`, the taker's fill reverts on the maker payout. This only
hurts the maker's own order and is caught by pre-send simulation, so a taker
almost never pays gas for it. No third-party harm, no fund loss.

**Recommendation.** None required. Optionally document; or route maker ETH payout
through the same pull-payment pattern as fees for uniformity (adds gas/complexity
— not recommended for v1).

---

### L-02 — Fee dust from integer rounding (by design)
**Severity:** Low / Informational · **Affected:** `fulfillTrade`, `quoteFees`, `lib/fees.ts`

`fee = amount * feeBps / 10_000` floors. For tiny ETH legs the protocol fee
rounds to 0. This is the standard, safe rounding direction (never over-charges,
never creates an accounting deficit) and the off-chain `quoteFees` mirrors it
exactly. No action needed.

---

### L-03 — `config` route reports a hard-coded `feeBps: 100`
**Severity:** Low / Informational · **Affected:** `app/api/config/route.ts`

The `/api/config` response hard-codes `feeBps: 100` rather than reading
`feeBps()` from chain. If the owner ever changes the storage fee, this endpoint is
stale. It is informational only (settlement uses the signed order's fee, and the
create flow reads the live value), but it can mislead integrators.

**Recommendation.** Read `feeBps()`/`flatSwapFee()` on chain (cached) or drop the
field.

---

### L-04 — Collection-wide "bid" sentinel token id is a signed, technically-fillable order
**Severity:** Low / Informational · **Affected:** `lib/collection-bids.ts`, `app/create/page.tsx`, `app/offers/[id]/page.tsx`

Collection-wide buy intents are encoded by signing an order whose `takerNFTs`
tokenId is the sentinel `2²⁵⁶−1` (`COLLECTION_BID_TOKEN_ID`). The UI refuses to
settle such orders directly (`!hasCollectionBid` gates the Accept button) and
routes counterparties to a fresh private deal — so in practice they never settle.
However the signed order is a *valid* order: anyone who actually held token
`2²⁵⁶−1` of that collection (and approved the contract) could call `fulfillTrade`
directly outside the UI. The maker only loses funds if their escrow is funded for
that order, which the UI never prompts for — so real-world risk is negligible, but
the design relies on the UI rather than the contract to enforce the "bid"
semantics.

**Recommendation.** Treat collection bids purely as off-chain "wanted" intents and
**do not have the maker sign a settlement order** for them (sign nothing, or a
clearly non-settleable structure), so there is no latent fillable order.

---

### Gas / quality (Informational)

* `cancelNonces` and the `_hashNFTItems` / `_verifyNFTs` / `_transferNFTs` loops
  use checked `i++` and re-read `array.length` each iteration. Caching `length`
  and `unchecked { ++i; }` saves a little gas per item (bounded by
  `MAX_ITEMS_PER_SIDE = 20`). Minor.
* `MAX_ITEMS_PER_SIDE = 20` per side bounds loop/gas DoS well. Good.
* Constants are `constant` (no SLOAD). Good.

---

## Positive Findings (strong design decisions)

1. **Non-custodial by construction.** The owner has **no function** to move user
   escrow or seize another recipient's accrued fees. No upgrade/`delegatecall`/
   `selfdestruct`. Funds at rest = Σ `escrowBalance` + Σ `pendingFees`, both
   user/recipient-owned. This is the single most important property and it holds.
2. **Strict Checks-Effects-Interactions + `nonReentrant`** on `fulfillTrade`,
   `withdraw`, `withdrawFees`. Nonce consumed and escrow debited *before* any NFT
   transfer or ETH send. Cross-function reentry into value paths is blocked.
3. **Atomic swap safety under hostile callbacks.** Even though `safeTransferFrom`
   invokes `onERC721Received`, a malicious taker/maker contract that mutates state
   mid-swap can only cause the *whole* transaction to revert (the second NFT batch
   or a payout fails), never a one-sided asset loss. Atomicity is preserved.
4. **Pull-payment fees.** A reverting/blacklisting fee recipient cannot brick
   trades — fees accrue to `pendingFees` and are claimed separately. Tested.
5. **Fee bound into the signed order.** `order.feeBps`/`order.flatFee` are signed
   and only bounded by hard caps (`MAX_FEE_BPS=500`, `MAX_FLAT_SWAP_FEE=1 ether`),
   so the owner **cannot** raise the fee on an already-signed order. Excellent.
6. **Replay & malleability defence.** `nonceUsed[maker][nonce]` consumed on fill
   *and* on cancel; OZ `ECDSA` rejects high-`s`/invalid-`v`; and even a malleable
   signature maps to the same `(maker, nonce)` and is blocked. Domain separator
   binds `chainId` + `verifyingContract` (recomputed across forks by OZ EIP712).
7. **`Ownable2Step`** prevents fatal ownership-transfer mistakes.
8. **Exact-payment enforcement.** `msg.value != takerEthAmount + takerLegFee +
   flatFee → revert` — no overpayment can be stranded; no `receive`/`fallback`
   means stray sends revert instead of getting stuck.
9. **Pause leaves exits open.** While paused, users can still `withdraw`,
   `withdrawFees`, and `cancelNonce` — they are never trapped.
10. **Trustless off-chain endpoints.** `complete` re-derives the taker from the
    on-chain `TradeExecuted` event and rejects mismatched client claims; `cancel`
    verifies `nonceUsed` on-chain before flipping DB state — neither can be abused
    to falsify or hide others' offers. Supabase is reached only via the
    service-role server layer with RLS enabled (deny-by-default).
11. **EIP-712 frontend/Solidity equivalence is exact** (proven below).

---

## Frontend Findings (integration)

| ID | Severity | Issue |
| --- | --- | --- |
| F-1 | Medium | M-03 — EOA-only signing; AA/Safe wallets silently excluded (frontend `verifyOrderSignature` has no client). |
| F-2 | Medium | M-05 — wrong explorer host breaks tx/address/token links. |
| F-3 | Medium | M-06 — placeholder WalletConnect project id. |
| F-4 | Low | M-04 — feed can display stale "open" deals; mitigated by pre-send `simulateContract`. |
| F-5 | Low | `FeeBreakdown` defaults `feeBps=100n`; the **create→review** screen renders it *without* passing the live `feeBps`, so if the owner ever raises the storage fee before signing, the *preview* shows 1% while the actually-signed (and escrow-required) fee is higher. The offers/[id] page passes `feeBps` correctly. Cosmetic mismatch only. |
| F-6 | Low | `bufferedGas` returns `undefined` on estimate failure and the write proceeds with wallet-default gas; on Ethereum this can re-introduce the "gas too low" path the buffer exists to avoid. Consider a sane floor instead of `undefined`. |

**Frontend strengths.** `runWrite` is a genuinely good shared write runner:
chain-id validated *before* any wallet prompt; `simulateContract` catches reverts
pre-gas; gas buffered 1.5×; receipt `status` checked; errors classified into
user-safe messages via a maintained selector→message map that matches the
contract's custom errors. Approval flow uses `isApprovedForAll` and only prompts
when needed. `refreshAfterTx` invalidates ownership/approval/escrow/feed queries
to fight stale state. Network guard + per-offer chain checks prevent
cross-chain settlement attempts.

---

## EIP-712 Review (Phase 5) — verified equivalent

* **Domain:** `name="EthereumMarket"`, `version="1"`, `chainId`, `verifyingContract`
  — identical in `EIP712("EthereumMarket","1")` and `getOrderDomain`.
* **Type strings:** `NFT_ITEM_TYPEHASH` and `TRADE_ORDER_TYPEHASH` (with the
  nested `NFTItem` appended, fields in declaration order) exactly match viem's
  encoding of `ORDER_TYPES`.
* **Array hashing:** contract uses `keccak256(abi.encodePacked(hashes[]))` over
  per-item struct hashes — this is precisely EIP-712 array encoding, which viem
  reproduces.
* **Numeric proof.** I reimplemented the contract's hashing by hand (typehashes,
  `_hashNFTItems`, struct hash, OZ domain separator, `0x1901‖domainSep‖structHash`)
  and compared to `viem.hashTypedData` for a representative multi-NFT/ETH order:

  ```
  TRADE_ORDER_TYPEHASH: 0xdd31ca13147626926d8a276ffca91f63bead3dae140516d9d7b84ab7b93fa94c
  manual digest:        0xcc98ef2339165e5db6ce2bbe9b0656cb9f4f6945990c871788db7517f0dda9f0
  viem   digest:        0xcc98ef2339165e5db6ce2bbe9b0656cb9f4f6945990c871788db7517f0dda9f0
  MATCH: true
  ```

  The maker's wallet signs the *same* digest the contract recovers against.
* **Replay/expiry/nonce/malleability:** covered (see Positive Findings 6).
* **Test gap (Informational):** `tests/eip712.test.ts` only checks viem
  self-consistency; it never cross-checks the Solidity `hashOrder`. Add a Foundry
  test (or a fixture comparison) asserting `settlement.hashOrder(order) ==`
  the viem digest for a shared vector, so future field/type edits can't drift the
  two implementations apart silently.

---

## Payment & NFT Security (Phases 6–7) — summary

* **ETH in:** exact `msg.value` check; maker side debited from isolated escrow
  with a sufficiency check; **no path lets the owner touch escrow**.
* **ETH out:** `.call` with full gas inside `nonReentrant`, balance zeroed before
  send (`withdraw`/`withdrawFees`), CEI respected; failed transfer reverts the
  whole settlement (fees use pull-payment to avoid bricking).
* **Overflow:** Solidity 0.8 checked math; fee sums bounded by ETH supply.
* **NFTs:** ownership + approval verified per item for both sides; `safeTransferFrom`
  used; duplicate token in one side → second transfer reverts (fails closed);
  ERC-1155 / non-ERC721 addresses revert on `ownerOf` (fails closed); malicious
  NFT only risks the two counterparties that opted into it, never protocol
  inventory (there is none).
* **Dust / stuck funds:** no `receive`/`fallback` ⇒ raw sends revert; exact
  payment ⇒ no stranded overpayment.

---

## Attack Simulation (Phase 8) — results

| Vector | Result |
| --- | --- |
| Replay (same order twice) | **Blocked** — `nonceUsed` consumed on fill; tested (`test_RevertReplayAttack`). |
| Signature reuse / malleability | **Blocked** — same `(maker,nonce)`; OZ ECDSA rejects high-s. |
| Nonce reuse / cancel-after-fill | **Blocked** — `NonceAlreadyUsed`. |
| Expired order | **Blocked** — `block.timestamp > expiry`. |
| Reentrancy (ERC721 callback, withdraw) | **Blocked** — `nonReentrant` + CEI. |
| Self-trade | **Blocked** — `SelfTrade`. |
| Wrong/unauthorized taker | **Blocked** — `NotAuthorizedTaker`. |
| Incorrect `msg.value` | **Blocked** — `IncorrectPayment`. |
| Fee manipulation by owner on signed order | **Blocked** — fee bound in signature. |
| Reverting fee recipient bricking trades | **Blocked** — pull payment; tested. |
| Front-running an open NFT→ETH sell | **Possible but benign** — losing taker reverts (`NonceAlreadyUsed`), no loss; pre-send simulation limits wasted gas. Standard orderbook MEV. |
| Owner draining principal | **Not possible** — no such function. |
| Stale frontend / RPC / indexer state | **Partially** — see M-04; simulation + query invalidation mitigate. |
| Wallet disconnect mid-flow | Handled — chain re-validated each write; classified errors. |

---

## Gas Optimization

* Cache `array.length` and use `unchecked { ++i; }` in `_hashNFTItems`,
  `_verifyNFTs`, `_transferNFTs`, `cancelNonces` (bounded by 20 items — small).
* Everything else is already tight (constants, no redundant SLOADs, pull-payment
  avoids push-loop gas). No material waste found.

---

## Production Checklist (launch blockers ☐ / done ☑)

**Must fix before mainnet (blockers):**
- ☐ Verify deployed runtime bytecode of `0xA9E7…a277` matches this source
  (`solc 0.8.28`, optimizer 1000, cancun) and **publish verified source** on the
  explorer. *(M-02 — could not be done in this environment.)*
- ☐ Confirm on-chain `owner` and migrate it to a **multisig (+ optional
  timelock)**; confirm `feeRecipient == 0x4167…9b5a`; confirm `feeBps`/
  `flatSwapFee`. *(M-01/M-02)*
- ☐ Set a real `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (fail build if missing). *(M-06)*
- ☐ Fix `NEXT_PUBLIC_ETH_MAINNET_EXPLORER_URL` to the real mainnet explorer and verify
  link paths. *(M-05)*
- ☐ Decide & document EOA-only vs add EIP-1271 (`SignatureChecker`) support. *(M-03)*

**Should fix / strongly recommended:**
- ☐ Add a Solidity↔frontend hash cross-check test (Phase 5 test gap).
- ☐ Stale-order reconciliation + "may be invalid" UI badge. *(M-04)*
- ☐ Wire `GET /api/health` into uptime/alerting; alarm on `settlementDeployed`/
  `chainMatches` false.
- ☐ Confirm distributed rate limiting (Upstash) is configured in prod (the
  in-process limiter does not hold across serverless instances).
- ☐ Document incident runbook: when/how to `pause`, and the multisig signing flow.

**Verified good (no action):**
- ☑ Non-custodial design; owner cannot move principal.
- ☑ Reentrancy, replay, malleability, expiry, self-trade, payment-exactness defences.
- ☑ EIP-712 frontend/Solidity digest equivalence (proven).
- ☑ Trustless complete/cancel endpoints; service-role-only DB with RLS.
- ☑ TypeScript typecheck clean; 47/47 JS tests pass; Foundry suite covers the
  critical paths.

---

## Final Verdict

# READY AFTER MINOR FIXES

**Reasoning.** The settlement contract is the part that secures real assets, and
it is **well-engineered**: non-custodial, atomic, reentrancy-safe, replay-proof,
with fees that cannot be retroactively changed and an owner that cannot touch
principal. I found **no critical or high-severity code vulnerability** in the
value paths, and the EIP-712 implementation is provably consistent between the
signer (frontend) and the verifier (contract). The Medium findings are
**centralization (single-key owner), one unavoidable verification gate
(deployed-bytecode confirmation), and production-config/compatibility items
(WalletConnect id, explorer URL, AA-wallet support)** — none of which require
changing the settlement algorithm, and all of which are closable quickly.

This is **not** "READY FOR MAINNET" today only because two true launch gates
remain open: (1) on-chain verification of the deployed bytecode/owner/fee
recipient — which **must** be completed from an RPC-capable environment (it could
not be done here), and (2) moving the owner to a multisig. Close the blocker
checklist above and Handshake is fit to secure real assets on Ethereum.

> **Re-audit recommendation.** Have the on-chain Phase 2 verification and the
> multisig migration confirmed by a second reviewer with live RPC access, and run
> `slither`/`aderyn` + the full `forge test` suite (unavailable in this
> environment) as a final gate.
