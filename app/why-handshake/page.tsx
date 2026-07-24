import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Eye, Handshake, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function WhyHandshakePage() {
  return (
    <div className="container mx-auto px-4 py-12">
      <section className="relative overflow-hidden rounded-[2rem] border border-ethereum-purple/20 bg-gradient-to-br from-ethereum-purple/15 via-fuchsia-500/10 to-cyan-400/10 px-5 py-14 shadow-2xl shadow-ethereum-purple/10 md:px-8">
        <div className="pointer-events-none absolute right-10 top-8 h-28 w-28 rounded-full bg-fuchsia-400/20 blur-2xl" />
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ethereum-purple">
          <Handshake className="h-3.5 w-3.5" /> About Handshake
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          Why Handshake Exists
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-foreground/85">
          Handshake helps collectors propose public or private NFT deals, accept
          terms in-wallet, execute the asset exchange on-chain, and finish with a
          completed handshake.
        </p>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <InfoCard
          icon={<Sparkles className="h-5 w-5" />}
          title="Why Handshake Exists"
          points={[
            "NFT negotiations mostly happen off-platform in Discord DMs, Telegram chats, and X messages.",
            "Bots and snipers dominate simple public listings while human NFT-for-NFT negotiation stays fragmented.",
            "Trust is fragile when collectors manually coordinate what each wallet should send.",
            "Most marketplaces are optimized for listings, not human deals between two collectors.",
          ]}
        />
        <InfoCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="How Handshake Works"
          points={[
            "Step 1: Propose a Deal with NFTs, ETH, or both.",
            "Step 2: Share it publicly on the Market or privately with a wallet.",
            "Step 3: Another collector reviews and accepts the deal.",
            "Step 4: Atomic settlement executes the trade in one transaction: everything swaps or nothing does.",
            "Step 5: The successful trade becomes a completed handshake.",
          ]}
        />
        <InfoCard
          icon={<Eye className="h-5 w-5" />}
          title="Public vs Private Deals"
          points={[
            "Public deals are visible to everyone on the Market for open discovery.",
            "Reserved deals can be discovered publicly but accepted only by a specific wallet.",
            "Private deals are visible only to the wallet you choose and anyone with the direct link.",
            "In every mode, your NFTs stay in your wallet until the deal executes.",
          ]}
        />
        <InfoCard
          icon={<Zap className="h-5 w-5" />}
          title="Why Ethereum"
          points={[
            "Fast settlement keeps accepted deals feeling responsive.",
            "Lower-cost execution makes negotiation and settlement friendlier for collectors.",
            "EVM compatibility lets traders keep familiar wallets and smart contract patterns.",
            "Ethereum is the infrastructure advantage; Handshake remains focused on human-to-human NFT deals.",
          ]}
        />
      </div>

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/create"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-ethereum-purple to-fuchsia-400 px-8 text-base font-medium text-primary-foreground shadow-lg shadow-ethereum-purple/20 transition-colors hover:from-ethereum-purple/90 hover:to-fuchsia-400/90"
        >
          Propose a Deal <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-md border border-ethereum-purple/50 px-8 text-base font-medium text-foreground transition-colors hover:bg-ethereum-purple/10"
        >
          Browse the Market
        </Link>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  points,
}: {
  icon: ReactNode;
  title: string;
  points: string[];
}) {
  return (
    <Card className="border-ethereum-purple/20 bg-card/60 backdrop-blur transition-all hover:-translate-y-1 hover:border-ethereum-purple/50 hover:shadow-2xl hover:shadow-ethereum-purple/15">
      <CardContent className="p-6">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-ethereum-purple/15 text-ethereum-purple">
          {icon}
        </div>
        <h2 className="mb-4 text-xl font-semibold text-foreground">{title}</h2>
        <ul className="space-y-3 text-sm leading-6 text-foreground/85">
          {points.map((point) => (
            <li key={point} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ethereum-purple" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}