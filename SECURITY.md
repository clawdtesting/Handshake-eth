# Security Policy

Handshake is a non-custodial, peer-to-peer NFT/ETH settlement protocol on Ethereum.
Settlement is atomic and on-chain; the contract owner can never move user NFTs or
escrowed ETH.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do not open a public
issue for anything exploitable.

- Use GitHub's [private vulnerability reporting](https://github.com/0XNatasim/NFT/security/advisories/new)
  (Security → Report a vulnerability), or
- email the maintainer.

Include a description, affected component (contract / API / frontend), and a
proof-of-concept or reproduction steps where possible. We aim to acknowledge
reports promptly and will coordinate disclosure once a fix is deployed.

## Scope

| Component | Location |
| --- | --- |
| Settlement contract | `contracts/src/Handshake.sol` |
| Order signing / verification | `lib/orders/eip712.ts`, `app/api/offers/**` |
| Order storage | `supabase/migrations/**` (RLS, service-role only) |

## What has been done

- **Verified on-chain source** — `Handshake.sol` (Solidity `0.8.28`, optimizer
  1000 runs, EVM `cancun`) is verified on Etherscan, so anyone can read and
  reproduce the settlement logic.
- **Adversarial test suite** — reentrancy at the mid-settlement NFT callback on
  both legs, the payout escrow-credit fallback under hostile recipients, fuzzed
  solvency and fee-math invariants, an upgradeable-collection theft demo, and a
  fork check of the live seeded collections. See the README *Security review* and
  the detailed writeup in [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) and
  [`docs/slither-findings.md`](docs/slither-findings.md).
- **Operational hardening** — `Ownable2Step` ownership (move to a multisig), an
  asymmetrically-timelocked collection allowlist, and a `CollectionProposed`
  watcher (`scripts/watch-collections.mjs` / `collection-watch.yml`).

## Residual risk

The allowlist assumes every listed collection is honest **and immutable**. Only
non-upgradeable, standard ERC-721 collections should be allowlisted; an
upgradeable proxy could later swap in a malicious `ownerOf`. The
`HandshakeForkCollections` fork test and the watcher exist to detect this, and
`removeCollection` is instant.

> This project has not yet undergone an independent external smart-contract
> audit. Treat it accordingly until one is completed.


## Multi-standard settlement
Allowlisted ERC-721-family and ERC-1155 collections are supported. ERC721-C operators must be creator-authorized. EIP-2981 royalties use pull payments; NFT-only swaps accrue none. NFTs transfer directly user-to-user; Handshake never implements token-receiver custody hooks.
