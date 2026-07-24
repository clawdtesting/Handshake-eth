"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Handshake, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { RoomStatusBadge } from "@/components/deal-room/status-badge";
import {
  useMyRooms,
  useRoomSession,
  type RoomListEntry,
} from "@/hooks/use-deal-rooms";
import { formatEth, shortAddress } from "@/lib/utils";
import { isActive } from "@/lib/deal-rooms/state-machine";

/**
 * Dashboard "Deal Rooms" section: your negotiations, your-move first.
 */

function yourMove(room: RoomListEntry, me: string): boolean {
  const rev = room.currentRevision;
  if (!rev) return false;
  const maker = rev.makerAddress.toLowerCase();
  const acceptedByMe = rev.acceptedBy
    .map((a) => a.toLowerCase())
    .includes(me);
  if (room.status === "open") return !acceptedByMe;
  if (room.status === "agreed") return maker === me;
  if (room.status === "signed") return maker !== me;
  return false;
}

function summarize(room: RoomListEntry): string {
  const rev = room.currentRevision;
  if (!rev) return "No draft yet";
  const parts: string[] = [];
  if (rev.makerNFTs.length > 0)
    parts.push(`${rev.makerNFTs.length} NFT${rev.makerNFTs.length > 1 ? "s" : ""}`);
  if (BigInt(rev.makerEthAmount) > 0n)
    parts.push(`${formatEth(rev.makerEthAmount)} ETH`);
  const left = parts.join(" + ") || "nothing";
  const rightParts: string[] = [];
  if (rev.takerNFTs.length > 0)
    rightParts.push(
      `${rev.takerNFTs.length} NFT${rev.takerNFTs.length > 1 ? "s" : ""}`
    );
  if (BigInt(rev.takerEthAmount) > 0n)
    rightParts.push(`${formatEth(rev.takerEthAmount)} ETH`);
  const right = rightParts.join(" + ") || "nothing";
  return `${left} ⇄ ${right}`;
}

export function RoomsSection({ wallet }: { wallet: string }) {
  const me = wallet.toLowerCase();
  const { hasSession, ensureSession } = useRoomSession();
  const { data: rooms, isLoading } = useMyRooms();
  const [signingIn, setSigningIn] = useState(false);

  if (!hasSession) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <Handshake className="h-8 w-8 text-ethereum-purple" />
          <p className="text-sm text-muted-foreground">
            Sign in once to see your private negotiations. The signature only
            proves wallet ownership — it can&apos;t move assets.
          </p>
          <Button
            size="sm"
            disabled={signingIn}
            onClick={async () => {
              setSigningIn(true);
              try {
                await ensureSession();
              } catch (err: any) {
                toast.error(err?.message ?? "Sign-in failed");
              } finally {
                setSigningIn(false);
              }
            }}
          >
            {signingIn ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting…
              </>
            ) : (
              "Sign in to Deal Rooms"
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!rooms?.length) {
    return (
      <EmptyState
        title="No negotiations yet"
        body="Open a Deal Room from any offer (“Suggest changes”) or from the Wanted board (“Haggle live”)."
      />
    );
  }

  const sorted = [...rooms].sort((a, b) => {
    const am = yourMove(a, me) && isActive(a.status) ? 1 : 0;
    const bm = yourMove(b, me) && isActive(b.status) ? 1 : 0;
    return bm - am;
  });

  return (
    <div className="space-y-2">
      {sorted.map((room) => {
        const counterparty =
          room.participantA === me ? room.participantB : room.participantA;
        const mine = yourMove(room, me) && isActive(room.status);
        return (
          <Link
            key={room.id}
            href={`/rooms/${room.id}`}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 p-3 transition hover:border-ethereum-purple/40"
          >
            <Handshake className="h-4 w-4 shrink-0 text-ethereum-purple" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {shortAddress(counterparty)}
                </span>
                <RoomStatusBadge status={room.status} />
                {mine && <Badge>Your move</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {summarize(room)}
                {room.currentRevision
                  ? ` · round ${room.currentRevision.revisionNumber}`
                  : ""}
                {" · "}
                {formatDistanceToNow(new Date(room.lastActivityAt), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
