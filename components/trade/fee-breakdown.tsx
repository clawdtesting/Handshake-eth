"use client";

import { quoteFees } from "@/lib/fees";
import { formatEth } from "@/lib/utils";

export function FeeBreakdown({
  makerEthAmount,
  takerEthAmount,
  feeBps = 100n,
  flatSwapFee = 0n,
}: {
  makerEthAmount: bigint;
  takerEthAmount: bigint;
  feeBps?: bigint;
  flatSwapFee?: bigint;
}) {
  const quote = quoteFees(makerEthAmount, takerEthAmount, feeBps, flatSwapFee);
  const feePct = Number(feeBps) / 100;

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-4 text-sm">
      <p className="mb-2 font-medium">Fee breakdown</p>
      <Row label="Maker sends" value={`${formatEth(makerEthAmount)} ETH`} />
      <Row label="Taker sends" value={`${formatEth(takerEthAmount)} ETH`} />
      <Row
        label={`Protocol fee (${feePct}% of ETH legs)`}
        value={`${formatEth(quote.makerLegFee + quote.takerLegFee)} ETH`}
      />
      {quote.flatFee > 0n && (
        <Row label="Flat swap fee" value={`${formatEth(quote.flatFee)} ETH`} />
      )}
      <div className="my-2 border-t border-border" />
      <Row label="Taker pays total" value={`${formatEth(quote.takerPays)} ETH`} bold />
      {makerEthAmount > 0n && (
        <Row
          label="Maker escrow required"
          value={`${formatEth(quote.makerEscrowRequired)} ETH`}
          bold
        />
      )}
      {quote.totalFee === 0n && (
        <p className="pt-1 text-xs text-emerald-400">
          NFT-for-NFT swap — no protocol fee.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold" : undefined}>{value}</span>
    </div>
  );
}
