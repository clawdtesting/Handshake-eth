import { publicClient } from "@/lib/chains/client";
import { erc721Abi } from "@/lib/contracts/settlement";
import { getFeaturedCollection } from "@/lib/featured-collections";
import { safeFetchJson, safeProbeContentType } from "@/lib/nft/safe-fetch";
import { resolveUri } from "@/lib/nft/onchain-metadata";

export const COLLECTION_PLACEHOLDER_IMAGE = "/Logomark.svg";

export interface CollectionMetadata {
  name: string | null;
  image: string;
  banner: string | null;
  floorPrice: number | null;
  collectionAddress: string;
  source:
    | "official"
    | "contractURI"
    | "opensea"
    | "tokenURI"
    | "local"
    | "placeholder";
  /** Present only outside production, to explain how the logo was chosen. */
  debug?: {
    attemptedSources: string[];
    selectedSource: CollectionMetadata["source"];
    rejectedCandidates: { source: string; url: string; reason: string }[];
  };
}

const TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 1000;
const cache = new Map<string, { at: number; value: CollectionMetadata }>();

const isDev = process.env.NODE_ENV !== "production";

// ---------------------------------------------------------------------
// Static-image validation. A collection LOGO must be a still image — never
// an mp4/webm/model/audio or an animation_url. This guards SafeCollectionImage
// (which renders into an <img>) from ever receiving playable media.
// ---------------------------------------------------------------------

const STATIC_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
  "bmp",
  "ico",
]);
const NON_IMAGE_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mov",
  "m4v",
  "ogv",
  "avi",
  "mkv",
  "glb",
  "gltf",
  "mp3",
  "wav",
  "flac",
  "aac",
  "m4a",
  "oga",
  "ogg",
  "opus",
]);

