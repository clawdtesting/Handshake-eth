"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import {
  Check,
  Handshake,
  Link as LinkIcon,
  Loader2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { RoomStatusBadge } from "@/components/deal-room/status-badge";
import { TermsCard } from "@/components/deal-room/terms-card";
import { RevisionTimeline } from "@/components/deal-room/revision-timeline";
import { TermsEditor } from "@/components/deal-room/terms-editor";
import { ReadinessPanel } from "@/components/deal-room/readiness-panel";
import { FinalizePanel } from "@/components/deal-room/finalize-panel";
import {
  useDealRoom,
  useRoomLive,
  useRoomMutations,
  useRoomReadiness,
  useRoomSession,
} from "@/hooks/use-deal-rooms";
import { useOffer } from "@/hooks/use-market";
import { useReputation } from "@/hooks/use-market";
import { isActive } from "@/lib/deal-rooms/state-machine";
import { shortAddress, timeUntil } from "@/lib/utils";
import type { DeclineReason } from "@/lib/types";

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "price", label: "Price too far apart" },
  { value: "items", label: "Not the right items" },
  { value: "not_trading", label: "Not trading right now" },
  { value: "other", label: "Other" },
];

export default function DealRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isConnected } = useAccount();
  const { wallet, hasSession, ensureSession } = useRoomSession();
  const { data: room, isLoading, error } = useDealRoom(hasSession ? id : null);
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const counterparty =
    room && wallet
      ? room.participantA === wallet
        ? room.participantB
        : room.participantA
      : null;

  const live = useRoomLive(room, counterparty);
  const { propose, agree, decline, cancel } = useRoomMutations(id);
  const needsReadiness =
    !!room && (room.status === "agreed" || room.status === "signed");
  const { data: readiness, isLoading: readinessLoading } = useRoomReadiness(
    id,
    needsReadiness
  );
  const { data: sourceOffer } = useOffer(room?.sourceOfferId ?? null);
  const { data: counterpartyRep } = useReputation(counterparty ?? undefined);

  // ---- gates ----------------------------------------------------------

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="Connect your wallet"
          body="Deal Rooms are private — connect the wallet that was invited to this negotiation."
        />
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <Handshake className="h-10 w-10 text-ethereum-purple" />
            <div>
              <h1 className="text-lg font-semibold">Sign in to Deal Rooms</h1>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                One free signature proves this is your wallet. It cannot
                approve, transfer, or trade anything — the message says so
                explicitly.
              </p>
            </div>
            <Button
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for
                  wallet…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !room || !wallet) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="This negotiation is private"
          body="Either this room doesn't exist or your wallet isn't part of it."
        />
      </div>
    );
  }

  const revision = room.currentRevision;
  const iAccepted =
    !!revision &&
    revision.acceptedBy.map((a) => a.toLowerCase()).includes(wallet);
  const active = isActive(room.status);
  const canAct = room.status === "open";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Room link copied — only the two participants can open it");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Handshake className="h-5 w-5 text-ethereum-purple" />
          Deal Room
        </h1>
        <RoomStatusBadge status={room.status} />
        {active && (
          <span className="text-xs text-muted-foreground">
            room expires {timeUntil(Math.floor(new Date(room.expiresAt).getTime() / 1000))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant={live.counterpartyHere ? "success" : "secondary"}
            className="gap-1"
          >
            <Users className="h-3 w-3" />
            {live.counterpartyHere
              ? `${shortAddress(counterparty)} is here`
              : `${shortAddress(counterparty)} · ${
                  counterpartyRep
                    ? `${counterpartyRep.completedTradesCount} trades`
                    : "…"
                }`}
          </Badge>
          <Button variant="ghost" size="icon" onClick={copyInvite} title="Copy room link">
            <LinkIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {room.sourceOfferId && (
        <p className="text-xs text-muted-foreground">
          Negotiating changes to{" "}
          <Link
            href={`/offers/${room.sourceOfferId}`}
            className="text-ethereum-purple underline-offset-4 hover:underline"
          >
            an existing signed offer
          </Link>
          {sourceOffer?.status === "open" &&
            " — it stays executable until it's retired or replaced."}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="space-y-4">
          {revision && (
            <TermsCard revision={revision} viewerWallet={wallet} />
          )}

          {/* Action bar */}
          {canAct && revision && !editing && (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 py-4">
                <Button
                  disabled={iAccepted || agree.isPending}
                  onClick={async () => {
                    try {
                      const res = await agree.mutateAsync({
                        expectedVersion: room.version,
                        revisionId: revision.id,
                      });
                      toast.success(
                        res.bothAgreed
                          ? "Both sides agreed 🤝 — time to make it official"
                          : "Agreed — waiting on the other side"
                      );
                    } catch (err: any) {
                      toast.error(err?.message ?? "Failed to agree");
                    }
                  }}
                >
                  <Check className="h-4 w-4" />
                  {iAccepted
                    ? "You agreed — waiting"
                    : agree.isPending
                      ? "Agreeing…"
                      : "Agree to these terms"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Counter
                </Button>
                <Button
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  onClick={() => setDeclining(true)}
                >
                  Decline
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Decline dialog (inline) */}
          {declining && (
            <Card className="border-red-500/40">
              <CardContent className="space-y-3 py-4">
                <p className="text-sm font-medium">Pass on this negotiation?</p>
                <div className="flex flex-wrap gap-2">
                  {DECLINE_REASONS.map((r) => (
                    <Button
                      key={r.value}
                      size="sm"
                      variant="outline"
                      disabled={decline.isPending}
                      onClick={async () => {
                        try {
                          await decline.mutateAsync({
                            expectedVersion: room.version,
                            reason: r.value,
                          });
                          toast.success("Negotiation declined");
                          setDeclining(false);
                        } catch (err: any) {
                          toast.error(err?.message ?? "Failed to decline");
                        }
                      }}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeclining(false)}
                >
                  Keep negotiating
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Counter composer */}
          {editing && revision && (
            <TermsEditor
              base={revision}
              viewerWallet={wallet}
              submitting={propose.isPending}
              onClose={() => setEditing(false)}
              onSubmit={async (draft, note) => {
                try {
                  await propose.mutateAsync({
                    expectedVersion: room.version,
                    draft,
                    note,
                  });
                  toast.success("Counter proposed");
                  setEditing(false);
                } catch (err: any) {
                  toast.error(err?.message ?? "Failed to propose");
                }
              }}
            />
          )}

          {/* Finalize / settle / settled */}
          <FinalizePanel
            room={room}
            sourceOffer={sourceOffer ?? null}
            readiness={readiness}
            viewerWallet={wallet}
          />

          {/* History */}
          <RevisionTimeline
            revisions={room.revisions}
            currentRevisionId={room.currentRevisionId}
            viewerWallet={wallet}
            participants={[room.participantA, room.participantB]}
          />
        </div>

        {/* Side column */}
        <div className="space-y-4">
          {needsReadiness && (
            <ReadinessPanel readiness={readiness} loading={readinessLoading} />
          )}
          {active && room.status === "open" && (
            <Card>
              <CardContent className="space-y-2 py-4 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">How this works</p>
                <p>1. Counter freely — drafts are signature-free and can never move assets.</p>
                <p>2. When you both agree, the maker signs one final order.</p>
                <p>3. One atomic transaction settles it. Sub-second on Ethereum.</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  disabled={cancel.isPending}
                  onClick={async () => {
                    try {
                      await cancel.mutateAsync({ expectedVersion: room.version });
                      toast.success("Room closed");
                    } catch (err: any) {
                      toast.error(err?.message ?? "Failed to close");
                    }
                  }}
                >
                  Close this room
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
