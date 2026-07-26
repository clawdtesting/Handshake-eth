import { cn } from "@/lib/utils";
import type { CollectionTradeStatus } from "@/lib/featured-collections";

const CONFIG: Record<
  CollectionTradeStatus,
  { color: string; label: string }
> = {
  open: {
    color: "bg-emerald-500",
    label: "Tradeable on Handshake — both the transfer-validator approval and the Handshake allowlist are in place.",
  },
  pending: {
    color: "bg-amber-400",
    label:
      "Almost ready — one of the two approvals (transfer-validator or Handshake allowlist) is still missing.",
  },
  locked: {
    color: "bg-red-500",
    label:
      "Trading locked — neither the transfer-validator approval nor the Handshake allowlist is in place yet.",
  },
};

/**
 * Builds a tooltip that names exactly which approval(s) are missing, given the
 * two independent conditions. Falls back to the generic per-status label when
 * the breakdown isn't supplied (e.g. the static legend swatches).
 */
function detailedLabel(
  status: CollectionTradeStatus,
  validatorOk: boolean,
  handshakeOk: boolean,
  validatorGated: boolean,
): string {
  const validatorPart = !validatorGated
    ? "transfer-validator: not required for this collection"
    : validatorOk
      ? "transfer-validator: authorized"
      : "transfer-validator: not authorized";
  const handshakePart = handshakeOk
    ? "Handshake allowlist: listed"
    : "Handshake allowlist: not yet listed";

  if (status === "open") {
    return `Tradeable on Handshake — ${validatorPart}; ${handshakePart}.`;
  }
  if (status === "locked") {
    return `Trading locked — both approvals missing (${validatorPart}; ${handshakePart}).`;
  }
  // pending: exactly one missing — name it.
  const missing = !handshakeOk
    ? "Handshake allowlist (collection not yet allowlisted on the settlement contract)"
    : "transfer-validator authorization (collection owner must approve the settlement contract)";
  return `One approval missing: ${missing}. [${validatorPart}; ${handshakePart}]`;
}

/**
 * Status indicator shown on a collection's logo.
 *  - green  → tradeable (both approvals in place)
 *  - yellow → one approval missing
 *  - red    → neither approval in place
 *
 * When `validatorOk`/`handshakeOk` are provided, the tooltip names the specific
 * missing approval; otherwise it uses the generic per-status text.
 */
export function CollectionStatusDot({
  status,
  validatorOk,
  handshakeOk,
  validatorGated,
  className,
}: {
  status: CollectionTradeStatus;
  validatorOk?: boolean;
  handshakeOk?: boolean;
  validatorGated?: boolean;
  className?: string;
}) {
  const { color } = CONFIG[status];
  const label =
    validatorOk !== undefined && handshakeOk !== undefined
      ? detailedLabel(status, validatorOk, handshakeOk, validatorGated ?? false)
      : CONFIG[status].label;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background",
        color,
        className,
      )}
    />
  );
}
