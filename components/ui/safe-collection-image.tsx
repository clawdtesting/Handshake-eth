"use client";

/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import type { CollectionMetadata } from "@/lib/nft/collection-metadata";
import { cn } from "@/lib/utils";

async function fetchMetadata(address: string, chainId: number) {
  const res = await fetch(`/api/collection-metadata?address=${address}&chainId=${chainId}`);
  if (!res.ok) throw new Error("Failed to fetch collection metadata");
  const json = (await res.json()) as { metadata: CollectionMetadata };
  return json.metadata;
}

export function useCollectionMetadata(collectionAddress?: string | null, chainId = ETH_MAINNET_CHAIN_ID) {
  const address = collectionAddress?.toLowerCase();
  return useQuery({
    queryKey: ["collection-metadata", chainId, address],
    enabled: !!address,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: () => fetchMetadata(address!, chainId),
  });
}

export function SafeCollectionImage({
  collectionAddress,
  chainId = ETH_MAINNET_CHAIN_ID,
  alt,
  className,
  fallbackSrc = "/Logomark.png",
}: {
  collectionAddress?: string | null;
  chainId?: number;
  alt: string;
  className?: string;
  fallbackSrc?: string;
}) {
  const { data } = useCollectionMetadata(collectionAddress, chainId);
  const src = useMemo(() => data?.image || fallbackSrc, [data?.image, fallbackSrc]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const finalSrc = failedSrc === src ? fallbackSrc : src;

  return (
    <img
      src={finalSrc}
      alt={alt}
      className={cn("block bg-muted object-cover", className)}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}
