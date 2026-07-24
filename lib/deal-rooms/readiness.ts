import { publicClient } from "@/lib/chains/client";
import { SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";
import {
  erc721Abi,
  findDisallowedCollections,
  settlementAbi,
} from "@/lib/contracts/settlement";
import type { DealRoomRevision, TradeOffer } from "@/lib/types";

/**
 * Settlement-readiness evaluation for a room's current draft.
 *
 * Everything here is DERIVED state — a UX layer that surfaces, before the
 * final signature, exactly what the settlement contract would enforce
 * atomically at fill time. The chain remains the only authority; a "ready"
 * report is a snapshot, never a guarantee.
 */

export type CheckStatus = "ok" | "action_required" | "unknown";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Which participant has to act, when status = action_required. */
  actor?: "maker" | "taker" | null;
  detail?: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  checkedAt: number;
}

async function ownerOf(
  contract: `0x${string}`,
  tokenId: bigint
): Promise<string | null> {
  try {
    const owner = (await publicClient.readContract({
      address: contract,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as string;
    return owner.toLowerCase();
  } catch {
    return null;
  }
}

async function isApproved(
  contract: `0x${string}`,
  owner: `0x${string}`
): Promise<boolean | null> {
  try {
    return (await publicClient.readContract({
      address: contract,
      abi: erc721Abi,
      functionName: "isApprovedForAll",
      args: [owner, SETTLEMENT_CONTRACT_ADDRESS],
    })) as boolean;
  } catch {
    return null;
  }
}

async function escrowBalance(wallet: `0x${string}`): Promise<bigint | null> {
  try {
    return (await publicClient.readContract({
      address: SETTLEMENT_CONTRACT_ADDRESS,
      abi: settlementAbi,
      functionName: "escrowBalance",
      args: [wallet],
    })) as bigint;
  } catch {
    return null;
  }
}

export async function isNonceUsed(
  maker: `0x${string}`,
  nonce: bigint
): Promise<boolean | null> {
  try {
    return (await publicClient.readContract({
      address: SETTLEMENT_CONTRACT_ADDRESS,
      abi: settlementAbi,
      functionName: "nonceUsed",
      args: [maker, nonce],
    })) as boolean;
  } catch {
    return null;
  }
}

function sideChecks(
  side: "maker" | "taker",
  wallet: string,
  nfts: DealRoomRevision["makerNFTs"],
  owners: (string | null)[],
  approvals: Map<string, boolean | null>
): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  nfts.forEach((nft, i) => {
    const owner = owners[i];
    const label = nft.name ?? `${nft.collectionName ?? nft.contractAddress.slice(0, 8)} #${nft.tokenId}`;
    if (owner === null) {
      checks.push({
        id: `${side}-own-${i}`,
        label: `${label} ownership`,
        status: "unknown",
        actor: side,
        detail: "Could not read owner — RPC issue or invalid token",
      });
    } else if (owner !== wallet.toLowerCase()) {
      checks.push({
        id: `${side}-own-${i}`,
        label: `${label} ownership`,
        status: "action_required",
        actor: side,
        detail: `No longer owned by the ${side} (now ${owner.slice(0, 6)}…)`,
      });
    } else {
      checks.push({
        id: `${side}-own-${i}`,
        label: `${label} owned by ${side}`,
        status: "ok",
        actor: side,
      });
    }
  });

  const collections = [...new Set(nfts.map((n) => n.contractAddress.toLowerCase()))];
  for (const c of collections) {
    const approved = approvals.get(`${wallet.toLowerCase()}:${c}`);
    checks.push({
      id: `${side}-approve-${c}`,
      label: `Settlement approval for ${c.slice(0, 8)}…`,
      status: approved === true ? "ok" : approved === false ? "action_required" : "unknown",
      actor: side,
      detail:
        approved === false
          ? `The ${side} must approve this collection for the settlement contract`
          : undefined,
    });
  }
  return checks;
}

export async function evaluateReadiness(
  revision: DealRoomRevision,
  sourceOffer: TradeOffer | null
): Promise<ReadinessReport> {
  const maker = revision.makerAddress.toLowerCase() as `0x${string}`;
  const taker = revision.takerAddress.toLowerCase() as `0x${string}`;

  const allCollections = [
    ...revision.makerNFTs.map((n) => n.contractAddress),
    ...revision.takerNFTs.map((n) => n.contractAddress),
  ];

  // Batch all chain reads.
  const [
    makerOwners,
    takerOwners,
    makerApprovalEntries,
    takerApprovalEntries,
    makerEscrow,
    disallowed,
    sourceNonceUsed,
  ] = await Promise.all([
    Promise.all(
      revision.makerNFTs.map((n) =>
        ownerOf(n.contractAddress as `0x${string}`, BigInt(n.tokenId))
      )
    ),
    Promise.all(
      revision.takerNFTs.map((n) =>
        ownerOf(n.contractAddress as `0x${string}`, BigInt(n.tokenId))
      )
    ),
    Promise.all(
      [...new Set(revision.makerNFTs.map((n) => n.contractAddress.toLowerCase()))].map(
        async (c) =>
          [`${maker}:${c}`, await isApproved(c as `0x${string}`, maker)] as const
      )
    ),
    Promise.all(
      [...new Set(revision.takerNFTs.map((n) => n.contractAddress.toLowerCase()))].map(
        async (c) =>
          [`${taker}:${c}`, await isApproved(c as `0x${string}`, taker)] as const
      )
    ),
    BigInt(revision.makerEthAmount) > 0n ? escrowBalance(maker) : Promise.resolve(0n),
    allCollections.length > 0
      ? findDisallowedCollections(publicClient, SETTLEMENT_CONTRACT_ADDRESS, allCollections)
      : Promise.resolve([]),
    sourceOffer && sourceOffer.status === "open"
      ? isNonceUsed(
          sourceOffer.makerAddress.toLowerCase() as `0x${string}`,
          BigInt(sourceOffer.nonce)
        )
      : Promise.resolve(null),
  ]);

  const approvals = new Map<string, boolean | null>([
    ...makerApprovalEntries,
    ...takerApprovalEntries,
  ]);

  const checks: ReadinessCheck[] = [
    ...sideChecks("maker", maker, revision.makerNFTs, makerOwners, approvals),
    ...sideChecks("taker", taker, revision.takerNFTs, takerOwners, approvals),
  ];

  // Maker ETH escrow.
  if (BigInt(revision.makerEthAmount) > 0n) {
    const needed = BigInt(revision.makerEthAmount);
    if (makerEscrow === null) {
      checks.push({
        id: "maker-escrow",
        label: "Maker ETH escrow",
        status: "unknown",
        actor: "maker",
      });
    } else {
      checks.push({
        id: "maker-escrow",
        label: "Maker ETH escrow",
        status: makerEscrow >= needed ? "ok" : "action_required",
        actor: "maker",
        detail:
          makerEscrow >= needed
            ? undefined
            : `Escrow ${makerEscrow} wei < required ${needed} wei — deposit the difference`,
      });
    }
  }

  // Collection allowlist.
  for (const c of disallowed) {
    checks.push({
      id: `allowlist-${c}`,
      label: `Collection ${c.slice(0, 8)}… allowlisted`,
      status: "action_required",
      actor: null,
      detail: "This collection isn't approved for trading on Handshake yet",
    });
  }

  // Draft offer expiry sanity.
  const now = Math.floor(Date.now() / 1000);
  checks.push({
    id: "offer-expiry",
    label: "Offer expiry in the future",
    status: revision.offerExpiry > now ? "ok" : "action_required",
    actor: "maker",
    detail:
      revision.offerExpiry > now
        ? undefined
        : "The draft's offer expiry has passed — propose a revision with a new expiry",
  });

  // Source-offer replacement gate: the original signed order must be dead
  // (nonce consumed on-chain) before a replacement can be signed, otherwise
  // two executable versions of the deal would coexist.
  if (sourceOffer && sourceOffer.status === "open") {
    checks.push({
      id: "source-nonce-retired",
      label: "Original signed offer retired",
      status:
        sourceNonceUsed === true
          ? "ok"
          : sourceNonceUsed === false
            ? "action_required"
            : "unknown",
      actor: "maker",
      detail:
        sourceNonceUsed === false
          ? "The original offer is still executable on-chain. Cancel its nonce before signing the replacement so only one version can settle."
          : undefined,
    });
  }

  return {
    ready: checks.every((c) => c.status === "ok"),
    checks,
    checkedAt: Date.now(),
  };
}
