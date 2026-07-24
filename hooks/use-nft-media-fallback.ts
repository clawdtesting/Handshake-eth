"use client";

import { useQuery } from "@tanstack/react-query";
import type { NFTAsset } from "@/lib/types";

/**
 * Self-healing NFT media.
 *
 * The wallet indexer (Alchemy/OpenSea) sometimes lists a token with no image —
 * common for newer Ethereum collections whose media it hasn't cached yet. When
 * that happens we resolve the image the reliable way: on-chain `tokenURI()` →
 * metadata JSON → image URL, via `/api/token-metadata` (the same path the
 * manual "add by contract + token ID" flow already uses).
 *
 * Only fires when `enabled` (i.e. the card genuinely has no media), is keyed
 * by contract:tokenId so React Query dedupes and caches across every place the
 * token appears, and never retries a token that has no resolvable image.
 */
export function useNftMediaFallback(
  nft: Pick<NFTAsset, "contractAddress" | "tokenId">,
  enabled: boolean
): { imageUrl: string | null; metadata: Record<string, unknown> | null } {
  const { data } = useQuery({
    queryKey: ["nft-media-fallback", nft.contractAddress?.toLowerCase(), nft.tokenId],
    enabled: enabled && !!nft.contractAddress && !!nft.tokenId,
    staleTime: 60 * 60 * 1000, // an hour — token art doesn't change
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/token-metadata?contract=${nft.contractAddress}&tokenId=${nft.tokenId}`
      );
      if (!res.ok) return { imageUrl: null, metadata: null };
      const meta = await res.json();
      return {
        imageUrl: (meta.animationUrl ?? meta.image ?? null) as string | null,
        metadata: (meta.metadata ?? null) as Record<string, unknown> | null,
      };
    },
  });

  return {
    imageUrl: data?.imageUrl ?? null,
    metadata: data?.metadata ?? null,
  };
}
