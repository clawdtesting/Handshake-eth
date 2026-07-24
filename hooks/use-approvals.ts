"use client";

import { useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ETH_MAINNET_CHAIN_ID, SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import {
  creatorTokenAbi,
  erc721Abi,
  transferValidatorAbi,
} from "@/lib/contracts/settlement";
import type { Address } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Visual approval state of a collection for the settlement contract. */
export type ApprovalState =
  | "approved"
  | "unapproved"
  | "pending"
  | "restricted"
  | "unknown";

export const COLLECTION_APPROVALS_KEY = "collection-approvals";

type ApprovalReadResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

/**
 * Reads isApprovedForAll(owner, settlement) for a set of collection contracts
 * (the connected wallet as owner). Powers the approval dots on NFT cards.
 * Distinct collections are read in one multicall, cached briefly, and
 * refetched on demand after the user approves.
 */
export function useCollectionApprovals(contracts: string[]) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const owner = address?.toLowerCase() ?? null;

  const uniqueContracts = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.toLowerCase()))).sort(),
    [contracts],
  );

  const settlementConfigured =
    SETTLEMENT_CONTRACT_ADDRESS !==
    "0x0000000000000000000000000000000000000000";

  const query = useQuery({
    queryKey: [COLLECTION_APPROVALS_KEY, owner, uniqueContracts],
    enabled:
      !!owner && !!publicClient && settlementConfigured && uniqueContracts.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const client = publicClient!;
      const contracts = uniqueContracts.map((contract) => ({
        address: contract as Address,
        abi: erc721Abi,
        functionName: "isApprovedForAll" as const,
        args: [owner as Address, SETTLEMENT_CONTRACT_ADDRESS] as const,
      }));

      // Some Ethereum RPC providers either reject eth_call bundles or return a
      // failed result for every item. Multicall is the fast path, but approval
      // verification must retain the individual-read behavior that works on
      // those providers; otherwise every NFT is incorrectly treated as
      // unverifiable and the picker shows 0/N.
      let reads: ApprovalReadResult[] | null = null;
      try {
        reads = (await client.multicall({
          allowFailure: true,
          contracts,
        })) as ApprovalReadResult[];
      } catch {
        // Fall through and retry every collection individually.
      }

      const entries = await Promise.all(
        uniqueContracts.map(async (contract, index) => {
          const result = reads?.[index];
          if (result?.status === "success") {
            return [contract, Boolean(result.result)] as const;
          }

          try {
            const approved = await client.readContract(contracts[index]);
            return [contract, Boolean(approved)] as const;
          } catch {
            return [contract, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, boolean | null>;
    },
  });

  const stateFor = useMemo(() => {
    const map = query.data ?? {};
    return (contract: string, pending = false): ApprovalState => {
      const value = map[contract.toLowerCase()];
      if (value === true) return "approved";
      if (pending) return "pending";
      if (value === false) return "unapproved";
      return "unknown";
    };
  }, [query.data]);

  return { ...query, stateFor, chainId: ETH_MAINNET_CHAIN_ID };
}

/**
 * Which of `contracts` are tradable on Handshake (settlement allowlist +
 * timelock). Lets the trade UI show only supported collections rather than the
 * wallet's entire holdings (LP positions, vouchers, spam, …).
 */
export function useAllowedCollections(contracts: string[]) {
  const unique = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.toLowerCase()))).sort(),
    [contracts],
  );

  const query = useQuery({
    queryKey: ["collection-allowlist", unique],
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < unique.length; i += 50) {
        chunks.push(unique.slice(i, i + 50));
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          fetch(`/api/collections/allowed?contracts=${chunk.join(",")}`).then(
            async (response) => {
              if (!response.ok) {
                throw new Error(`Allowlist request failed (${response.status})`);
              }
              const data = await response.json();
              return data.allowed as Record<string, boolean>;
            },
          ),
        ),
      );
      return Object.assign({}, ...results) as Record<string, boolean>;
    },
  });

  const isReady = query.data !== undefined;
  const isAllowed = (contract: string) =>
    query.data?.[contract.toLowerCase()] === true;

  return { ...query, isReady, isAllowed };
}

/**
 * Which of `contracts` cannot actually settle on Handshake because the
 * collection enforces a Creator Token transfer validator that rejects the
 * settlement contract as operator (e.g. The 10k Squad). These pass the
 * allowlist + approval checks but still revert at transfer time, so the picker
 * flags them and keeps them out of the selectable set.
 *
 * Fails open: a collection is only marked restricted when its validator
 * definitively denies the settlement operator. No validator, or any RPC/ABI
 * miss, leaves it unrestricted.
 */
export function useTransferRestrictedCollections(contracts: string[]) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const owner = address?.toLowerCase() ?? null;

  const unique = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.toLowerCase()))).sort(),
    [contracts],
  );

  const settlementConfigured =
    SETTLEMENT_CONTRACT_ADDRESS !== ZERO_ADDRESS;

  const query = useQuery({
    queryKey: ["transfer-restricted", owner, unique],
    enabled:
      !!owner && !!publicClient && settlementConfigured && unique.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const client = publicClient!;
      const entries = await Promise.all(
        unique.map(async (contract) => {
          const validator = await client
            .readContract({
              address: contract as Address,
              abi: creatorTokenAbi,
              functionName: "getTransferValidator",
            })
            .then((v) => (v as string).toLowerCase())
            .catch(() => null);
          // Plain ERC-721 (no validator) → never restricted.
          if (!validator || validator === ZERO_ADDRESS) {
            return [contract, false] as const;
          }
          // Probe the operator policy with the connected wallet on both sides,
          // isolating the caller (operator) check from any receiver rule.
          const sim = await client
            .readContract({
              address: validator as Address,
              abi: transferValidatorAbi,
              functionName: "validateTransferSim",
              args: [
                contract as Address,
                SETTLEMENT_CONTRACT_ADDRESS,
                owner as Address,
                owner as Address,
              ],
            })
            .then((r) => r as readonly [boolean, string])
            .catch(() => null);
          return [contract, sim !== null && sim[0] === false] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, boolean>;
    },
  });

  const isRestricted = (contract: string) =>
    query.data?.[contract.toLowerCase()] === true;

  return { ...query, isRestricted };
}
