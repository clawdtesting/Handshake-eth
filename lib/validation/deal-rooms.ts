import { z } from "zod";
import {
  addressSchema,
  hexSchema,
  uint256Schema,
} from "@/lib/validation/offers";

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export const revisionNftSchema = z.object({
  contractAddress: addressSchema,
  tokenId: uint256Schema,
  collectionName: z.string().max(256).nullable().optional(),
  name: z.string().max(256).nullable().optional(),
  imageUrl: z.string().url().max(2048).nullable().optional(),
  rarityRank: z.number().int().positive().nullable().optional(),
});

/** Non-executable draft terms. Mirrors createOfferSchema's economic rules. */
export const draftSchema = z
  .object({
    makerAddress: addressSchema,
    takerAddress: addressSchema,
    makerNFTs: z.array(revisionNftSchema).max(20),
    takerNFTs: z.array(revisionNftSchema).max(20),
    makerEthAmount: uint256Schema,
    takerEthAmount: uint256Schema,
    feeBps: z.number().int().min(0).max(500),
    flatFee: uint256Schema,
    offerExpiry: z.number().int().positive(),
  })
  .refine((d) => d.makerAddress.toLowerCase() !== d.takerAddress.toLowerCase(), {
    message: "Maker and taker must differ",
  })
  .refine(
    (d) => d.makerNFTs.length > 0 || safeBigInt(d.makerEthAmount) > 0n,
    "Maker side must offer something"
  )
  .refine(
    (d) => d.takerNFTs.length > 0 || safeBigInt(d.takerEthAmount) > 0n,
    "Taker side must request something"
  )
  .refine((d) => d.offerExpiry > Math.floor(Date.now() / 1000), {
    message: "Offer expiry must be in the future",
  })
  .refine(
    (d) => {
      const dupes = (nfts: { contractAddress: string; tokenId: string }[]) => {
        const keys = nfts.map(
          (n) => `${n.contractAddress.toLowerCase()}:${BigInt(n.tokenId)}`
        );
        return new Set(keys).size !== keys.length;
      };
      return !dupes(d.makerNFTs) && !dupes(d.takerNFTs);
    },
    { message: "Duplicate NFT on one side" }
  );

export type DraftInput = z.infer<typeof draftSchema>;

const noteSchema = z.string().max(240).nullable().optional();

export const createSessionSchema = z.object({
  walletAddress: addressSchema,
  timestamp: z.number().int().positive(),
  signature: hexSchema.min(10),
});

export const createRoomSchema = z.object({
  chainId: z.number().int().positive(),
  counterparty: addressSchema,
  sourceOfferId: z.string().uuid().nullable().optional(),
  sourceWantedPostId: z.string().uuid().nullable().optional(),
  /** Room lifetime in minutes (15 min – 30 days). */
  expiresInMinutes: z
    .number()
    .int()
    .min(15)
    .max(30 * 24 * 60)
    .default(7 * 24 * 60),
  draft: draftSchema,
  note: noteSchema,
});

export const proposeRevisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  draft: draftSchema,
  note: noteSchema,
});

export const agreeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  revisionId: z.string().uuid(),
});

export const declineSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.enum(["price", "items", "not_trading", "other"]),
});

export const cancelRoomSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

/** Final order: full TradeOrder fields + maker's EIP-712 signature. */
export const finalizeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  order: z.object({
    maker: addressSchema,
    taker: addressSchema,
    makerNFTs: z
      .array(
        z.object({ contractAddress: addressSchema, tokenId: uint256Schema })
      )
      .max(20),
    takerNFTs: z
      .array(
        z.object({ contractAddress: addressSchema, tokenId: uint256Schema })
      )
      .max(20),
    makerEthAmount: uint256Schema,
    takerEthAmount: uint256Schema,
    feeBps: uint256Schema,
    flatFee: uint256Schema,
    nonce: uint256Schema,
    expiry: uint256Schema,
  }),
  signature: hexSchema.min(132),
});
