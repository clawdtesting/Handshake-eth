"use client";

import { formatDistanceToNow } from "date-fns";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { diffDrafts } from "@/lib/deal-rooms/diff";
import { cn, shortAddress } from "@/lib/utils";
import type { DealRoomRevision } from "@/lib/types";

/**
 * The haggle, newest round first. Each round shows who proposed it, delta
 * chips vs the previous round ("+ Molandak #4412", "− 20 ETH"), the signed
 * note, and its acceptance state.
 */
export function RevisionTimeline({
  revisions,
  currentRevisionId,
  viewerWallet,
  participants,
}: {
  /** Sorted newest-first (as served by the API). */
  revisions: DealRoomRevision[];
  currentRevisionId: string | null;
  viewerWallet: string;
  participants: [string, string];
}) {
  if (revisions.length === 0) return null;
  const viewer = viewerWallet.toLowerCase();

  return (
    <ol className="space-y-3" aria-label="Negotiation rounds">
      {revisions.map((rev, idx) => {
        const prev = revisions[idx + 1] ?? null; // next in array = previous round
        const chips = diffDrafts(prev, rev);
        const isCurrent = rev.id === currentRevisionId;
        const mine = rev.proposedBy.toLowerCase() === viewer;
        const bothAccepted =
          participants.every((p) =>
            rev.acceptedBy.map((a) => a.toLowerCase()).includes(p.toLowerCase())
          );

        return (
          <li
            key={rev.id}
            className={cn(
              "rounded-lg border p-3",
              isCurrent
                ? "border-ethereum-purple/40 bg-ethereum-purple/5"
                : "border-border bg-card/50 opacity-70"
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">Round {rev.revisionNumber}</span>
              <span className="text-muted-foreground">
                by {mine ? "you" : shortAddress(rev.proposedBy)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(rev.createdAt), { addSuffix: true })}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {isCurrent ? (
                  bothAccepted ? (
                    <Badge variant="success">Agreed by both</Badge>
                  ) : (
                    <Badge>Live</Badge>
                  )
                ) : (
                  <Badge variant="secondary">Superseded</Badge>
                )}
              </span>
            </div>

            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((chip, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs",
                      chip.kind === "nft-added" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                      chip.kind === "nft-removed" &&
                        "border-red-500/30 bg-red-500/10 text-red-400",
                      chip.kind === "eth" &&
                        "border-ethereum-purple/30 bg-ethereum-purple/10 text-ethereum-purple",
                      chip.kind === "expiry" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    )}
                  >
                    {chip.side === "maker" ? "" : ""}
                    {chip.label}
                  </span>
                ))}
              </div>
            )}

            {rev.note && (
              <p className="mt-2 text-sm italic text-muted-foreground">
                “{rev.note}”
              </p>
            )}

            {isCurrent && rev.acceptedBy.length > 0 && !bothAccepted && (
              <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Agreed by{" "}
                {rev.acceptedBy
                  .map((a) =>
                    a.toLowerCase() === viewer ? "you" : shortAddress(a)
                  )
                  .join(", ")}{" "}
                — waiting on the other side
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
