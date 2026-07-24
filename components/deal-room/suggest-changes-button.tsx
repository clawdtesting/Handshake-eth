"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoomMutations, useRoomSession } from "@/hooks/use-deal-rooms";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import { isCollectionBid } from "@/lib/collection-bids";
import type { DealRoomDraft, TradeOffer } from "@/lib/types";

/**
 * "Suggest changes" on an offer page: opens (or joins) the Deal Room for this
 * offer and counterparty pair, seeded with the offer's exact terms as the
 * first draft. The signed offer stays live until it's retired or replaced —
 * the room says so prominently.
 */
export function SuggestChangesButton({
  offer,
  viewer,
}: {
  offer: TradeOffer;
  viewer: string;
}) {
  const router = useRouter();
  const { createRoom } = useRoomMutations(null);
  const { ensureSession } = useRoomSession();
  const [working, setWorking] = useState(false);

  // Collection-wide bids have no exact tokens to draft around; the existing
  // "propose private deal" flow covers them.
  if (offer.nfts.some((n) => isCollectionBid(n))) return null;

  const maker = offer.makerAddress.toLowerCase();
  const me = viewer.toLowerCase();
  const counterparty =
    me === maker ? (offer.takerAddress?.toLowerCase() ?? null) : maker;
  // Maker of an open public offer has nobody to negotiate with yet.
  if (!counterparty || counterparty === me) return null;
  const cp: string = counterparty;

  async function handleClick() {
    setWorking(true);
    try {
      await ensureSession();
      const now = Math.floor(Date.now() / 1000);
      const draft: DealRoomDraft = {
        makerAddress: offer.makerAddress,
        // Public offer: the viewer becomes the draft's designated taker.
        takerAddress: offer.takerAddress ?? (me === maker ? cp : me),
        makerNFTs: offer.nfts
          .filter((n) => n.side === "maker")
          .map((n) => ({
            contractAddress: n.contractAddress,
            tokenId: n.tokenId,
            collectionName: n.collectionName,
            name: n.name,
            imageUrl: n.imageUrl,
            rarityRank: n.rarityRank ?? null,
          })),
        takerNFTs: offer.nfts
          .filter((n) => n.side === "taker")
          .map((n) => ({
            contractAddress: n.contractAddress,
            tokenId: n.tokenId,
            collectionName: n.collectionName,
            name: n.name,
            imageUrl: n.imageUrl,
            rarityRank: n.rarityRank ?? null,
          })),
        makerEthAmount: offer.makerEthAmount,
        takerEthAmount: offer.takerEthAmount,
        feeBps: offer.feeBps,
        flatFee: offer.flatFee,
        offerExpiry: offer.expiry > now ? offer.expiry : now + 86_400,
      };

      const res = await createRoom.mutateAsync({
        chainId: ETH_MAINNET_CHAIN_ID,
        counterparty: cp,
        sourceOfferId: offer.id,
        draft,
      });
      if (res.existing) {
        toast.info("Rejoining the existing negotiation for this deal");
      }
      router.push(`/rooms/${res.room.id}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to open the Deal Room");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={working}
      onClick={handleClick}
    >
      {working ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Opening room…
        </>
      ) : (
        <>
          <MessagesSquare className="h-4 w-4" />
          Suggest changes — haggle live
        </>
      )}
    </Button>
  );
}
