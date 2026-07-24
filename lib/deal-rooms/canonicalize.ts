import { keccak256, stringToHex } from "viem";
import type { DealRoomDraft, RevisionNFT } from "@/lib/types";

/**
 * Canonical representation + hash of a draft's trade terms.
 *
 * The terms hash binds three things to the exact same terms: (1) both
 * participants' acceptances, (2) duplicate-revision rejection, and (3) the
 * final EIP-712 order, which the finalize API verifies field-by-field against
 * the accepted revision. It is deliberately NOT the contract order hash — a
 * draft has no nonce or signature yet.
 */

export interface CanonicalNFT {
  contractAddress: string;
  tokenId: string;
}

export interface CanonicalTerms {
  makerAddress: string;
  takerAddress: string;
  makerNFTs: CanonicalNFT[];
  takerNFTs: CanonicalNFT[];
  makerEthAmount: string;
  takerEthAmount: string;
  feeBps: number;
  flatFee: string;
  offerExpiry: number;
}

function canonicalNFTs(nfts: RevisionNFT[]): CanonicalNFT[] {
  return nfts
    .map((n) => ({
      contractAddress: n.contractAddress.toLowerCase(),
      // Normalize to canonical decimal (strips leading zeros, validates digits).
      tokenId: BigInt(n.tokenId).toString(),
    }))
    .sort((a, b) =>
      a.contractAddress === b.contractAddress
        ? a.tokenId.length === b.tokenId.length
          ? a.tokenId.localeCompare(b.tokenId)
          : a.tokenId.length - b.tokenId.length
        : a.contractAddress.localeCompare(b.contractAddress)
    );
}

export function canonicalizeTerms(draft: DealRoomDraft): CanonicalTerms {
  return {
    makerAddress: draft.makerAddress.toLowerCase(),
    takerAddress: draft.takerAddress.toLowerCase(),
    makerNFTs: canonicalNFTs(draft.makerNFTs),
    takerNFTs: canonicalNFTs(draft.takerNFTs),
    makerEthAmount: BigInt(draft.makerEthAmount).toString(),
    takerEthAmount: BigInt(draft.takerEthAmount).toString(),
    feeBps: draft.feeBps,
    flatFee: BigInt(draft.flatFee).toString(),
    offerExpiry: draft.offerExpiry,
  };
}

/** Stable JSON: keys serialized in the fixed order defined above. */
export function canonicalJson(terms: CanonicalTerms): string {
  return JSON.stringify({
    makerAddress: terms.makerAddress,
    takerAddress: terms.takerAddress,
    makerNFTs: terms.makerNFTs.map((n) => ({
      contractAddress: n.contractAddress,
      tokenId: n.tokenId,
    })),
    takerNFTs: terms.takerNFTs.map((n) => ({
      contractAddress: n.contractAddress,
      tokenId: n.tokenId,
    })),
    makerEthAmount: terms.makerEthAmount,
    takerEthAmount: terms.takerEthAmount,
    feeBps: terms.feeBps,
    flatFee: terms.flatFee,
    offerExpiry: terms.offerExpiry,
  });
}

export function termsHash(draft: DealRoomDraft): `0x${string}` {
  return keccak256(stringToHex(canonicalJson(canonicalizeTerms(draft))));
}
