"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Copy,
  ImageIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Handshake,
  Lock,
  Plus,
  SlidersHorizontal,
  ShieldCheck,
  Upload,
  Zap,
} from "lucide-react";
import { useAccount } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { SafeCollectionImage } from "@/components/ui/safe-collection-image";
import { WelcomeTutorial } from "@/components/tutorial/welcome-tutorial";
import { useMarketStats, useOffers } from "@/hooks/use-market";
import {
  FEATURED_COLLECTIONS,
} from "@/lib/featured-collections";
import { formatEth } from "@/lib/utils";

export default function HomePage() {
  const { address } = useAccount();
  const { data: stats } = useMarketStats();
  const { data: walletOffers } = useOffers({
    wallet: address,
    status: "open",
    limit: 100,
  });
  const privateOffers =
    walletOffers?.filter(
      (offer) =>
        offer.isPrivate &&
        offer.takerAddress?.toLowerCase() === address?.toLowerCase() &&
        offer.makerAddress.toLowerCase() !== address?.toLowerCase(),
    ).length ?? null;

  return (
    <div className="container mx-auto px-4">
      <WelcomeTutorial />

      <section className="relative my-6 grid gap-10 overflow-hidden rounded-[2rem] border border-ethereum-purple/20 bg-gradient-to-br from-ethereum-purple/15 via-fuchsia-500/10 to-cyan-400/10 px-5 py-10 shadow-2xl shadow-ethereum-purple/10 md:grid-cols-[1.05fr_0.95fr] md:items-center md:px-8 md:py-14">
        <div className="pointer-events-none absolute right-12 top-10 h-24 w-24 rounded-full bg-fuchsia-400/20 blur-2xl" />
        <div className="pointer-events-none absolute bottom-8 left-1/3 h-32 w-32 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="text-center md:text-left">
          <h1 className="text-balance mx-auto max-w-3xl text-4xl font-bold tracking-tight md:mx-0 md:text-6xl">
            Every trade is a{" "}
            <span className="text-ethereum-purple">handshake</span> Human to
            human
          </h1>
          <div className="mx-auto mt-5 max-w-xl space-y-3 text-foreground md:mx-0">
            <p className="text-lg">
              Create public or private NFT deals on Ethereum
              A high-speed EVM-compatible chain 
              No bots, no snipers, no custody
            </p>
            <BuiltOnEthereumBadge />
          </div>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row md:justify-start">
            <Link
              href="/create"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-ethereum-purple to-fuchsia-400 px-8 text-base font-medium text-primary-foreground shadow-lg shadow-ethereum-purple/20 transition-colors hover:from-ethereum-purple/90 hover:to-fuchsia-400/90"
            >
              Propose a Deal <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/market"
              className="inline-flex h-12 items-center justify-center rounded-md border border-ethereum-purple/50 bg-transparent px-8 text-base font-medium text-foreground transition-colors hover:bg-ethereum-purple/10"
            >
              Browse Market
            </Link>
          </div>

          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4 md:mx-0">
            <Stat
              label="Handshakes completed"
              value={String(stats?.totalTrades ?? "—")}
            />
            <Stat label="Open Deals" value={String(stats?.openOffers ?? "—")} />
            <Stat
              label="Private Deals"
              value={address ? String(privateOffers ?? "—") : "Connect"}
            />
            <Stat
              label="ETH volume"
              value={stats ? formatEth(BigInt(stats.totalVolumeWei)) : "—"}
            />
          </div>
        </div>

        <HeroPreview />
      </section>

      <WhyEthereumSection />

      <section className="border-t border-ethereum-purple/20 py-14">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          How it works
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <HowCard
            icon={<Handshake className="h-6 w-6 text-ethereum-purple" />}
            title="1. Propose a Deal"
            body="Build a public or private deal with NFTs, ETH, or both. Signing is free — no gas to propose."
          />
          <HowCard
            icon={<ShieldCheck className="h-6 w-6 text-ethereum-purple" />}
            title="2. Deal accepted"
            body="Another collector reviews exactly what moves on both sides, including fees, then accepts the deal in their wallet."
          />
          <HowCard
            icon={<Zap className="h-6 w-6 text-ethereum-purple" />}
            title="3. Everything swaps or nothing does"
            body="One transaction executes the trade. That’s atomic settlement: everything swaps or nothing does, then the handshake is completed."
          />
        </div>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/create"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-gradient-to-r from-ethereum-purple to-fuchsia-400 px-6 font-medium text-primary-foreground shadow-lg shadow-ethereum-purple/20 transition-colors hover:from-ethereum-purple/90 hover:to-fuchsia-400/90"
          >
            Propose your first deal <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/market"
            className="inline-flex h-11 items-center justify-center rounded-md border border-ethereum-purple/50 bg-transparent px-6 font-medium text-foreground transition-colors hover:bg-ethereum-purple/10"
          >
            Browse Market
          </Link>
        </div>
      </section>

    </div>
  );
}

