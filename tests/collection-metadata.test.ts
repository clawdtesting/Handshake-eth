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
const TENK = "0x818030837e8350ba63e64d7dc01a547fa73c8279";
const EREBUS = "0x2a0001f3d4c98881376f8d36b3c61f163d84a095";

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
  it("official override wins for a curated collection (10kSquad → local static)", async () => {
    const meta = await getCollectionMetadata(TENK, CHAIN);
    expect(meta.source).toBe("official");
    expect(meta.image).toBe("/collections/10Ksquad.png");
    // No network needed for an official override.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("matches the override case-insensitively (mixed-case address)", async () => {
    const meta = await getCollectionMetadata(TENK.toUpperCase(), CHAIN);
    expect(meta.source).toBe("official");
    expect(meta.image).toBe("/collections/10Ksquad.png");
  });

  it("Erebus logo is a static image, never an .mp4", async () => {
    const meta = await getCollectionMetadata(EREBUS, CHAIN);
    expect(meta.image).toBe("/collections/Erebus.png");
    expect(meta.image.endsWith(".mp4")).toBe(false);
    expect(meta.source).toBe("official");
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
