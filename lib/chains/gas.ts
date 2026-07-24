import type { PublicClient } from "viem";

/**
 * Estimate gas for a contract write and add headroom. Some Ethereum RPC nodes
 * reject transactions whose gas limit is merely estimate-tight with
 * "Gas limit too low", so we pad the estimate by 50%. Returns undefined on
 * estimation failure so the caller can fall back to the wallet's own default
 * rather than blocking the transaction.
 */
export async function bufferedGas(
  publicClient: Pick<PublicClient, "estimateContractGas">,
  params: Parameters<PublicClient["estimateContractGas"]>[0]
): Promise<bigint | undefined> {
  try {
    const estimate = await publicClient.estimateContractGas(params);
    return (estimate * 3n) / 2n;
  } catch {
    return undefined;
  }
}