function BuiltOnEthereumBadge() {
  return (
    <div className="group relative inline-flex flex-col items-center gap-2 md:items-start">
      <div className="inline-flex items-center gap-2 rounded-full border border-ethereum-purple/40 bg-ethereum-purple/15 px-3 py-1.5 text-sm font-medium text-foreground shadow-lg shadow-ethereum-purple/10">
        <span>⚡ Built on Ethereum</span>
        <a
          href="https://ethereum.xyz"
          target="_blank"
          rel="noreferrer"
          className="text-ethereum-purple underline-offset-4 hover:underline"
        >
          Learn more
        </a>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-xl border border-ethereum-purple/25 bg-background/95 p-3 text-left text-xs text-foreground opacity-0 shadow-2xl shadow-ethereum-purple/20 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:left-0 md:translate-x-0">
        Ethereum is a high-performance EVM-compatible blockchain designed for fast,
        low-cost apps.
      </div>
    </div>
  );
}

function WhyEthereumSection() {
  return (
    <section id="why-ethereum" className="border-t border-ethereum-purple/20 py-14">
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ethereum-purple">
          <Zap className="h-3.5 w-3.5" /> Why Ethereum?
        </p>
        <h2 className="text-3xl font-semibold">Why Handshake runs on Ethereum</h2>
        <p className="mt-3 text-base text-foreground/95">
          Handshake needs fast settlement, low fees, and familiar wallet
          tooling. Ethereum gives NFT traders that without changing the EVM
          experience.
        </p>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <WhyEthereumCard
          title="Fast settlement"
          body="Deals should feel instant. Ethereum is designed for high-throughput applications and responsive trading experiences."
        />
        <WhyEthereumCard
          title="Lower-cost trading"
          body="NFT collectors should not hesitate because every action feels expensive. Handshake uses signatures for deal creation and on-chain settlement only when a deal executes."
        />
        <WhyEthereumCard
          title="EVM-compatible"
          body="Collectors can use familiar wallets and smart contract patterns while trading on a faster execution layer."
        />
      </div>
      <div className="mt-6 text-center">
        <Link
          href="/about"
          className="text-sm font-medium text-ethereum-purple underline-offset-4 hover:underline"
        >
          Why Handshake?
        </Link>
      </div>
    </section>
  );
}

function WhyEthereumCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="group border-ethereum-purple/20 bg-card/60 backdrop-blur transition-all hover:-translate-y-1 hover:border-ethereum-purple/50 hover:shadow-2xl hover:shadow-ethereum-purple/15">
      <CardContent className="p-6">
        <div className="mb-4 h-1.5 w-16 rounded-full bg-gradient-to-r from-ethereum-purple to-fuchsia-400" />
        <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-6 text-foreground/95">{body}</p>
      </CardContent>
    </Card>
  );
}

