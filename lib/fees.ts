/**
 * Protocol fee math. Mirrors Handshake.sol exactly
 * (integer division, bps on each ETH leg, flat fee on NFT-only swaps).
 */

export const DEFAULT_FEE_BPS = 100n; // 1%
export const BPS_DENOMINATOR = 10_000n;

export interface FeeQuote {
  makerLegFee: bigint;
  takerLegFee: bigint;
  flatFee: bigint;
  totalFee: bigint;
  /** msg.value the taker must send: takerEthAmount + takerLegFee + flatFee */
  takerPays: bigint;
  /** escrow the maker must hold: makerEthAmount + makerLegFee */
  makerEscrowRequired: bigint;
}

export function quoteFees(
  makerEthAmount: bigint,
  takerEthAmount: bigint,
  feeBps: bigint = DEFAULT_FEE_BPS,
  flatSwapFee: bigint = 0n
): FeeQuote {
  const makerLegFee = (makerEthAmount * feeBps) / BPS_DENOMINATOR;
  const takerLegFee = (takerEthAmount * feeBps) / BPS_DENOMINATOR;
  const flatFee = makerEthAmount === 0n && takerEthAmount === 0n ? flatSwapFee : 0n;
  const totalFee = makerLegFee + takerLegFee + flatFee;
  return {
    makerLegFee,
    takerLegFee,
    flatFee,
    totalFee,
    takerPays: takerEthAmount + takerLegFee + flatFee,
    makerEscrowRequired: makerEthAmount + makerLegFee,
  };
}
