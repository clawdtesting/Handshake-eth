"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, Search, Swords, Trophy, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NFTMedia } from "@/components/ui/nft-media";
import { Arena } from "@/components/combat/arena";
import { getBrowserClient } from "@/lib/supabase/browser";
import {
  useBurntTokens,
  useBurntTokenLookup,
  useBurntTraits,
} from "@/hooks/use-burnt";
import { deriveFighter, simulate, type CombatResult } from "@/lib/combat/engine";
import { buildRarityIndex, deriveFighterFromTraits } from "@/lib/combat/trait-stats";
import { cn } from "@/lib/utils";

const BEST_OF = 3;
const WINS_NEEDED = Math.ceil(BEST_OF / 2); // 2

interface SeatState {
  id: string; // per-session client id (presence key)
  name: string;
  isHost: boolean;
  tokenId: string | null;
  image: string | null;
  ready: boolean;
  // host-authoritative match control:
  seed: number | null;
  startAt: number | null;
  round: number;
  winsA: number;
  winsB: number;
}

function randomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function CombatLivePage() {
  const supa = getBrowserClient();

  // Per-session identity — no wallet needed.
  const [clientId, setClientId] = useState<string | null>(null);
  useEffect(() => {
    setClientId(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    );
  }, []);
  const name = clientId ? `Player ${clientId.slice(0, 4)}` : "";

  const [code, setCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [joinInput, setJoinInput] = useState("");

  // My seat.
  const [myTokenId, setMyTokenId] = useState<string | null>(null);
  const [myImage, setMyImage] = useState<string | null>(null);
  const [myReady, setMyReady] = useState(false);

  // Host-authoritative match state.
  const [hostSeed, setHostSeed] = useState<number | null>(null);
  const [hostStartAt, setHostStartAt] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [winsA, setWinsA] = useState(0);
  const [winsB, setWinsB] = useState(0);

  const [seats, setSeats] = useState<SeatState[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  // Picker.
  const [idInput, setIdInput] = useState("");
  const [lookupId, setLookupId] = useState<string | null>(null);
  const lookup = useBurntTokenLookup(lookupId);
  const collection = useBurntTokens("all");
  const collectionTokens = collection.data?.pages.flatMap((p) => p.tokens) ?? [];

  const channelRef = useRef<ReturnType<
    NonNullable<ReturnType<typeof getBrowserClient>>["channel"]
  > | null>(null);
  const countedRound = useRef(-1);

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) {
      setCode(room.toUpperCase());
      setIsHost(false);
    }
  }, []);

  // Resolve a typed token id → set it as my fighter.
  useEffect(() => {
    if (!lookupId || !lookup.data) return;
    if (lookup.data.exists && String(lookup.data.tokenId) === lookupId) {
      setMyTokenId(lookupId);
      setMyImage(lookup.data.image ?? null);
    }
  }, [lookupId, lookup.data]);

  // Join/leave the realtime channel.
  useEffect(() => {
    if (!supa || !code || !clientId) return;
    setSubscribed(false);
    const channel = supa.channel(`combat-live:${code}`, {
      config: { presence: { key: clientId } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as unknown as Record<string, SeatState[]>;
      setSeats(Object.values(state).flat());
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setSubscribed(true);
    });

    return () => {
      supa.removeChannel(channel);
      channelRef.current = null;
      setSubscribed(false);
    };
  }, [supa, code, clientId]);

  // Broadcast my seat.
  const myState: SeatState = useMemo(
    () => ({
      id: clientId ?? "",
      name,
      isHost,
      tokenId: myTokenId,
      image: myImage,
      ready: myReady,
      seed: isHost ? hostSeed : null,
      startAt: isHost ? hostStartAt : null,
      round: isHost ? round : 0,
      winsA: isHost ? winsA : 0,
      winsB: isHost ? winsB : 0,
    }),
    [clientId, name, isHost, myTokenId, myImage, myReady, hostSeed, hostStartAt, round, winsA, winsB],
  );
  useEffect(() => {
    if (subscribed && channelRef.current) channelRef.current.track(myState);
  }, [subscribed, myState]);

  // Deduped seats → host/guest.
  const seatList = useMemo(() => {
    const byId = new Map<string, SeatState>();
    for (const s of seats) if (s?.id) byId.set(s.id, s);
    return [...byId.values()];
  }, [seats]);
  const host = seatList.find((s) => s.isHost) ?? null;
  const guest = seatList.find((s) => !s.isHost) ?? null;
  const roomFull =
    !isHost && !!guest && guest.id !== clientId && !!host && host.id !== clientId;

  const activeSeed = host?.seed ?? null;
  const activeStart = host?.startAt ?? null;
  const activeRound = host?.round ?? 0;
  const sWinsA = host?.winsA ?? 0;
  const sWinsB = host?.winsB ?? 0;
  const matchOver = sWinsA >= WINS_NEEDED || sWinsB >= WINS_NEEDED;
  const idA = host?.tokenId ?? null;
  const idB = guest?.tokenId ?? null;
  const imageA = host?.image ?? null;
  const imageB = guest?.image ?? null;

  // Host starts round 1 once both are ready with a T00n.
  useEffect(() => {
    if (!isHost || round !== 0 || matchOver) return;
    if (host?.ready && guest?.ready && host?.tokenId && guest?.tokenId) {
      setHostSeed(Math.floor(Math.random() * 1_000_000_000));
      setHostStartAt(Date.now() + 1500);
      setRound(1);
    }
  }, [isHost, round, matchOver, host?.ready, guest?.ready, host?.tokenId, guest?.tokenId]);

  // Trait-driven stats. Both clients derive from the same token traits +
  // collection rarity, so the fight stays identical on both screens.
  const { data: traitsData } = useBurntTraits();
  const rarityIndex = useMemo(
    () => (traitsData ? buildRarityIndex(traitsData.types) : null),
    [traitsData],
  );
  const lookupA = useBurntTokenLookup(idA);
  const lookupB = useBurntTokenLookup(idB);
  const statsReady = !!rarityIndex && !!lookupA.data && !!lookupB.data;

  const result = useMemo<CombatResult | null>(() => {
    if (activeSeed == null || !idA || !idB || !statsReady) return null;
    const fa =
      (rarityIndex && lookupA.data?.traits
        ? deriveFighterFromTraits(idA, lookupA.data.traits, rarityIndex)
        : null) ?? deriveFighter(idA);
    const fb =
      (rarityIndex && lookupB.data?.traits
        ? deriveFighterFromTraits(idB, lookupB.data.traits, rarityIndex)
        : null) ?? deriveFighter(idB);
    return simulate(fa, fb, activeSeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeed, idA, idB, activeRound, statsReady, rarityIndex, lookupA.data, lookupB.data]);

  useEffect(() => {
    if (activeSeed == null || activeStart == null || !result) return;
    setIdx(0);
    setRunning(false);
    const t = setTimeout(() => setRunning(true), Math.max(0, activeStart - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeed, activeStart, activeRound, result]);

  useEffect(() => {
    if (!result || !running || idx >= result.events.length) return;
    const t = setTimeout(() => setIdx((i) => i + 1), 650);
    return () => clearTimeout(t);
  }, [result, running, idx]);

  const done = !!result && idx >= result.events.length;

  useEffect(() => {
    if (!isHost || !done || !result) return;
    if (countedRound.current === activeRound) return;
    countedRound.current = activeRound;
    if (result.winner === idA) setWinsA((w) => w + 1);
    else if (result.winner === idB) setWinsB((w) => w + 1);
  }, [isHost, done, result, activeRound, idA, idB]);

  const lastEvent =
    result && idx > 0 ? result.events[Math.min(idx, result.events.length) - 1] : null;

  function createRoom() {
    const c = randomCode();
    setIsHost(true);
    setCode(c);
    window.history.replaceState({}, "", `?room=${c}`);
  }
  function joinRoom() {
    const c = joinInput.trim().toUpperCase();
    if (!c) return;
    setIsHost(false);
    setCode(c);
    window.history.replaceState({}, "", `?room=${c}`);
  }
  function leaveRoom() {
    setCode(null);
    setMyTokenId(null);
    setMyImage(null);
    setMyReady(false);
    setHostSeed(null);
    setHostStartAt(null);
    setRound(0);
    setWinsA(0);
    setWinsB(0);
    countedRound.current = -1;
    setIdx(0);
    setRunning(false);
    window.history.replaceState({}, "", window.location.pathname);
  }
  function pick(tokenId: string, image: string | null) {
    if (myReady) return;
    setMyTokenId(tokenId);
    setMyImage(image);
  }
  function submitId() {
    const id = idInput.trim().replace(/^#/, "");
    if (/^\d{1,10}$/.test(id)) setLookupId(id);
  }
  function nextRound() {
    if (!isHost || matchOver) return;
    setHostSeed(Math.floor(Math.random() * 1_000_000_000));
    setHostStartAt(Date.now() + 1200);
    setRound((r) => r + 1);
  }
  function newMatch() {
    if (!isHost) return;
    setWinsA(0);
    setWinsB(0);
    setHostSeed(Math.floor(Math.random() * 1_000_000_000));
    setHostStartAt(Date.now() + 1200);
    setRound((r) => r + 1);
  }
  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // ---- render gates ----
  if (!supa) {
    return (
      <Shell>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Live combat needs Supabase Realtime configured — set{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then reload.
          </CardContent>
        </Card>
      </Shell>
    );
  }
  if (!code) {
    return (
      <Shell>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <Users className="h-6 w-6 text-ethereum-purple" />
              <p className="text-sm text-muted-foreground">
                Start a room and share the link with your opponent.
              </p>
              <button
                onClick={createRoom}
                className="rounded-lg bg-ethereum-purple px-5 py-2.5 text-sm font-semibold text-ethereum-black hover:bg-ethereum-purple/90"
              >
                Create room
              </button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">Have a room code?</p>
              <div className="flex w-full gap-2">
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                  placeholder="CODE"
                  className="w-full rounded-lg border border-border/60 bg-transparent px-3 py-2.5 text-center text-sm uppercase outline-none focus:border-ethereum-purple/50"
                />
                <button
                  onClick={joinRoom}
                  className="shrink-0 rounded-lg bg-ethereum-purple/15 px-4 py-2.5 text-sm font-semibold text-ethereum-purple hover:bg-ethereum-purple/25"
                >
                  Join
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Shell>
    );
  }

  const inSeries = activeRound >= 1;
  const matchWinnerId =
    sWinsA >= WINS_NEEDED ? idA : sWinsB >= WINS_NEEDED ? idB : null;
  const idNotFound = !!lookupId && lookup.data?.exists === false;

  return (
    <Shell>
      {/* Room bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Room</span>
          <span className="rounded-md border border-border/60 px-2 py-1 font-mono font-semibold tracking-widest">
            {code}
          </span>
          <button
            onClick={copyLink}
            className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <button onClick={leaveRoom} className="text-sm text-muted-foreground hover:text-foreground">
          Leave
        </button>
      </div>

      {roomFull ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            This room already has two fighters.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Seats + score */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
            <SeatCard seat={host} label="Host" you={host?.id === clientId} />
            <div className="flex flex-col items-center justify-center px-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Best of {BEST_OF}
              </span>
              <span className="text-2xl font-bold tabular-nums">
                <span className={cn(sWinsA > sWinsB && "text-amber-400")}>{sWinsA}</span>
                <span className="mx-1 text-muted-foreground">–</span>
                <span className={cn(sWinsB > sWinsA && "text-amber-400")}>{sWinsB}</span>
              </span>
            </div>
            <SeatCard seat={guest} label="Challenger" you={guest?.id === clientId} />
          </div>

          {inSeries && !result ? (
            <div className="mt-6 flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading fighters…
            </div>
          ) : inSeries && result ? (
            <div className="mt-6">
              {matchWinnerId && (
                <div className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300">
                  <Trophy className="h-4 w-4" /> just t00ns #{matchWinnerId} wins
                  the match {sWinsA}–{sWinsB}!
                </div>
              )}
              <Arena
                result={result}
                idx={idx}
                lastEvent={lastEvent}
                done={done}
                nameOf={(id) => `#${id}`}
                imageA={imageA}
                imageB={imageB}
                hideControls
                overlayAction={
                  isHost ? (
                    <button
                      onClick={matchOver ? newMatch : nextRound}
                      className="flex items-center gap-1.5 rounded-md bg-ethereum-purple px-4 py-2 text-sm font-semibold text-ethereum-black hover:bg-ethereum-purple/90"
                    >
                      <Swords className="h-4 w-4" />
                      {matchOver ? "New match" : "Next round"}
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Waiting for host…
                    </span>
                  )
                }
              />
              {!done && !running && (
                <div className="mt-4 flex items-center justify-center">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Round {activeRound}{" "}
                    starting…
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                Pick your fighter
              </h2>

              {/* Quick pick by id */}
              <div className="mb-4 flex max-w-sm items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitId()}
                  inputMode="numeric"
                  placeholder="Enter a token id — e.g. 3145"
                  className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  onClick={submitId}
                  className="shrink-0 rounded-md bg-ethereum-purple/15 px-3 py-1.5 text-sm text-ethereum-purple hover:bg-ethereum-purple/25"
                >
                  Pick
                </button>
              </div>
              {idNotFound && (
                <p className="-mt-2 mb-3 text-xs text-red-400">
                  No token #{lookupId} in this collection.
                </p>
              )}

              {/* Browse the full collection (burned ones show grey). */}
              <p className="mb-2 text-xs text-muted-foreground">
                …or browse the collection — burned T00ns can fight too.
              </p>
              {collection.isLoading ? (
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/[0.04]" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
                    {collectionTokens.map((t) => {
                      const burned = t.status === "burned";
                      return (
                        <button
                          key={t.tokenId}
                          onClick={() => pick(t.tokenId, t.image)}
                          disabled={myReady}
                          className={cn(
                            "relative overflow-hidden rounded-lg border text-left transition-all disabled:opacity-60",
                            myTokenId === t.tokenId
                              ? "border-ethereum-purple ring-2 ring-ethereum-purple/50"
                              : "border-border/60 hover:border-ethereum-purple/40",
                          )}
                        >
                          <span className="block aspect-square w-full bg-white/[0.03]">
                            <NFTMedia
                              imageUrl={t.image}
                              alt={`#${t.tokenId}`}
                              className={cn("h-full w-full object-cover", burned && "grayscale")}
                            />
                          </span>
                          <span className="block truncate p-1 text-[11px]">#{t.tokenId}</span>
                        </button>
                      );
                    })}
                  </div>
                  {collection.hasNextPage && (
                    <div className="mt-4 flex justify-center">
                      <button
                        onClick={() => collection.fetchNextPage()}
                        disabled={collection.isFetchingNextPage}
                        className="rounded-md border border-ethereum-purple/30 px-4 py-2 text-sm text-ethereum-purple hover:bg-ethereum-purple/10 disabled:opacity-50"
                      >
                        {collection.isFetchingNextPage ? "Loading…" : "Load more"}
                      </button>
                    </div>
                  )}
                </>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setMyReady((r) => !r)}
                  disabled={!myTokenId}
                  className={cn(
                    "rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
                    myReady
                      ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                      : "bg-ethereum-purple text-ethereum-black hover:bg-ethereum-purple/90",
                  )}
                >
                  {myReady
                    ? "Ready ✓ (tap to unready)"
                    : myTokenId
                      ? `Ready up with #${myTokenId}`
                      : "Pick a fighter first"}
                </button>
                <span className="text-xs text-muted-foreground">
                  {host?.ready && guest?.ready
                    ? "Both ready — starting…"
                    : guest
                      ? "Waiting for both fighters to ready up."
                      : "Waiting for a challenger to join…"}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The host sets the match seed, so neither side can grind a
                favourable roll.
              </p>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-4 pb-20">
      <section className="py-12">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-ethereum-purple/30 bg-ethereum-purple/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-ethereum-purple">
          <Swords className="h-3.5 w-3.5" /> Combat Live
        </p>
        <h1 className="text-3xl font-semibold">Live Arena</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Two players, two T00ns, one best-of-{BEST_OF} — in real time. Create a
          room, share the link, each side picks any T00n from the collection,
          ready up, and battle.
        </p>
      </section>
      {children}
    </div>
  );
}

function SeatCard({
  seat,
  label,
  you,
}: {
  seat: SeatState | null;
  label: string;
  you: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        seat ? "border-border/60 bg-card/60" : "border-dashed border-border/60",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
          {you && " · you"}
        </span>
        {seat?.ready && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <Check className="h-3.5 w-3.5" /> ready
          </span>
        )}
      </div>
      {seat ? (
        <div className="flex items-center gap-2">
          <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-border">
            {seat.tokenId ? (
              <NFTMedia
                imageUrl={seat.image}
                alt={`#${seat.tokenId}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                ?
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {seat.tokenId ? `T00n #${seat.tokenId}` : "picking…"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{seat.name}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting…</p>
      )}
    </div>
  );
}