function HeroPreview() {
  const [activeSlide, setActiveSlide] = useState(0);
  const carouselSlides = [
    {
      id: "preview",
      label: "New on Handshake",
      title: "Deal Room",
      badge: "Spark hackathon",
      content: <LivePreviewSlide />,
    },
    {
      id: "wanted",
      label: "Example offer",
      title: "Wanted",
      badge: "Collector ask",
      content: <WantedOfferSlide />,
    },
    {
      id: "sell",
      label: "Sell NFT",
      title: "Upload an asset",
      badge: "List fast",
      content: <SellNftSlide />,
    },
    {
      id: "custom",
      label: "",
      title: "Create Custom Deal",
      badge: (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ethereum-purple text-ethereum-black">
          <Handshake className="h-5 w-5" aria-label="Handshake" />
        </span>
      ),
      content: <CustomDealSlide />,
    },
    {
      id: "private",
      label: "Private Option",
      title: "Control deal visibility",
      badge: "Locked",
      content: <PrivateOptionSlide />,
    },
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % carouselSlides.length);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [carouselSlides.length]);

  const moveSlide = (direction: 1 | -1) => {
    setActiveSlide(
      (current) =>
        (current + direction + carouselSlides.length) % carouselSlides.length,
    );
  };

  return (
    <div className="relative mx-auto h-[39rem] w-full max-w-2xl overflow-visible [perspective:1200px] sm:h-[37rem]">
      <div className="absolute -inset-8 rounded-[2.5rem] bg-ethereum-purple/20 blur-3xl" />


      <div className="absolute inset-x-0 top-2 h-[32rem] [transform-style:preserve-3d] sm:h-[31rem]">
        {carouselSlides.map((slide, index) => {
          const rawOffset = index - activeSlide;
          const offset =
            rawOffset > carouselSlides.length / 2
              ? rawOffset - carouselSlides.length
              : rawOffset < -carouselSlides.length / 2
                ? rawOffset + carouselSlides.length
                : rawOffset;
          const isActive = offset === 0;

          return (
            <Card
              key={slide.id}
              aria-hidden={!isActive}
              className="hero-carousel-card absolute left-1/2 top-1/2 h-[30.5rem] w-[min(86vw,28rem)] overflow-hidden border-ethereum-purple/30 bg-gradient-to-br from-card/95 via-ethereum-purple/10 to-cyan-400/10 shadow-2xl shadow-ethereum-purple/10"
              style={{
                opacity: Math.abs(offset) > 2 ? 0 : isActive ? 1 : 0.5,
                pointerEvents: isActive ? "auto" : "none",
                transform: `translate(-50%, -50%) translateX(${offset * 26}%) translateZ(${-Math.abs(offset) * 120}px) rotateY(${-offset * 24}deg) scale(${isActive ? 1 : 0.82})`,
                zIndex: 10 - Math.abs(offset),
              }}
            >
              <CardContent className="flex h-full flex-col space-y-4 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    {slide.label && (
                      <p className="text-xs font-medium uppercase tracking-wide text-ethereum-purple">
                        {slide.label}
                      </p>
                    )}
                    {slide.title && (
                      <h3 className="text-xl font-semibold">{slide.title}</h3>
                    )}
                  </div>
                  <span className="flex min-h-8 shrink-0 items-center justify-center rounded-full border border-ethereum-purple/40 bg-ethereum-purple/10 px-3 py-1 text-xs text-ethereum-purple">
                    {slide.badge}
                  </span>
                </div>
                {slide.content}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => moveSlide(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-ethereum-purple/40 bg-background/80 text-ethereum-purple backdrop-blur transition hover:bg-ethereum-purple/10"
          aria-label="Previous carousel slide"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-background/80 px-3 py-2 backdrop-blur">
          {carouselSlides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setActiveSlide(index)}
              className={`h-2.5 rounded-full transition-all ${
                activeSlide === index
                  ? "w-8 bg-ethereum-purple"
                  : "w-2.5 bg-ethereum-purple/30 hover:bg-ethereum-purple/60"
              }`}
              aria-label={`Show ${slide.title} slide`}
              aria-current={activeSlide === index ? "true" : undefined}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => moveSlide(1)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-ethereum-purple/40 bg-background/80 text-ethereum-purple backdrop-blur transition hover:bg-ethereum-purple/10"
          aria-label="Next carousel slide"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function LivePreviewSlide() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-ethereum-purple/30 bg-background/50 p-5 text-center">
      <Handshake className="mb-3 h-10 w-10 text-ethereum-purple" />
      <h4 className="text-base font-semibold">Deal Room is live</h4>
      <p className="mt-2 text-sm text-foreground/90">
        Deal Room is a new way to negotiate on Handshake — open a private
        room, counter back and forth, and settle in a single signature.
        Built for the Spark hackathon by{" "}
        <a
          href="https://buildanything.so/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-ethereum-purple underline-offset-4 hover:underline"
        >
          BuildAnything
        </a>
        .
      </p>
      <Link
        href="/rooms/new"
        className="mt-4 rounded-full border border-ethereum-purple/40 bg-ethereum-purple/10 px-4 py-2 text-sm font-medium text-ethereum-purple transition hover:bg-ethereum-purple/20"
      >
        Open a Deal Room
      </Link>
    </div>
  );
}

function WantedOfferSlide() {
  return (
    <div className="space-y-4 rounded-2xl border border-cyan-300/20 bg-background/60 p-4">
      <div className="rounded-2xl border border-ethereum-purple/20 bg-gradient-to-br from-ethereum-purple/15 via-card to-cyan-300/10 p-4 shadow-lg shadow-ethereum-purple/10">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-cyan-200">
              Wanted offer
            </p>
            <h4 className="mt-1 text-lg font-semibold">
              Looking for 2x T00ns NFT
            </h4>
          </div>
          <span className="rounded-full border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 py-1 text-xs text-fuchsia-200">
            Open ask
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="rounded-xl border border-ethereum-purple/20 bg-secondary/70 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground">
              Collector offers
            </p>
            <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3 text-center">
              <img
                src="/Logomark.svg"
                alt="Ethereum logo"
                width={28}
                height={28}
                className="mx-auto"
              />
              <p className="mt-2 text-[1.005rem] font-bold text-cyan-200">
                0,1 ETH
              </p>
              <p className="mt-1 text-xs text-foreground/90">plus fees</p>
            </div>
          </div>

          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ethereum-purple text-ethereum-black">
            <Handshake className="h-5 w-5" />
          </div>

          <div className="rounded-xl border border-ethereum-purple/20 bg-secondary/70 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground">
              Wants
            </p>
            <div className="flex aspect-square flex-col items-center justify-center rounded-lg border border-ethereum-purple/30 bg-gradient-to-br from-fuchsia-400/30 to-cyan-300/20 text-ethereum-purple">
              <SafeCollectionImage
                collectionAddress="0x902d94ba5bfc0cb408d1a6ca4b8f255d845e50e9"
                alt="T00ns logo"
                className="h-16 w-16 rounded-full"
              />
              <span className="mt-2 text-xs font-semibold text-foreground">
                2x
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-sm text-foreground/95">
        A code-built “Wanted” example card: show what a collector offers and the
        NFT they want without relying on a binary image asset.
      </p>
    </div>
  );
}

function CustomDealSlide() {
  const steps = [
    {
      number: "1",
      icon: <Copy className="h-4 w-4" />,
      title: "Choose Custom Trade",
      body: "Select the custom trade option in the trade builder.",
    },
    {
      number: "2",
      icon: <Plus className="h-4 w-4" />,
      title: "Add your T00ns NFT and 10K ETH",
      body: "Add the assets you want to offer on your side.",
    },
    {
      number: "3",
      icon: <ImageIcon className="h-4 w-4" />,
      title: "Request another T00ns NFT",
      body: "Choose the NFT you want on the other side.",
    },
    {
      number: "4",
      icon: <ShieldCheck className="h-4 w-4" />,
      title: "Handshake only settles if",
      body: "both wallets still match the signed deal.",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="rounded-2xl border border-ethereum-purple/40 bg-background/70 p-3 shadow-lg shadow-ethereum-purple/10">
        <CustomTradeVisual />

        <div className="my-3 h-px bg-gradient-to-r from-transparent via-ethereum-purple/40 to-transparent" />

        <div className="space-y-1.5">
          {steps.map((step) => (
            <div
              key={step.number}
              className="grid grid-cols-[1.75rem_2.5rem_1fr] items-center gap-2 rounded-xl border border-ethereum-purple/15 bg-secondary/35 p-1.5"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-ethereum-purple/70 bg-ethereum-purple/15 text-sm font-bold text-foreground">
                {step.number}
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-ethereum-purple/25 bg-background/70 text-ethereum-purple">
                {step.icon}
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {step.title}
                </p>
                <p className="text-[11px] leading-4 text-foreground/90">
                  {step.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CustomTradeVisual() {
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-ethereum-purple">
          You give
        </p>
        <div />
        <p className="text-center text-xs font-bold uppercase tracking-wide text-ethereum-purple">
          You get
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="rounded-xl border border-ethereum-purple/35 bg-secondary/60 p-2 shadow-lg shadow-ethereum-purple/10">
          <div className="flex items-center justify-center gap-3">
            <div className="text-center">
              <SafeCollectionImage
                collectionAddress="0x902d94ba5bfc0cb408d1a6ca4b8f255d845e50e9"
                alt="T00ns x1"
                className="h-[54px] w-[54px] rounded-xl border border-ethereum-purple/30"
              />
              <p className="mt-1 text-sm font-bold text-foreground">1x</p>
            </div>
            <span className="text-xl font-bold text-ethereum-purple">+</span>
            <div className="flex h-16 w-14 flex-col items-center justify-center rounded-xl border border-ethereum-purple/35 bg-background/80 text-center">
              <img
                src="/Logomark.svg"
                alt="Ethereum logo"
                width={22}
                height={22}
                className="mb-1"
              />
              <span className="text-xs font-semibold text-ethereum-purple">
                ETH
              </span>
              <span className="text-base font-bold text-foreground">10K</span>
            </div>
          </div>
        </div>

        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-ethereum-purple text-ethereum-black shadow-xl shadow-ethereum-purple/40">
          <span className="absolute -left-5 text-lg text-ethereum-purple">→</span>
          <Handshake className="h-6 w-6" />
          <span className="absolute -right-5 text-lg text-ethereum-purple">→</span>
        </div>

        <div className="rounded-xl border border-ethereum-purple/35 bg-secondary/60 p-2 shadow-lg shadow-ethereum-purple/10">
          <div className="text-center">
            <SafeCollectionImage
              collectionAddress="0x902d94ba5bfc0cb408d1a6ca4b8f255d845e50e9"
              alt="T00ns x1"
              className="mx-auto h-[54px] w-[54px] rounded-xl border border-ethereum-purple/30"
            />
            <p className="mt-1 text-sm font-bold text-foreground">1x</p>
          </div>
        </div>
      </div>
    </div>
  );
}
function PrivateOptionSlide() {
  const options = [
    {
      title: "Public — anyone can accept",
      body: "Listed on the open feed. The first matching wallet can fill it.",
    },
    {
      title: "Reserved for one wallet",
      body: "Still listed publicly, but only the wallet you name is allowed to accept.",
    },
    {
      title: "Private / unlisted",
      body: "Hidden from the public feed. Only the wallet you name with the link can see and accept it.",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-cyan-300/20 bg-background/60 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-ethereum-purple text-ethereum-black shadow-lg shadow-ethereum-purple/20">
          <Lock className="h-7 w-7" />
        </div>
        <div>
          <h4 className="text-lg font-semibold">Who can see and accept it?</h4>
          <p className="mt-1 text-sm text-foreground/95">
            Control whether the deal is public, reserved, or hidden.
          </p>
        </div>
      </div>

      <div className="space-y-2 overflow-hidden">
        {options.map((option) => (
          <div
            key={option.title}
            className="rounded-xl border border-ethereum-purple/25 bg-card/80 p-3"
          >
            <p className="text-sm font-semibold text-ethereum-purple">
              {option.title}
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground/95">
              {option.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SellNftSlide() {
  const steps = [
    {
      number: "1",
      icon: <ImageIcon className="h-6 w-6" />,
      title: "Choose your NFT",
      body: "Upload or select the NFT you want to sell.",
    },
    {
      number: "2",
      icon: <SlidersHorizontal className="h-6 w-6" />,
      title: "Set your preferences",
      body: "Choose what you want in return and other deal options.",
    },
    {
      number: "3",
      icon: <Handshake className="h-6 w-6" />,
      title: "Publish your offer",
      body: "Your offer goes live and collectors can respond.",
    },
  ];

  return (
    <div className="relative -mx-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.35rem] border border-ethereum-purple/50 bg-[#050b18] p-3 shadow-[0_0_45px_rgba(131,84,255,0.18)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(147,88,255,0.18),transparent_34%),radial-gradient(circle_at_82%_82%,rgba(84,52,255,0.22),transparent_38%)]" />

      <div className="relative z-10 grid flex-1 grid-cols-[1.08fr_0.92fr] gap-3">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ethereum-purple/75 bg-black/10 p-2.5 text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-ethereum-purple bg-ethereum-purple/10 text-ethereum-purple shadow-[0_0_28px_rgba(139,92,246,0.8)]">
            <Upload className="h-10 w-10" />
          </div>
          <p className="mt-3 text-base font-bold leading-tight">
            Upload or pick an NFT
          </p>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Drag & drop your NFT file or click to{" "}
            <span className="text-ethereum-purple">browse</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Images, GIFs, MP4s and more
            <CheckCircle2 className="h-4 w-4 text-ethereum-purple" />
          </p>
        </div>

        <div className="space-y-2">
          {steps.map((step) => (
            <div
              key={step.number}
              className="grid grid-cols-[1.9rem_2.7rem_1fr] items-center gap-2"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-ethereum-purple to-violet-600 text-sm font-bold">
                {step.number}
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-ethereum-purple">
                {step.icon}
              </span>
              <span>
                <span className="block text-[13px] font-bold leading-tight">
                  {step.title}
                </span>
                <span className="block text-[10px] leading-3 text-muted-foreground">
                  {step.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 mt-2.5 flex items-center justify-between rounded-2xl border border-ethereum-purple/50 bg-gradient-to-r from-ethereum-purple/30 via-[#121038] to-ethereum-purple/30 p-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-ethereum-purple/60 bg-ethereum-purple/20 p-2">
            <img
              src="/Logomark.svg"
              alt="Ethereum logo"
              width={24}
              height={24}
            />
          </span>
          <span>
            <span className="block text-[13px] font-bold text-purple-300">
              Built for Ethereum
            </span>
            <span className="text-[11px] text-muted-foreground">
              Low fees. High speed. Human-first.
            </span>
          </span>
        </div>
        <span className="hidden items-center gap-2 rounded-lg bg-black/50 px-2.5 py-1.5 text-[11px] text-muted-foreground sm:inline-flex">
          Powered by
          <img src="/Logomark.svg" alt="" width={18} height={18} />
          <strong className="text-white">ETH_MAINNET</strong>
        </span>
      </div>

      <p className="relative z-10 mt-1.5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        You keep your NFT until a deal is accepted.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-ethereum-purple/20 bg-gradient-to-br from-ethereum-purple/15 via-card to-cyan-400/10 shadow-lg shadow-ethereum-purple/5">
      <CardContent className="p-4 text-center">
        <p className="text-2xl font-bold text-ethereum-purple">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function HowCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="border-ethereum-purple/20 bg-gradient-to-br from-card via-ethereum-purple/10 to-fuchsia-500/10 shadow-lg shadow-ethereum-purple/5">
      <CardContent className="p-6">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-ethereum-purple/15">
          {icon}
        </div>
        <h3 className="mb-2 font-semibold">{title}</h3>
        <p className="text-sm text-foreground/80">{body}</p>
      </CardContent>
    </Card>
  );
}
