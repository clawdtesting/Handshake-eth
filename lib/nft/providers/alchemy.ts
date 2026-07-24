import type { NFTAsset } from "@/lib/types";
import type {
  CollectionInfo,
  NFTProvider,
  WalletNFTsResult,
} from "@/lib/nft/provider";

/**
 * Alchemy NFT API v3 provider. Network slug is configurable so the same
 * code serves Ethereum mainnet.
 */

const ALCHEMY_NETWORK = process.env.ALCHEMY_NETWORK ?? "ethereum-mainnet";

function baseUrl(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set");
  return `https://${ALCHEMY_NETWORK}.g.alchemy.com/nft/v3/${key}`;
}

function metadataMediaUrl(metadata: any): string | null {
  const value =
    metadata?.animation_url ??
    metadata?.animationUrl ??
    metadata?.animation ??
    metadata?.image ??
    metadata?.image_url ??
    metadata?.imageUrl ??
    null;
  return typeof value === "string" && value.trim() ? value : null;
}

function toAsset(raw: any): NFTAsset {
  const metadata = raw.raw?.metadata ?? null;

  return {
    contractAddress: (raw.contract?.address ?? "").toLowerCase(),
    tokenId: String(raw.tokenId ?? ""),
    tokenStandard: "ERC721",
    name: raw.name ?? raw.raw?.metadata?.name ?? null,
    collectionName: raw.contract?.name ?? null,
    // Prefer Alchemy's already-resolved CDN copy over the raw (often ipfs://)
    // metadata URL — the CDN copy is reliable and not rate-limited. Animated
    // tokens still expose animation_url via `metadata`, which the media layer
    // reads first, so this only changes the still-image source.
    imageUrl:
      raw.image?.cachedUrl ??
      raw.image?.thumbnailUrl ??
      metadataMediaUrl(metadata) ??
      raw.image?.originalUrl ??
      raw.image?.pngUrl ??
      null,
    metadata,
  };
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    throw new Error(`Alchemy request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export const alchemyProvider: NFTProvider = {
  name: "alchemy",

  async getWalletNFTs(owner, options): Promise<WalletNFTsResult> {
    const params = new URLSearchParams({
      owner,
      withMetadata: "true",
      pageSize: String(options?.pageSize ?? 50),
    });
    if (options?.pageKey) params.set("pageKey", options.pageKey);
    const data = await fetchJson(`${baseUrl()}/getNFTsForOwner?${params}`);
    // Alchemy labels some valid ERC-721 collections as UNKNOWN /
    // NO_SUPPORTED_NFT_STANDARD on newer chains, so only exclude tokens
    // that are positively NOT ERC-721. Ownership/approvals are verified
    // on-chain at settlement anyway.
    const nfts: NFTAsset[] = (data.ownedNfts ?? [])
      .filter((n: any) => {
        const type = String(n.tokenType ?? "").toUpperCase();
        return type !== "ERC1155";
      })
      .map(toAsset);
    return { nfts, pageKey: data.pageKey ?? null };
  },

  async getCollection(contractAddress): Promise<CollectionInfo | null> {
    try {
      const data = await fetchJson(
        `${baseUrl()}/getContractMetadata?contractAddress=${contractAddress}`
      );
      return {
        contractAddress: contractAddress.toLowerCase(),
        name: data.name ?? null,
        imageUrl: data.openSeaMetadata?.imageUrl ?? null,
        totalSupply: data.totalSupply ?? null,
        description: data.openSeaMetadata?.description ?? null,
      };
    } catch {
      return null;
    }
  },

  async getToken(contractAddress, tokenId): Promise<NFTAsset | null> {
    try {
      const data = await fetchJson(
        `${baseUrl()}/getNFTMetadata?contractAddress=${contractAddress}&tokenId=${tokenId}`
      );
      return toAsset(data);
    } catch {
      return null;
    }
  },

  async searchCollection(query): Promise<CollectionInfo[]> {
    try {
      const data = await fetchJson(
        `${baseUrl()}/searchContractMetadata?query=${encodeURIComponent(query)}`
      );
      return (data.contracts ?? []).map((c: any) => ({
        contractAddress: (c.address ?? "").toLowerCase(),
        name: c.name ?? null,
        imageUrl: c.openSeaMetadata?.imageUrl ?? null,
        totalSupply: c.totalSupply ?? null,
        description: c.openSeaMetadata?.description ?? null,
      }));
    } catch {
      return [];
    }
  },
};
