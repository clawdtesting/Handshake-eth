"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Handshake, Loader2 } from "lucide-react";
import { isAddress, parseEther } from "viem";
import { FEATURED_COLLECTIONS } from "@/lib/featured-collections";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { TermsEditor } from "@/components/deal-room/terms-editor";
import { useRoomMutations, useRoomSession } from "@/hooks/use-deal-rooms";
import { ETH_MAINNET_CHAIN_ID } from "@/lib/chains/ethereum";
import { shortAddress } from "@/lib/utils";
import type { DealRoomRevision } from "@/lib/types";

/**
 * /rooms/new — start a negotiation from scratch: with a wanted-board poster
 * (?counterparty=0x…&wanted=<postId>) or any wallet you paste. The composer
 * is the same TermsEditor used inside rooms, seeded with an empty draft.
 */
function NewRoomInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { address, isConnected } = useAccount();
  const { ensureSession } = useRoomSession();
  const { createRoom } = useRoomMutations(null);

  const wantedPostId = search.get("wanted");
  const [counterparty, setCounterparty] = useState(
    search.get("counterparty") ?? ""
  );
  const [confirmed, setConfirmed] = useState(isAddress(counterparty));

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: async () => (await fetch("/api/config")).json(),
  });

  // When haggling from a wanted post, seed the opening draft from it: the
  // poster's offered ETH on their side, and the requested collection
  // pre-selected on yours — so a ETH-for-NFT counter is a one-field edit.
  const { data: wantedPost } = useQuery({
    queryKey: ["wanted-post", wantedPostId],
    enabled: !!wantedPostId,
    queryFn: async () => {
      const res = await fetch("/api/wanted");
      if (!res.ok) return null;
      const posts = ((await res.json()).posts ?? []) as {
        id: string;
        lookingFor: string;
        offering: string | null;
      }[];
      return posts.find((p) => p.id === wantedPostId) ?? null;
    },
  });

  const seed = useMemo(() => {
    if (!wantedPost) {
      return { makerCollection: null as string | null, takerEthAmount: "0" };
    }
    const lookingFor = wantedPost.lookingFor.toLowerCase();
    const matched = FEATURED_COLLECTIONS.find((c) =>
      lookingFor.includes(c.name.toLowerCase()),
    );
    let takerEthAmount = "0";
    const amount = wantedPost.offering?.match(/(\d+(?:\.\d+)?)/)?.[1];
    if (amount) {
      try {
        takerEthAmount = parseEther(amount).toString();
      } catch {
        // free-text offering without a clean number — leave it blank
      }
    }
    return { makerCollection: matched?.address ?? null, takerEthAmount };
  }, [wantedPost]);

  if (!isConnected || !address) {
    return (
      <EmptyState
        title="Connect your wallet"
        body="You need a connected wallet to start a negotiation."
      />
    );
  }

  const me = address.toLowerCase();

  if (!confirmed) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <label className="block text-sm font-medium">
            Who do you want to trade with?
          </label>
          <Input
            placeholder="0x… wallet address"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value.trim())}
          />
          <Button
            disabled={
              !isAddress(counterparty) ||
              counterparty.toLowerCase() === me
            }
            onClick={() => setConfirmed(true)}
          >
            Continue
          </Button>
          {counterparty && counterparty.toLowerCase() === me && (
            <p className="text-xs text-amber-400">
              That&apos;s your own wallet.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const cp = counterparty.toLowerCase();

  // Wait for the wanted post so the editor mounts with the seeded terms
  // already in place (it reads `base` only on first render).
  if (wantedPostId && wantedPost === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Seed draft: viewer is the maker, counterparty the taker. From a wanted
  // post the taker's offered ETH and the requested collection are pre-filled;
  // otherwise both sides start blank.
  const base: DealRoomRevision = {
    id: "new",
    roomId: "new",
    revisionNumber: 0,
    proposedBy: me,
    makerAddress: me,
    takerAddress: cp,
    makerNFTs: [],
    takerNFTs: [],
    makerEthAmount: "0",
    takerEthAmount: seed.takerEthAmount,
    feeBps: config?.feeBps ?? 100,
    flatFee: "0",
    offerExpiry: Math.floor(Date.now() / 1000) + 86_400,
    termsHash: "",
    note: null,
    createdAt: new Date().toISOString(),
    acceptedBy: [],
  };

  return (
    <TermsEditor
      base={base}
      viewerWallet={me}
      submitting={createRoom.isPending}
      initialMakerCollection={seed.makerCollection}
      onClose={() => router.back()}
      onSubmit={async (draft, note) => {
        try {
          await ensureSession();
          const res = await createRoom.mutateAsync({
            chainId: ETH_MAINNET_CHAIN_ID,
            counterparty: cp,
            sourceWantedPostId: wantedPostId,
            draft,
            note,
          });
          toast.success(`Deal Room opened with ${shortAddress(cp)}`);
          router.push(`/rooms/${res.room.id}`);
        } catch (err: any) {
          toast.error(err?.message ?? "Failed to open the room");
        }
      }}
    />
  );
}

export default function NewRoomPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <Handshake className="h-5 w-5 text-ethereum-purple" />
        Start a negotiation
      </h1>
      <p className="text-sm text-muted-foreground">
        Draft the opening terms — free, signature-less, and nothing can move
        until you both agree and sign at the end.
      </p>
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <NewRoomInner />
      </Suspense>
    </div>
  );
}
