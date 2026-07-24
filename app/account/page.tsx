"use client";

import { useAccount } from "wagmi";
import { format } from "date-fns";
import { Inbox, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OfferCard } from "@/components/trade/offer-card";
import { WalletNFTs } from "@/components/trade/wallet-nfts";
import { EmptyState } from "@/components/empty-state";
import { EscrowPanel } from "@/components/wallet/escrow-panel";
import { RoomsSection } from "@/components/deal-room/rooms-section";
import { useOffers, useReputation } from "@/hooks/use-market";
import { cn, shortAddress } from "@/lib/utils";

export default function AccountPage() {
  const { address, isConnected } = useAccount();
  const { data: offers, isLoading: loadingOffers } = useOffers({
    wallet: address,
    limit: 100,
  });
  const { data: reputation } = useReputation(address);

  if (!isConnected || !address) {
    return (
      <div className="container mx-auto px-4 py-20">
        <EmptyState
          title="Connect your wallet"
          body="Connect a wallet to see your NFTs, deals, and handshake history."
        />
      </div>
    );
  }

  const me = address.toLowerCase();
  const allOpen = offers?.filter((o) => o.status === "open") ?? [];
  const incoming = allOpen.filter(
    (o) =>
      o.takerAddress?.toLowerCase() === me &&
      o.makerAddress.toLowerCase() !== me
  );
  const open = allOpen.filter((o) => o.makerAddress.toLowerCase() === me);
  const completed = offers?.filter((o) => o.status === "completed") ?? [];
  const cancelled = offers?.filter((o) => o.status === "cancelled") ?? [];

  return (
    <div className="container mx-auto space-y-12 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-1 text-foreground">{shortAddress(address)}</p>
        <div className="mt-4 grid max-w-2xl grid-cols-3 gap-4">
          <StatCard
            label="Completed Handshakes"
            value={reputation?.completedTradesCount ?? 0}
          />
          <StatCard
            label="Cancelled Deals"
            value={reputation?.cancelledTradesCount ?? 0}
          />
          <StatCard
            label="Last Handshake"
            value={
              reputation?.lastTradeAt
                ? format(new Date(reputation.lastTradeAt), "MMM d, yyyy")
                : "—"
            }
          />
        </div>
        {/* Escrow (left) with live Deal Rooms surfaced to its right, kept
            above the "My Active Deals" grid so ongoing negotiations are the
            first thing visible on tab switch. */}
        <div className="mt-4 grid gap-5 lg:grid-cols-2 lg:items-start">
          <EscrowPanel />
          <Section title="Deal Rooms — live negotiations">
            <RoomsSection wallet={address} />
          </Section>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Dashboard Deals
          </p>
          <h2 className="text-2xl font-semibold">Ownership at a glance</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <DealColumn
            title="Incoming Deals"
            subtitle="Deals addressed to your wallet. Review and accept them."
            countLabel={`${incoming.length} waiting`}
            badge="Needs Action"
            accent="blue"
            icon={<Inbox className="h-5 w-5" />}
            loading={loadingOffers}
            emptyTitle="No incoming deals."
            emptyBody="Deals addressed to your wallet will appear here."
            isEmpty={incoming.length === 0}
          >
            <OfferGrid offers={incoming} ownership="incoming" />
          </DealColumn>

          <DealColumn
            title="My Active Deals"
            subtitle="Deals you've created that are waiting for another collector."
            countLabel={`${open.length} active`}
            badge="Created by You"
            accent="purple"
            icon={<Send className="h-5 w-5" />}
            loading={loadingOffers}
            emptyTitle="You haven't created any deals yet."
            emptyBody="Propose a Deal to get started."
            isEmpty={open.length === 0}
          >
            <OfferGrid offers={open} ownership="created" />
          </DealColumn>
        </div>
      </section>

      <Section
        title={`Completed Handshakes (${completed.length})`}
        loading={loadingOffers}
      >
        {completed.length > 0 ? (
          <OfferGrid offers={completed} />
        ) : (
          <EmptyState
            title="No completed handshakes yet"
            body="Completed handshakes appear here."
          />
        )}
      </Section>

      <Section title="Wanted Requests">
        <EmptyState
          title="Wanted requests live on the Wanted board"
          body="Post requests for NFTs you want, then answer matching collectors with private deals."
        />
      </Section>

      <Section
        title={`Recent Activity (${cancelled.length})`}
        loading={loadingOffers}
      >
        {cancelled.length > 0 ? (
          <OfferGrid offers={cancelled} />
        ) : (
          <EmptyState
            title="No recent cancelled deals"
            body="Cancelled deals and other activity appear here."
          />
        )}
      </Section>

      <Section title="My NFTs">
        <WalletNFTs owner={address} />
      </Section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xl font-bold text-ethereum-purple">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  loading,
  children,
}: {
  title: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function DealColumn({
  title,
  subtitle,
  countLabel,
  badge,
  accent,
  icon,
  loading,
  emptyTitle,
  emptyBody,
  children,
  isEmpty,
}: {
  title: string;
  subtitle: string;
  countLabel: string;
  badge: string;
  accent: "blue" | "purple";
  icon: React.ReactNode;
  loading?: boolean;
  emptyTitle: string;
  emptyBody: string;
  children: React.ReactNode;
  isEmpty?: boolean;
}) {
  const isBlue = accent === "blue";

  return (
    <div
      className={cn(
        "flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border bg-card/80 shadow-lg",
        isBlue
          ? "border-cyan-300/25 shadow-cyan-400/5"
          : "border-ethereum-purple/30 shadow-ethereum-purple/10"
      )}
    >
      <div
        className={cn(
          "border-b p-5",
          isBlue
            ? "border-cyan-300/20 bg-gradient-to-br from-cyan-400/15 via-card to-blue-500/10"
            : "border-ethereum-purple/20 bg-gradient-to-br from-ethereum-purple/20 via-card to-fuchsia-500/10"
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                isBlue
                  ? "bg-cyan-400/15 text-cyan-200"
                  : "bg-ethereum-purple/20 text-ethereum-purple"
              )}
            >
              {icon}
            </span>
            <div>
              <h3 className="text-xl font-semibold">{title}</h3>
              <p
                className={cn(
                  "mt-1 text-sm font-semibold",
                  isBlue ? "text-cyan-200" : "text-ethereum-purple"
                )}
              >
                {countLabel}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
              isBlue
                ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-200"
                : "border-ethereum-purple/40 bg-ethereum-purple/10 text-ethereum-purple"
            )}
          >
            {badge}
          </span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{subtitle}</p>
      </div>

      <div className="min-h-0 flex-1 p-4 lg:max-h-[42rem] lg:overflow-y-auto">
        {loading ? (
          <div className="grid gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState title={emptyTitle} body={emptyBody} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function OfferGrid({
  offers,
  ownership,
}: {
  offers: any[];
  ownership?: "incoming" | "created";
}) {
  if (offers.length === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-4",
        !ownership && "md:grid-cols-2 lg:grid-cols-3"
      )}
    >
      {offers.map((offer) => (
        <OfferCard key={offer.id} offer={offer} ownership={ownership} />
      ))}
    </div>
  );
}
