"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import {
  creatorTokenAbi,
  erc721Abi,
  settlementAbi,
  transferValidatorAbi,
} from "@/lib/contracts/settlement";
import { ETH_MAINNET_CHAIN_ID, SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import { quoteFees } from "@/lib/fees";
import { isCollectionBid } from "@/lib/collection-bids";
import { formatEth, prettyCollectionName, shortAddress } from "@/lib/utils";
import type { TradeOffer } from "@/lib/types";

/**
 * Pre-flight "deal health" check for the taker.
 *
 * The settlement contract reverts with a precise reason (CollectionNotAllowed,
 * NotTokenOwner, MissingApproval, NonceAlreadyUsed, InsufficientEscrow), but
 * Ethereum's RPC frequently returns a revert without the decodable reason bytes,
 * so `simulateContract` collapses to a generic "would revert" message. Instead
 * of decoding the revert, we read the exact preconditions straight from chain
 * and report which one fails — so the UI can say *why* a deal can't be filled.
 *
 * Only surfaces blockers the taker cannot resolve at accept time. The taker's
 * own NFT approval is intentionally omitted: the accept flow requests it.
 */

export type DealBlockerCode =
  | "settlement-paused"
  | "collection-not-allowed"
  | "transfer-restricted"
  | "maker-not-owner"
  | "taker-not-owner"
  | "maker-not-approved"
  | "nonce-used"
  | "maker-escrow"
  | "taker-insufficient-eth";

export interface DealBlocker {
  code: DealBlockerCode;
  message: string;
}

export interface DealHealth {
  ok: boolean;
  blockers: DealBlocker[];
}

// Most fundamental first — the order shown to the user.
const PRIORITY: DealBlockerCode[] = [
  "settlement-paused",
  "collection-not-allowed",
  "transfer-restricted",
  "nonce-used",
  "maker-not-owner",
  "taker-not-owner",
  "maker-not-approved",
  "maker-escrow",
  "taker-insufficient-eth",
];

export function useDealHealth(
  offer: TradeOffer | undefined,
  connectedTaker: string | undefined,
) {
  // Pin reads to Ethereum so a wallet on the wrong network can't skew the check.
  const publicClient = usePublicClient({ chainId: ETH_MAINNET_CHAIN_ID });

  return useQuery<DealHealth>({
    queryKey: ["deal-health", offer?.id, offer?.status, connectedTaker],
    enabled: !!offer && !!publicClient && offer.status === "open",
    staleTime: 15_000,
    refetchInterval: 20_000,
    queryFn: async () => {
      const client = publicClient!;
      const o = offer!;
      const maker = o.makerAddress.toLowerCase() as Address;
      const takerOwner = (connectedTaker ?? o.takerAddress ?? "").toLowerCase();
      const settlement = SETTLEMENT_CONTRACT_ADDRESS;

      const labelFor = (contract: string) => {
        const match = o.nfts.find(
          (n) => n.contractAddress.toLowerCase() === contract.toLowerCase(),
        );
        return (
          prettyCollectionName(match?.collectionName) ?? shortAddress(contract)
        );
      };

      // Concrete NFTs only; collection-wide bids have no single token to check.
      const makerNfts = o.nfts.filter(
        (n) => n.side === "maker" && !isCollectionBid(n),
      );
      const takerNfts = o.nfts.filter(
        (n) => n.side === "taker" && !isCollectionBid(n),
      );

      const blockers: DealBlocker[] = [];

      // 0. A paused settlement contract blocks every trade — check it first so
      // a global halt reads as exactly that, not a per-NFT problem.
      const paused = await client
        .readContract({
          address: settlement,
          abi: settlementAbi,
          functionName: "paused",
        })
        .catch(() => null);
      if (paused === true) {
        blockers.push({
          code: "settlement-paused",
          message:
            "Handshake settlement is paused right now, so no deal can be filled. This is temporary and affects every trade, not just this one.",
        });
      }

      // 1. Every collection on the table must be on the settlement allowlist.
      const collections = Array.from(
        new Set(
          [...makerNfts, ...takerNfts].map((n) =>
            n.contractAddress.toLowerCase(),
          ),
        ),
      ) as Address[];
      const allowed = await Promise.all(
        collections.map((c) =>
          client
            .readContract({
              address: settlement,
              abi: settlementAbi,
              functionName: "isCollectionAllowed",
              args: [c],
            })
            .then((v) => ({ c, allowed: v as boolean }))
            .catch(() => ({ c, allowed: null as boolean | null })),
        ),
      );
      for (const r of allowed) {
        if (r.allowed === false) {
          blockers.push({
            code: "collection-not-allowed",
            message: `${labelFor(r.c)} isn't an approved collection for Handshake settlement, so this deal can't be filled on-chain.`,
          });
        }
      }

      // 2. Each concrete NFT must still be owned by the giving side.
      const ownerChecks = [
        ...makerNfts.map((n) => ({ n, expected: maker, who: "maker" as const })),
        ...takerNfts.map((n) => ({
          n,
          expected: takerOwner,
          who: "taker" as const,
        })),
      ];
      const owners = await Promise.all(
        ownerChecks.map((chk) =>
          client
            .readContract({
              address: chk.n.contractAddress as Address,
              abi: erc721Abi,
              functionName: "ownerOf",
              args: [BigInt(chk.n.tokenId)],
            })
            .then((owner) => ({ chk, owner: (owner as string).toLowerCase() }))
            .catch(() => ({ chk, owner: null as string | null })),
        ),
      );
      for (const { chk, owner } of owners) {
        if (owner && chk.expected && owner !== chk.expected.toLowerCase()) {
          blockers.push({
            code: chk.who === "maker" ? "maker-not-owner" : "taker-not-owner",
            message:
              chk.who === "maker"
                ? `The maker no longer owns ${labelFor(chk.n.contractAddress)} #${chk.n.tokenId}.`
                : `You no longer own ${labelFor(chk.n.contractAddress)} #${chk.n.tokenId}.`,
          });
        }
      }

      // 3. The maker must have approved settlement for each NFT they give.
      // Match the contract exactly: approval passes if the token is approved
      // individually (getApproved == settlement) OR the whole collection is
      // (isApprovedForAll). Checking only the latter would falsely flag a
      // single-token approval and wrongly disable Accept.
      const approvals = await Promise.all(
        makerNfts.map(async (n) => {
          const c = n.contractAddress as Address;
          const [all, one] = await Promise.all([
            client
              .readContract({
                address: c,
                abi: erc721Abi,
                functionName: "isApprovedForAll",
                args: [maker, settlement],
              })
              .then((v) => v as boolean)
              .catch(() => null),
            client
              .readContract({
                address: c,
                abi: erc721Abi,
                functionName: "getApproved",
                args: [BigInt(n.tokenId)],
              })
              .then((v) => (v as string).toLowerCase())
              .catch(() => null),
          ]);
          // Only conclude "not approved" when both reads succeeded and both
          // deny — an RPC failure must never fabricate a blocker.
          const approved =
            all === true || (one !== null && one === settlement.toLowerCase());
          const conclusive = all !== null && one !== null;
          return { n, approved, conclusive };
        }),
      );
      for (const { n, approved, conclusive } of approvals) {
        if (conclusive && !approved) {
          blockers.push({
            code: "maker-not-approved",
            message: `The maker hasn't approved ${labelFor(n.contractAddress)} #${n.tokenId} for settlement yet, so the contract can't move it.`,
          });
        }
      }

      // 3b. Creator-Token collections (e.g. The 10k Squad) gate every transfer
      // on an external validator. Even with approval, the validator can reject
      // the settlement contract as caller — reverting the whole trade with an
      // undecodable error. Ask the validator directly whether this exact move
      // is allowed. Needs a concrete recipient, so it runs once a taker exists.
      const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
      if (takerOwner) {
        const transfers = [
          ...makerNfts.map((n) => ({ n, from: maker, to: takerOwner })),
          ...takerNfts.map((n) => ({ n, from: takerOwner, to: maker })),
        ];
        const restricted = await Promise.all(
          transfers.map(async ({ n, from, to }) => {
            const c = n.contractAddress as Address;
            const validator = await client
              .readContract({
                address: c,
                abi: creatorTokenAbi,
                functionName: "getTransferValidator",
              })
              .then((v) => (v as string).toLowerCase())
              .catch(() => null);
            // No validator (plain ERC-721) → nothing to enforce.
            if (!validator || validator === ZERO_ADDR) {
              return { n, blocked: false };
            }
            const sim = await client
              .readContract({
                address: validator as Address,
                abi: transferValidatorAbi,
                functionName: "validateTransferSim",
                args: [
                  c,
                  settlement,
                  from as Address,
                  to as Address,
                  BigInt(n.tokenId),
                ],
              })
              .then((r) => r as readonly [boolean, string])
              .catch(() => null);
            // Only block on a definitive "not allowed"; an RPC/ABI miss never
            // fabricates a blocker.
            return { n, blocked: sim !== null && sim[0] === false };
          }),
        );
        for (const { n, blocked } of restricted) {
          if (blocked) {
            blockers.push({
              code: "transfer-restricted",
              message: `${labelFor(n.contractAddress)} restricts transfers to approved operators, and Handshake isn't authorized — so #${n.tokenId} can't be moved and this deal can't settle. This is set by the collection, not Handshake.`,
            });
          }
        }
      }

      // 4. Nonce already consumed — the deal was filled or cancelled.
      const nonceUsed = await client
        .readContract({
          address: settlement,
          abi: settlementAbi,
          functionName: "nonceUsed",
          args: [maker, BigInt(o.nonce)],
        })
        .catch(() => null);
      if (nonceUsed === true) {
        blockers.push({
          code: "nonce-used",
          message: "This deal has already been filled or cancelled on-chain.",
        });
      }

      // 5. If the maker owes ETH, their escrow must cover it.
      const makerEth = BigInt(o.makerEthAmount);
      if (makerEth > 0n) {
        const required = quoteFees(
          makerEth,
          0n,
          BigInt(o.feeBps),
        ).makerEscrowRequired;
        const balance = await client
          .readContract({
            address: settlement,
            abi: settlementAbi,
            functionName: "escrowBalance",
            args: [maker],
          })
          .catch(() => null);
        if (typeof balance === "bigint" && balance < required) {
          blockers.push({
            code: "maker-escrow",
            message:
              "The maker hasn't funded the ETH side of this deal in escrow yet.",
          });
        }
      }

      // 6. The taker must be able to cover their ETH leg + fees (msg.value).
      // Gas is on top; we check the value alone so a clear shortfall reads as
      // "not enough ETH" instead of a mystery revert in the eth_call.
      if (takerOwner) {
        const required = quoteFees(
          BigInt(o.makerEthAmount),
          BigInt(o.takerEthAmount),
          BigInt(o.feeBps),
          BigInt(o.flatFee),
        ).takerPays;
        if (required > 0n) {
          const balance = await client
            .getBalance({ address: takerOwner as Address })
            .catch(() => null);
          if (typeof balance === "bigint" && balance < required) {
            blockers.push({
              code: "taker-insufficient-eth",
              message: `You need ${formatEth(required)} ETH to accept this deal, but this wallet holds ${formatEth(balance)} ETH.`,
            });
          }
        }
      }

      blockers.sort(
        (a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code),
      );
      return { ok: blockers.length === 0, blockers };
    },
  });
}
