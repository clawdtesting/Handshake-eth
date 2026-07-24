import { z } from "zod";

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address");

export const hexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/, "Invalid hex");

export const uint256Schema = z
  .string()
  .regex(/^\d+$/, "Must be a decimal integer string")
  .refine((v) => {
    try {
      return BigInt(v) < 2n ** 256n;
    } catch {
      return false;
    }
  }, "Exceeds uint256");

export const nftItemSchema = z.object({
  contractAddress: addressSchema,
  tokenId: uint256Schema,
  tokenStandard: z.literal("ERC721").default("ERC721"),
  name: z.string().max(256).nullable().optional(),
  collectionName: z.string().max(256).nullable().optional(),
  imageUrl: z.string().url().max(2048).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  rarityRank: z.number().int().positive().nullable().optional(),
});

export const createOfferSchema = z
  .object({
    chainId: z.number().int().positive(),
    makerAddress: addressSchema,
    takerAddress: addressSchema.nullable().optional(),
    makerNFTs: z.array(nftItemSchema).max(20),
    takerNFTs: z.array(nftItemSchema).max(20),
    makerEthAmount: uint256Schema,
    takerEthAmount: uint256Schema,
    feeBps: z.number().int().min(0).max(500),
    flatFee: uint256Schema,
    nonce: uint256Schema,
    expiry: z.number().int().positive(),
    signature: hexSchema.min(132).max(132),
    isPrivate: z.boolean().default(false),
    requiredMaxRarityRank: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (o) => o.makerNFTs.length > 0 || safeBigInt(o.makerEthAmount) > 0n,
    "Maker side must offer something"
  )
  .refine(
    (o) => o.takerNFTs.length > 0 || safeBigInt(o.takerEthAmount) > 0n,
    "Taker side must request something"
  )
  .refine((o) => !o.isPrivate || !!o.takerAddress, {
    message: "Private offers require a taker address",
  })
  .refine((o) => o.expiry > Math.floor(Date.now() / 1000), {
    message: "Expiry must be in the future",
  });

export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const completeOfferSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid tx hash"),
  takerAddress: addressSchema,
});

export const cancelOfferSchema = z.object({
  // Required: the cancel route verifies this tx emits TradeCancelled for the
  // offer's maker+nonce, so a fill (which also consumes the nonce) cannot be
  // passed off as a cancellation.
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid tx hash"),
  walletAddress: addressSchema,
});

export const listOffersQuerySchema = z.object({
  status: z.enum(["open", "completed", "cancelled", "expired"]).optional(),
  maker: addressSchema.optional(),
  taker: addressSchema.optional(),
  wallet: addressSchema.optional(),
  collection: addressSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
