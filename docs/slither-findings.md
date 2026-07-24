# Slither — signal-only report (Handshake)

**Scope:** the deployable code only — `contracts/src/Handshake.sol` and
`contracts/script/Deploy.s.sol`. Dependencies (`contracts/lib/forge-std`,
`node_modules/@openzeppelin`) and the Foundry test suite are excluded from
reporting; detectors run at **full strength** against `src`/`script`.

**Config:** [`slither.config.json`](slither.config.json) —
`filter_paths = "contracts/lib/|node_modules/|contracts/test/"`,
`exclude_dependencies = true`.

**Tooling:** Slither 0.11.5, solc 0.8.28, optimizer on (1000 runs), evm cancun.
`forge` is not installable in this sandbox (the egress policy blocks
`foundry.paradigm.xyz` and GitHub release binaries), so Slither was pointed at
the source directly with the same remappings as `foundry.toml`:

```
slither contracts/src/Handshake.sol \
  --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/ forge-std/=contracts/lib/forge-std/src/" \
  --filter-paths "node_modules|forge-std|lib/" --exclude-dependencies
```

When `forge` is present, `slither . --config-file slither.config.json` produces
the identical scoped result set.

---

## Noise excluded vs. signal kept

The original whole-project Slither run was dominated by code that is never
deployed:

| Source | Finding-lines in raw report | In scope? |
|---|---:|---|
| `contracts/lib/forge-std` (test framework) | 1,734 | No — excluded |
| `node_modules/@openzeppelin` (audited dep) | 256 | No — excluded |
| `contracts/src/Handshake.sol` | 36 | **Yes** |
| `contracts/script/Deploy.s.sol` (self) | 0 | **Yes** (none) |

All three **High** findings in the raw report (`incorrect-exp`,
`incorrect-shift`, `shadowing-state`) live in forge-std / OpenZeppelin and were
**not** modified.

Scoped run: **9 in-scope findings**, all in `Handshake.sol`; `Deploy.s.sol`
itself is clean (its only raw-report findings were unused inherited forge-std
constants — dependency noise).

---

## Triage table (every in-scope finding)

| # | Detector | Severity | Location | Verdict | Justification |
|---|---|---|---|---|---|
| 0 | `reentrancy-no-eth` | Medium | `Handshake.sol:244` (`fulfillTrade`) | **False positive → suppressed** | `nonReentrant` + strict CEI; only post-call write is an additive `escrowBalance[to] += amount` credit that no callback can act on before the guard releases. See below. |
| 1 | `calls-loop` | Low | `Handshake.sol:488` (`_transferNFTs` `ownerOf`) | **Accepted by design** | Loop bounded by `MAX_ITEMS_PER_SIDE` (20); atomic settlement. |
| 2 | `calls-loop` | Low | `Handshake.sol:480` (`_transferNFTs` `safeTransferFrom`) | **Accepted by design** | Same bounded/atomic loop. |
| 3 | `calls-loop` | Low | `Handshake.sol:465` (`_verifyNFTs` `ownerOf`) | **Accepted by design** | Same bounded/atomic loop. |
| 4 | `calls-loop` | Low | `Handshake.sol:469` (`_verifyNFTs` approval) | **Accepted by design** | Same bounded/atomic loop. |
| 5 | `timestamp` | Low | `Handshake.sol:263` (`block.timestamp >= order.expiry`) | **Accepted by design** | Intentional settlement deadline; drift can't change trade economics. |
| 6 | `assembly` | Info | `Handshake.sol:507` (`_sendNative`) | **Accepted by design** | Intentional returndata-discard to stop return-bomb griefing. |
| 7 | `assembly` | Info | `Handshake.sol:529` (`_payout`) | **Accepted by design** | Bounded-gas returndata-discard send with escrow fallback. |
| 8 | `cyclomatic-complexity` | Info | `Handshake.sol:244` (`fulfillTrade`) | **Accepted by design** | Validation kept inline deliberately; splitting adds risk, no benefit. |

> Line numbers above are post-edit (the triage NatSpec shifted lines down by 35).
> The pre-edit signal set is preserved verbatim in the appendix.

**True positives found: 0.** No behavioral fix was required; nothing was
silenced that hides a real bug. Suppression comments are placed at the exact
lines via `// slither-disable-next-line <detector>` (and a
`slither-disable-start/end calls-loop` span over the two NFT-loop helpers), each
with an inline reason. Re-running Slither now reports **0 in-scope findings**;
`--show-ignored-findings` re-surfaces exactly these 9, confirming they are
triaged (ignored) rather than accidentally dropped.

---

## `reentrancy-no-eth` — why it is benign (detailed)

Slither flags that `escrowBalance` is written **after** the external NFT
transfers in `fulfillTrade`, and that `escrowBalance` also appears in
`deposit()` (cross-function). Walking the actual mechanism:

