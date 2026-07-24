import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function ok(json: unknown) {
  return {
    ok: true,
    json: async () => json,
  } as unknown as Response;
}

function notOk(status = 404, body = "not found") {
  return {
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  process.env.OPENSEA_API_KEY = "test-key";
  process.env.OPENSEA_CHAIN = "ethereum";
  delete process.env.OPENSEA_BASE_URL;
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENSEA_API_KEY;
  delete process.env.OPENSEA_CHAIN;
  delete process.env.OPENSEA_BASE_URL;
});

describe("openseaProvider", () => {
  it("uses the Ethereum chain slug for token lookups", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      ok({
        nft: {
          contract: "0x818030837e8350ba63e64d7dc01a547fa73c8279",
          identifier: "10000",
          display_image_url: "https://i.seadn.io/10k.png",
          rarity: { rank: 123 },
        },
      }),
    );

    const { openseaProvider } = await import("@/lib/nft/providers/opensea");
    const token = await openseaProvider.getToken(
      "0x818030837e8350ba63e64d7dc01a547fa73c8279",
      "10000",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opensea.io/api/v2/chain/ethereum/contract/0x818030837e8350ba63e64d7dc01a547fa73c8279/nfts/10000",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      }),
    );
    expect(token?.imageUrl).toBe("https://i.seadn.io/10k.png");
    expect(token?.rarityRank).toBe(123);
  });

  it("falls back to OpenSea's metadata endpoint when the NFT endpoint has no media", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        ok({
          nft: {
            contract: "0x818030837e8350ba63e64d7dc01a547fa73c8279",
            identifier: "10000",
            rarity: { rank: 321 },
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          image: "https://metadata.seadn.io/10k.png",
          name: "10kSquad #10000",
        }),
      );

    const { openseaProvider } = await import("@/lib/nft/providers/opensea");
    const token = await openseaProvider.getToken(
      "0x818030837e8350ba63e64d7dc01a547fa73c8279",
      "10000",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.opensea.io/api/v2/metadata/ethereum/0x818030837e8350ba63e64d7dc01a547fa73c8279/10000",
      expect.any(Object),
    );
    expect(token?.imageUrl).toBe("https://metadata.seadn.io/10k.png");
    expect(token?.rarityRank).toBe(321);
    expect(token?.name).toBe("10kSquad #10000");
  });

  it("tries metadata directly if the NFT endpoint misses a token OpenSea can still validate", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(notOk())
      .mockResolvedValueOnce(
        ok({ image_url: "https://metadata.seadn.io/10k.png" }),
      );

    const { openseaProvider } = await import("@/lib/nft/providers/opensea");
    const token = await openseaProvider.getToken(
      "0x818030837e8350ba63e64d7dc01a547fa73c8279",
      "10000",
    );

    expect(token?.imageUrl).toBe("https://metadata.seadn.io/10k.png");
  });
});
