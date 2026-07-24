# Deal Rooms — Live Haggle

Private, wallet-authenticated negotiation workspaces where two collectors
haggle over trade terms in real time and settle the final deal atomically
through the existing, verified `Handshake` settlement contract.

**No smart-contract changes.** The deployed contract, its EIP-712 domain, and
every security property it enforces are untouched.

## Why

Handshake's promise is human-to-human trading, but a signed offer used to be
take-it-or-leave-it: the counterparty could accept or walk away. Wanting
slightly different terms meant leaving for Discord DMs — losing the trade,
the trust, and the story. Deal Rooms close that loop: negotiation happens
in-product, every round is structured, and the finale is a sub-second atomic
settlement on Ethereum.

## Security model (the one rule)

> **Draft revisions are non-executable. Only the final, mutually-agreed
> revision becomes a signed EIP-712 `TradeOrder`.**

Consequences:

- Countering costs nothing and needs no wallet popup — a draft can never move
  assets, so there is nothing to protect it with.
- There is never more than one executable version of a negotiated deal. If a
  room replaces an existing signed offer, that offer's **nonce must be
  consumed on-chain** (cancelled or filled) before the replacement signature
  is accepted — enforced server-side in `finalize`, surfaced in the room's
  readiness panel, and one-click actionable by the maker.
- Acceptances are bound to a **canonical terms hash** (keccak256 over sorted,
  normalized terms). A new revision invalidates all acceptances; the final
  order is verified field-by-field against the agreed hash, so nobody can
  sign terms the other side didn't see.

## State machine

```
open ──(both accept current revision)──► agreed
agreed ──(new revision)──► open                (acceptances cleared)
agreed ──(maker signs final order)──► signed
signed ──(TradeExecuted verified)──► settled
signed ──(final offer cancelled/expired)──► agreed   (renegotiable)

terminal: settled · declined · cancelled · expired · superseded
```

Room status changes driven by chain facts (`settled`, `superseded`, reopening
a `signed` room) are only written after receipt/event verification — the same
discipline the offer complete/cancel routes already follow.

## Authority map

| State | Authority |
| --- | --- |
| Room membership, drafts, acceptances, decline | Database (service-role API only) |
| Final order authorization | Maker's EIP-712 wallet signature |
| Ownership, approvals, escrow, nonces, settlement | Blockchain |
| Readiness report, NFT metadata, notifications | Derived / cache |

## Authentication

One EIP-191 `personal_sign` per wallet per day mints a stateless HMAC bearer
token (`lib/deal-rooms/session.ts`). The signed message states explicitly
that it authorizes no asset movement. EOA and EIP-1271/6492 signers are both
accepted (viem `verifyMessage` against the RPC). Room reads and draft
mutations use the token; anything executable still requires its own wallet
ceremony (final EIP-712 signature, on-chain transactions).

Access control: every room endpoint scopes by participant; non-participants
receive a generic 404 — a room's existence is private. RLS is enabled on all
new tables with **no public policies**; the anon key cannot read anything.

## Live layer

Each room has an unguessable `realtime_token`, returned only to authenticated
participants. Clients join a Supabase **broadcast + presence** channel named
by it: mutations trigger a server-side broadcast ping (data never travels on
the channel — clients revalidate through the API), and presence powers the
"they're here" indicator. Polling stays on as fallback; realtime is never
load-bearing.

## Flow

1. **Enter** from an offer ("Suggest changes"), the wanted board ("Haggle
   live"), or `/rooms/new` with any wallet.
2. **Haggle**: counter with the composer (both wallets' live inventories,
   ETH amounts, expiry, 240-char note). Delta chips show exactly what each
   round changes. Identical re-proposals are rejected.
3. **Agree**: acceptance is per-revision; when both sides accept the same
   hash the room locks to `agreed`.
4. **Gate**: readiness checks run (ownership, approvals, escrow, allowlist,
   offer expiry, source-nonce retirement).
5. **Sign**: the draft's maker signs one `TradeOrder`; the server verifies
   signature + exact-terms match and creates a **private, targeted** offer.
6. **Settle**: the taker settles through the existing offer flow — one atomic
   transaction. The room flips to `settled` off the verified `TradeExecuted`
   receipt and shows the signed→settled stopwatch.

## Concurrency

`deal_rooms.version` is an optimistic lock: every mutation carries
`expectedVersion` and the update is a compare-and-swap; losers get 409 and
refresh. Revisions are append-only with unique `(room_id, revision_number)`
and `(room_id, terms_hash)`. Finalize is idempotent (a second call returns
the existing offer) and double-protected by the offers table's unique nonce /
order-hash constraints.

## Files

- Migration: `supabase/migrations/20260715000000_deal_rooms.sql`
- Core: `lib/deal-rooms/` (canonicalize, state-machine, diff, session,
  readiness, broadcast, sync, api helpers) + `lib/db/deal-rooms.ts`
- API: `app/api/deal-rooms/**`, `app/api/notifications`,
  `app/api/cron/deal-rooms`
- UI: `app/rooms/[id]`, `app/rooms/new`, `components/deal-room/*`,
  `hooks/use-deal-rooms.ts`
- Tests: `tests/deal-room-*.test.ts`

## Ops

- Apply the migration via the Supabase SQL editor (additive only).
- Optional env: `ROOM_SESSION_SECRET` (falls back to a key derived from
  `SUPABASE_SERVICE_ROLE_KEY`), `CRON_SECRET` for the reconcile route.
- Vercel Cron (suggested hourly): `GET /api/cron/deal-rooms` — expires
  overdue rooms and reopens `signed` rooms whose final offer expired
  unfilled.
- Realtime requires `NEXT_PUBLIC_SUPABASE_ANON_KEY`; without it rooms still
  work via polling.
