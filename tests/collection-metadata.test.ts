import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  safeFetchJson: vi.fn(),
  safeProbeContentType: vi.fn(),
}));

vi.mock("@/lib/chains/client", () => ({
  publicClient: { readContract: mocks.readContract },
}));
vi.mock("@/lib/nft/safe-fetch", () => ({
  safeFetchJson: mocks.safeFetchJson,
  safeProbeContentType: mocks.safeProbeContentType,
}));

import { getCollectionMetadata } from "@/lib/nft/collection-metadata";

const CHAIN = 1;
// T00ns is the sole curated launch collection on Ethereum mainnet. It pins no
// local logo (image === the placeholder), so it deliberately resolves its real
// artwork from on-chain/indexer metadata rather than an "official" override.
const T00NS = "0x902d94ba5bfc0cb408d1a6ca4b8f255d845e50e9";

// Unique non-featured address per test → avoids the module-level cache.
let counter = 0;
function freshAddress(): string {
  counter += 1;
  return "0x" + counter.toString(16).padStart(40, "0");
}

function ok(json: unknown) {
  return { ok: true, json: async () => json } as unknown as Response;
}
function notOk() {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

interface ChainCfg {
  name?: string | Error;
  contractURI?: string | "throw";
  tokenURI?: Record<string, string | "throw">;
}

function setChain(cfg: ChainCfg) {
  mocks.readContract.mockImplementation(async ({ functionName, args }: any) => {
    if (functionName === "name") {
      if (cfg.name instanceof Error) throw cfg.name;
      return cfg.name ?? "Test Collection";
    }
    if (functionName === "contractURI") {
      if (!cfg.contractURI || cfg.contractURI === "throw") {
        throw new Error("contractURI revert");
      }
      return cfg.contractURI;
    }
    if (functionName === "tokenURI") {
      const id = args?.[0]?.toString();
      const v = cfg.tokenURI?.[id];
      if (!v || v === "throw") throw new Error("tokenURI revert");
      return v;
    }
    throw new Error(`unexpected fn ${functionName}`);
  });
}

beforeEach(() => {
  mocks.readContract.mockReset();
  mocks.safeFetchJson.mockReset();
  mocks.safeProbeContentType.mockReset();
  mocks.safeProbeContentType.mockResolvedValue(null);
  setChain({}); // everything reverts by default
  delete process.env.OPENSEA_API_KEY;
  global.fetch = vi.fn(async () => notOk()) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collection logo resolution", () => {
  it("curated collection with no pinned logo skips the official override", async () => {
    // T00ns is the sole curated collection and pins no local logo, so the
    // official-override source yields the placeholder and is discarded; the
    // collection's real artwork is resolved from on-chain/indexer metadata
    // instead (here every on-chain read reverts, so it lands on the
    // placeholder). This proves no Monad-era local logo override survives.
    const meta = await getCollectionMetadata(T00NS, CHAIN);
    expect(meta.source).not.toBe("official");
    expect(meta.image).toBe("/Logomark.png");
  });

  it("rejects an mp4 contractURI image and falls through to opensea", async () => {
    const address = freshAddress();
    process.env.OPENSEA_API_KEY = "k";
    setChain({ contractURI: "https://meta.test/c.json" });
    mocks.safeFetchJson.mockResolvedValue({
      name: "Vid",
      image: "https://cdn.test/animation.mp4",
    });
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/contract/")) return ok({ collection: "vid-slug" });
      if (u.includes("opensea.io/api/v2/collections/")) {
        return ok({ name: "Vid", image_url: "https://cdn.test/logo.png" });
      }
      return notOk();
    }) as any;

    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("opensea");
    expect(meta.image).toBe("https://cdn.test/logo.png");
    expect(meta.debug?.rejectedCandidates).toContainEqual({
      source: "contractURI",
      url: "https://cdn.test/animation.mp4",
      reason: "not-static-image",
    });
  });

  it("contractURI failure falls back to opensea", async () => {
    const address = freshAddress();
    process.env.OPENSEA_API_KEY = "k";
    setChain({ contractURI: "throw" });
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/contract/")) return ok({ collection: "s" });
      if (u.includes("opensea.io/api/v2/collections/")) {
        return ok({ name: "OS", image_url: "https://cdn.test/os.png" });
      }
      return notOk();
    }) as any;

    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("opensea");
    expect(meta.image).toBe("https://cdn.test/os.png");
  });

  it("opensea failure falls back to a representative token", async () => {
    const address = freshAddress();
    process.env.OPENSEA_API_KEY = "k";
    setChain({ contractURI: "throw", tokenURI: { "0": "https://meta.test/0" } });
    mocks.safeFetchJson.mockResolvedValue({
      name: "Tok",
      image: "https://cdn.test/token0.png",
    });
    global.fetch = vi.fn(async () => notOk()) as any; // opensea calls fail

    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("tokenURI");
    expect(meta.image).toBe("https://cdn.test/token0.png");
  });

  it("uses a representative token as the last static-image fallback", async () => {
    const address = freshAddress();
    // token 0 reverts, token 1 resolves — a reverting token must not break it.
    setChain({ contractURI: "throw", tokenURI: { "1": "https://meta.test/1" } });
    mocks.safeFetchJson.mockResolvedValue({
      name: "Tok",
      image: "https://cdn.test/token1.png",
    });
    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("tokenURI");
    expect(meta.image).toBe("https://cdn.test/token1.png");
  });

  it("never uses a token animation_url as the logo", async () => {
    const address = freshAddress();
    const mp4 = "https://cdn.test/same.mp4";
    setChain({ contractURI: "throw", tokenURI: { "0": "https://meta.test/0" } });
    mocks.safeFetchJson.mockResolvedValue({ image: mp4, animation_url: mp4 });
    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("placeholder");
    expect(meta.image).toBe("/Logomark.png");
  });

  it("falls back to the placeholder when every source fails", async () => {
    const address = freshAddress();
    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("placeholder");
    expect(meta.image).toBe("/Logomark.png");
  });

  it("probes extensionless remote images and rejects non-image content types", async () => {
    const address = freshAddress();
    setChain({ contractURI: "https://meta.test/c.json" });
    mocks.safeFetchJson.mockResolvedValue({
      image: "https://cdn.test/opaque",
    });
    mocks.safeProbeContentType.mockResolvedValue("video/mp4");
    const meta = await getCollectionMetadata(address, CHAIN);
    expect(meta.source).toBe("placeholder");
  });
});