1. **The guard blocks re-entry.** `fulfillTrade`, `withdraw`, `withdrawTo`,
   `withdrawFees`, `withdrawFeesTo` are all `nonReentrant` and share one lock.
   A callback fired during `safeTransferFrom` (`onERC721Received`) cannot
   re-enter any of them — the nonce cannot be replayed, the maker escrow cannot
   be double-debited, no proceeds can be withdrawn mid-settlement.

2. **CEI ordering.** Every *consumable* state write is in the Effects block
   **before** any external call: `nonceUsed[maker][nonce] = true`,
   `escrowBalance[maker] -= makerCost`, `pendingFees[feeRecipient] += totalFee`.

3. **The only post-call write is a pure additive credit.**
   `escrowBalance[to] += amount` in `_payout` runs *after* the NFT transfers,
   and only on the payout-failure fallback path. It is not a read-modify-write
   of a value a callback observed stale — it is an unconditional increment of
   the recipient's *own* balance. Those funds cannot be withdrawn until the
   `nonReentrant` guard is released, by which point the credit is finalized.

4. **`deposit()` (the cross-function pair) is harmless.** It only adds the
   caller's `msg.value` to the caller's own `escrowBalance`. A reentrant
   `deposit()` during a callback credits real funds to the attacker's own
   balance — no invariant is violated.

The solvency invariant `contract balance == Σ escrowBalance + Σ pendingFees`
therefore holds across the whole settlement: taker `msg.value` covers the taker
leg + fees, the maker escrow is debited for the maker leg + fee in Effects, and
each proceeds leg either leaves the contract (direct send) or stays as an escrow
credit (fallback). No partial state is observable to a callback. Verdict:
**benign / false positive**, suppressed with the reasoning inline at the
function.

---

## Verification

- **Slither (scoped):** `0 result(s) found` in scope after triage;
  `--show-ignored-findings` shows the 9 as ignored.
- **Bytecode invariance:** the change is comment-only. Compiling
  `Handshake.sol` before vs. after with
  `solc --optimize --optimize-runs 1000 --evm-version cancun --metadata-hash none --bin-runtime`
  yields **byte-for-byte identical** runtime bytecode (22,449 bytes each). The
  only difference in the full artifact is the source-metadata hash, which does
  not affect execution. No storage layout, event signature, EIP-712
  domain/typehash, or order struct was touched.
- **Foundry tests:** the `contracts/test/` directory referenced in the task is
  not present in this branch's checkout, and `forge` is not installable here
  (egress policy). Because the executable bytecode is unchanged, any existing
  test outcome is unaffected by definition.

---

## Appendix — pre-edit signal set (raw Slither output, in scope only)

```
Summary
 - reentrancy-no-eth (1 results) (Medium)
 - calls-loop (4 results) (Low)
 - timestamp (1 results) (Low)
 - assembly (2 results) (Informational)
 - cyclomatic-complexity (1 results) (Informational)

## reentrancy-no-eth
Reentrancy in Handshake.fulfillTrade(TradeOrder,bytes) (src/Handshake.sol#L224-L305):
  External calls:
  - _transferNFTs(order.makerNFTs,order.maker,msg.sender) (src/Handshake.sol#L287)
    - nft.safeTransferFrom(from,to,items[i].tokenId) (src/Handshake.sol#L454)
  - _transferNFTs(order.takerNFTs,msg.sender,order.maker) (src/Handshake.sol#L288)
    - nft.safeTransferFrom(from,to,items[i].tokenId) (src/Handshake.sol#L454)
  State variables written after the call(s):
  - _payout(order.maker,order.takerEthAmount) (src/Handshake.sol#L294)
    - escrowBalance[to] += amount (src/Handshake.sol#L498)
  - _payout(msg.sender,order.makerEthAmount) (src/Handshake.sol#L295)
    - escrowBalance[to] += amount (src/Handshake.sol#L498)

## calls-loop
- _transferNFTs(...) external calls in loop: nft.ownerOf(...) (src/Handshake.sol#L462)
- _transferNFTs(...) external calls in loop: nft.safeTransferFrom(...) (src/Handshake.sol#L454)
- _verifyNFTs(...) external calls in loop: nft.ownerOf(...) (src/Handshake.sol#L439)
- _verifyNFTs(...) external calls in loop: nft.getApproved(...) && !isApprovedForAll(...) (src/Handshake.sol#L443-L444)

## timestamp
- Handshake.fulfillTrade uses timestamp: block.timestamp >= order.expiry (src/Handshake.sol#L243)

## assembly
- Handshake._sendNative uses assembly (src/Handshake.sol#L476-L478)
- Handshake._payout uses assembly (src/Handshake.sol#L494-L496)

## cyclomatic-complexity
- Handshake.fulfillTrade has a high cyclomatic complexity (16) (src/Handshake.sol#L224-L305)
```