function extensionOf(url: string): string | null {
  const clean = url.split(/[?#]/)[0] ?? url;
  const last = clean.split("/").pop() ?? "";
  if (!last.includes(".")) return null;
  return last.split(".").pop()?.toLowerCase() || null;
}

type ImageVerdict = "image" | "reject" | "unknown";

/** Extension/scheme-based classification (no network). */
export function classifyImageUrl(url: string | null | undefined): ImageVerdict {
  if (!url || typeof url !== "string" || !url.trim()) return "reject";
  const trimmed = url.trim();
  if (trimmed.startsWith("data:")) {
    return trimmed.startsWith("data:image/") ? "image" : "reject";
  }
  const ext = extensionOf(trimmed);
  if (!ext) return "unknown";
  if (STATIC_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (NON_IMAGE_EXTENSIONS.has(ext)) return "reject";
  return "unknown";
}

/**
 * True only if `url` is a static image. Extensionless remote URLs are probed
 * server-side (bounded, SSRF-safe) via Content-Type; local project files are
 * trusted. A probe failure resolves to false so a logo is never guessed.
 */
async function isStaticImage(url: string): Promise<boolean> {
  const verdict = classifyImageUrl(url);
  if (verdict === "image") return true;
  if (verdict === "reject") return false;
  // unknown extension:
  if (url.startsWith("/")) return true; // project-controlled local asset
  const contentType = await safeProbeContentType(url);
  return !!contentType && contentType.startsWith("image/");
}

// ---------------------------------------------------------------------

interface ResolveContext {
  attemptedSources: string[];
  rejectedCandidates: { source: string; url: string; reason: string }[];
}

function cacheSet(key: string, value: CollectionMetadata) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

function metadata(
  address: string,
  source: CollectionMetadata["source"],
  data: Partial<CollectionMetadata>,
): CollectionMetadata {
  return {
    name: data.name ?? null,
    image: data.image || COLLECTION_PLACEHOLDER_IMAGE,
    banner: data.banner ?? null,
    floorPrice: data.floorPrice ?? null,
    collectionAddress: address.toLowerCase(),
    source,
  };
}

/** Build validated metadata for a source, or null if the image isn't static. */
async function buildValidated(
  address: string,
  source: CollectionMetadata["source"],
  data: Partial<CollectionMetadata>,
  ctx: ResolveContext,
): Promise<CollectionMetadata | null> {
  const image = typeof data.image === "string" ? data.image.trim() : "";
  if (!image) {
    ctx.rejectedCandidates.push({ source, url: "", reason: "no-image" });
    return null;
  }
  if (await isStaticImage(image)) {
    return metadata(address, source, data);
  }
  ctx.rejectedCandidates.push({ source, url: image, reason: "not-static-image" });
  return null;
}

function logFailure(address: string, source: string, error: unknown) {
  // Never log API keys — only the address, source, and error.
  console.warn("[collection-metadata]", { address, source, error });
}

// ---------------------------------------------------------------------
// Sources (in resolution priority order)
// ---------------------------------------------------------------------

async function fromOfficialOverride(
  address: string,
  ctx: ResolveContext,
): Promise<CollectionMetadata | null> {
  const collection = getFeaturedCollection(address);
  if (!collection) return null;
  const image = collection.officialLogo ?? collection.image;
  return buildValidated(address, "official", { name: collection.name, image }, ctx);
}

const erc721CollectionAbi = [
  ...erc721Abi,
  {
    type: "function",
    name: "contractURI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

async function readMetadataJson(uri: unknown): Promise<any | null> {
  if (typeof uri !== "string" || !uri) return null;
  // data: URIs are handled inline; http(s)/ipfs go through the SSRF guard.
  if (uri.startsWith("data:application/json")) {
    const comma = uri.indexOf(",");
    if (comma < 0) return null;
    const meta = uri.slice(0, comma);
    const payload = uri.slice(comma + 1);
    try {
      return meta.includes(";base64")
        ? JSON.parse(Buffer.from(payload, "base64").toString("utf8"))
        : JSON.parse(decodeURIComponent(payload));
    } catch {
      return null;
    }
  }
  return safeFetchJson(resolveUri(uri));
}

function pickImageField(json: any): string | null {
  const raw = json?.image ?? json?.image_url ?? json?.imageUrl ?? null;
  return typeof raw === "string" ? resolveUri(raw) : null;
}

async function fromContractURI(
  address: string,
  ctx: ResolveContext,
): Promise<CollectionMetadata | null> {
  const [uriResult, nameResult] = await Promise.allSettled([
    publicClient.readContract({
      address: address as `0x${string}`,
      abi: erc721CollectionAbi,
      functionName: "contractURI",
    }),
    publicClient.readContract({
      address: address as `0x${string}`,
      abi: erc721Abi,
      functionName: "name",
    }),
  ]);
  if (uriResult.status !== "fulfilled" || !uriResult.value) return null;
  const json = await readMetadataJson(uriResult.value);
  if (!json) return null;
  const rawBanner = json.banner ?? json.banner_image_url ?? json.bannerImageUrl ?? null;
  const name =
    typeof json.name === "string"
      ? json.name
      : nameResult.status === "fulfilled"
        ? (nameResult.value ?? undefined)
        : undefined;
  return buildValidated(
    address,
    "contractURI",
    {
      name: name ?? undefined,
      image: pickImageField(json) ?? undefined,
      banner: typeof rawBanner === "string" ? resolveUri(rawBanner) : undefined,
    },
    ctx,
  );
}

async function fromOpenSea(
  address: string,
  ctx: ResolveContext,
): Promise<CollectionMetadata | null> {
  if (!process.env.OPENSEA_API_KEY) return null;
  const headers = {
    accept: "application/json",
    "x-api-key": process.env.OPENSEA_API_KEY,
  };
  const chain = process.env.OPENSEA_CHAIN ?? "ethereum";
  const contractRes = await fetch(
    `https://api.opensea.io/api/v2/chain/${chain}/contract/${address}`,
    { headers, next: { revalidate: 600 } },
  );
  if (!contractRes.ok) return null;
  const contract = await contractRes.json();
  const slug = contract.collection;
  if (!slug) return null;
  const colRes = await fetch(`https://api.opensea.io/api/v2/collections/${slug}`, {
    headers,
    next: { revalidate: 600 },
  });
  if (!colRes.ok) return null;
  const c = await colRes.json();
  return buildValidated(
    address,
    "opensea",
    {
      name: c.name ?? slug,
      image: c.image_url ?? undefined,
      banner: c.banner_image_url ?? null,
    },
    ctx,
  );
}

/**
 * LAST external fallback: a representative token's STATIC artwork. Bounded to a
 * tiny candidate set (token IDs 0 and 1), stops at the first valid static
 * image, rejects all video/animation, and never throws when a token reverts.
 */
async function fromRepresentativeToken(
  address: string,
  ctx: ResolveContext,
): Promise<CollectionMetadata | null> {
  const candidateIds = [0n, 1n];
  const nameResult = await publicClient
    .readContract({
      address: address as `0x${string}`,
      abi: erc721Abi,
      functionName: "name",
    })
    .catch(() => null);
  const name = typeof nameResult === "string" ? nameResult : undefined;

  for (const tokenId of candidateIds) {
    const uriResult = await Promise.allSettled([
      publicClient.readContract({
        address: address as `0x${string}`,
        abi: erc721Abi,
        functionName: "tokenURI",
        args: [tokenId],
      }),
    ]);
    const uri = uriResult[0];
    if (uri.status !== "fulfilled" || !uri.value) continue;
    const json = await readMetadataJson(uri.value);
    if (!json) continue;
    // Never treat an animation_url as a logo.
    const image = pickImageField(json);
    const animation =
      typeof (json.animation_url ?? json.animationUrl) === "string"
        ? resolveUri(json.animation_url ?? json.animationUrl)
        : null;
    if (!image || (animation && image === animation)) {
      ctx.rejectedCandidates.push({
        source: "tokenURI",
        url: image ?? "",
        reason: "animation-or-missing",
      });
      continue;
    }
    const built = await buildValidated(
      address,
      "tokenURI",
      { name, image },
      ctx,
    );
    if (built) return built;
  }
  return null;
}

// ---------------------------------------------------------------------

export async function getCollectionMetadata(
  collectionAddress: string,
  chainId: number,
): Promise<CollectionMetadata> {
  const address = collectionAddress.toLowerCase();
  const key = `${chainId}:${address}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const ctx: ResolveContext = { attemptedSources: [], rejectedCandidates: [] };

  const loaders: {
    source: CollectionMetadata["source"];
    run: () => Promise<CollectionMetadata | null>;
  }[] = [
    { source: "official", run: () => fromOfficialOverride(address, ctx) },
    { source: "contractURI", run: () => fromContractURI(address, ctx) },
    { source: "opensea", run: () => fromOpenSea(address, ctx) },
    { source: "tokenURI", run: () => fromRepresentativeToken(address, ctx) },
  ];

  for (const { source, run } of loaders) {
    ctx.attemptedSources.push(source);
    try {
      const value = await run();
      if (value && value.image !== COLLECTION_PLACEHOLDER_IMAGE) {
        if (isDev) {
          value.debug = {
            attemptedSources: ctx.attemptedSources,
            selectedSource: value.source,
            rejectedCandidates: ctx.rejectedCandidates,
          };
        }
        cacheSet(key, value);
        return value;
      }
    } catch (error) {
      logFailure(address, source, error);
    }
  }

  const value = metadata(address, "placeholder", {});
  if (isDev) {
    value.debug = {
      attemptedSources: ctx.attemptedSources,
      selectedSource: "placeholder",
      rejectedCandidates: ctx.rejectedCandidates,
    };
  }
  cacheSet(key, value);
  return value;
}
