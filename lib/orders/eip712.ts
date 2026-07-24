import {
  type Address,
  type Client,
  type Hex,
  type TypedDataDomain,
  hashTypedData,
  verifyTypedData,
} from "viem";
import { verifyTypedData as verifyTypedDataOnchain } from "viem/actions";
import { ETH_MAINNET_CHAIN_ID, SETTLEMENT_CONTRACT_ADDRESS } from "@/lib/chains/ethereum";

/**
 * EIP-712 order model. Must stay byte-compatible with
 * contracts/src/Handshake.sol.
 */

export const ORDER_TYPES = {
  TradeOrder: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "makerNFTs", type: "NFTItem[]" },
    { name: "takerNFTs", type: "NFTItem[]" },
    { name: "makerEthAmount", type: "uint256" },
    { name: "takerEthAmount", type: "uint256" },
    { name: "feeBps", type: "uint256" },
    { name: "flatFee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
  NFTItem: [
    { name: "standard", type: "uint8" },
    { name: "contractAddress", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
} as const;

export interface NFTItem {
  standard: 0 | 1;
  contractAddress: Address;
  tokenId: bigint;
  amount: bigint;
}

export interface TradeOrder {
  maker: Address;
  taker: Address;
  makerNFTs: NFTItem[];
  takerNFTs: NFTItem[];
  makerEthAmount: bigint;
  takerEthAmount: bigint;
  feeBps: bigint;
  flatFee: bigint;
  nonce: bigint;
  expiry: bigint;
}

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

export function getOrderDomain(
  chainId: number = ETH_MAINNET_CHAIN_ID,
  verifyingContract: Address = SETTLEMENT_CONTRACT_ADDRESS
): TypedDataDomain {
  return {
    name: "Handshake",
    version: "1",
    chainId,
    verifyingContract,
  };
}

export function hashOrder(
  order: TradeOrder,
  chainId?: number,
  verifyingContract?: Address
): Hex {
  return hashTypedData({
    domain: getOrderDomain(chainId, verifyingContract),
    types: ORDER_TYPES,
    primaryType: "TradeOrder",
    message: order,
  });
}

/**
 * Offline (ECDSA-only) signature check. Does NOT accept smart-contract-wallet
 * (EIP-1271) signatures. Prefer `verifyOrderSignatureOnchain` on the server so
 * Safe / account-abstraction makers — which the settlement contract accepts via
 * SignatureChecker — are not silently rejected.
 */
export async function verifyOrderSignature(
  order: TradeOrder,
  signature: Hex,
  chainId?: number,
  verifyingContract?: Address
): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: order.maker,
      domain: getOrderDomain(chainId, verifyingContract),
      types: ORDER_TYPES,
      primaryType: "TradeOrder",
      message: order,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Server-side signature check that accepts BOTH plain EOA (ECDSA) and
 * smart-contract-wallet signatures. Uses viem's on-chain `verifyTypedData`,
 * which falls back to EIP-1271 `isValidSignature` (and ERC-6492 for
 * not-yet-deployed accounts) via the provided client — mirroring the settlement
 * contract's SignatureChecker so any maker the contract would accept at fill
 * time can also create an offer.
 */
export async function verifyOrderSignatureOnchain(
  client: Client,
  order: TradeOrder,
  signature: Hex,
  chainId?: number,
  verifyingContract?: Address
): Promise<boolean> {
  try {
    return await verifyTypedDataOnchain(client, {
      address: order.maker,
      domain: getOrderDomain(chainId, verifyingContract),
      types: ORDER_TYPES,
      primaryType: "TradeOrder",
      message: order,
      signature,
    });
  } catch {
    return false;
  }
}

/** Random 256-bit nonce; avoids cross-device nonce coordination. */
export function generateNonce(): bigint {
  const bytes =
    typeof crypto !== "undefined"
      ? crypto.getRandomValues(new Uint8Array(32))
      : new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}
