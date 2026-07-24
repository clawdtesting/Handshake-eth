import { formatEth } from "@/lib/utils";
import type { DealRoomDraft, RevisionNFT } from "@/lib/types";

/**
 * Term-by-term diff between two drafts, rendered as compact "delta chips"
 * on the revision timeline: "+ Molandak #4412", "− 20 ETH", "expiry 3d → 24h".
 */

export type DiffChipKind = "nft-added" | "nft-removed" | "eth" | "expiry";

export interface DiffChip {
  kind: DiffChipKind;
  side: "maker" | "taker";
  label: string;
  /** For nft chips: the NFT in question (display metadata included). */
  nft?: RevisionNFT;
}

function nftKey(n: { contractAddress: string; tokenId: string }): string {
  return `${n.contractAddress.toLowerCase()}:${BigInt(n.tokenId).toString()}`;
}

function nftLabel(n: RevisionNFT): string {
  if (n.name) return n.name;
  const short = `${n.contractAddress.slice(0, 6)}…${n.contractAddress.slice(-4)}`;
  return `${n.collectionName ?? short} #${n.tokenId}`;
}

function diffNFTs(
  side: "maker" | "taker",
  before: RevisionNFT[],
  after: RevisionNFT[]
): DiffChip[] {
  const beforeMap = new Map(before.map((n) => [nftKey(n), n]));
  const afterMap = new Map(after.map((n) => [nftKey(n), n]));
  const chips: DiffChip[] = [];
  for (const [key, nft] of afterMap) {
    if (!beforeMap.has(key)) {
      chips.push({ kind: "nft-added", side, label: `+ ${nftLabel(nft)}`, nft });
    }
  }
  for (const [key, nft] of beforeMap) {
    if (!afterMap.has(key)) {
      chips.push({ kind: "nft-removed", side, label: `− ${nftLabel(nft)}`, nft });
    }
  }
  return chips;
}

function diffMon(
  side: "maker" | "taker",
  beforeWei: string,
  afterWei: string
): DiffChip[] {
  const before = BigInt(beforeWei);
  const after = BigInt(afterWei);
  if (before === after) return [];
  const delta = after - before;
  const sign = delta > 0n ? "+" : "−";
  const abs = delta > 0n ? delta : -delta;
  return [
    {
      kind: "eth",
      side,
      label: `${sign} ${formatEth(abs.toString())} ETH (${formatEth(beforeWei)} → ${formatEth(afterWei)})`,
    },
  ];
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86_400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(seconds / 3_600);
  if (h >= 1) return `${h}h`;
  const m = Math.max(1, Math.floor(seconds / 60));
  return `${m}m`;
}

/**
 * Diff `after` against `before`. `before === null` (first revision) yields no
 * chips — the full terms card already shows everything.
 */
export function diffDrafts(
  before: DealRoomDraft | null,
  after: DealRoomDraft
): DiffChip[] {
  if (!before) return [];
  const now = Math.floor(Date.now() / 1000);
  const chips: DiffChip[] = [
    ...diffNFTs("maker", before.makerNFTs, after.makerNFTs),
    ...diffNFTs("taker", before.takerNFTs, after.takerNFTs),
    ...diffMon("maker", before.makerEthAmount, after.makerEthAmount),
    ...diffMon("taker", before.takerEthAmount, after.takerEthAmount),
  ];
  if (before.offerExpiry !== after.offerExpiry) {
    chips.push({
      kind: "expiry",
      side: "maker",
      label: `expiry ${formatDuration(before.offerExpiry - now)} → ${formatDuration(after.offerExpiry - now)}`,
    });
  }
  return chips;
}
