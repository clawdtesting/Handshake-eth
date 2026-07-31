"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Check, Copy, Loader2, Swords, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NFTMedia } from "@/components/ui/nft-media";
import { Arena } from "@/components/combat/arena";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useWalletNFTs } from "@/hooks/use-market";
import { BURNT_COLLECTION_ADDRESS } from "@/lib/burnt/config";
import {
  deriveFighter,
  simulate,
  type CombatResult,
} from "@/lib/combat/engine";
import { cn, shortAddress } from "@/lib/utils";

interface SeatState {
  address: string;
  name: string;
  isHost: boolean;
  tokenId: string | null;
  image: string | null;
  ready: boolean;
  seed: number | null; // host only
  startAt: number | null; // host only
  rematch: number; // host only, bumps each rematch
}

function randomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function CombatLivePage() {
  const supa = getBrowserClient();
  const { address } = useAccount();

  const [code, setCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [joinInput, setJoinInput] = useState("");

  // My seat.
  const [myTokenId, setMyTokenId] = useState<string | null>(null);
  const [myImage, setMyImage] = useState<string | null>(null);
  const [myReady, setMyReady] = useState(false);
  // Host-only match control.
  const [hostSeed, setHostSeed] = useState<number | null>(null);
  const [hostStartAt, setHostStartAt] = useState<number | null>(null);
  const [rematch, setRematch] = useState(0);

  // Presence + playback.
  const [seats, setSeats] = useState<SeatState[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const channelRef = useRef<ReturnType<
    NonNullable<ReturnType<typeof getBrowserClient>>["channel"]
  > | null>(null);

  // Pick up a shared ?room= link.
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) {
      setCode(room.toUpperCase());
      setIsHost(false);
    }
  }, []);

  // Owned T00ns for the picker.
  const { data: walletNfts, isLoading: loadingNfts } = useWalletNFTs(address);
  const owned = useMemo(
    () =>
      (walletNfts?.nfts ?? []).filter(
        (n) => n.contractAddress.toLowerCase() === BURNT_COLLECTION_ADDRESS,
      ),
    [walletNfts],
  );

  const name = address ? shortAddress(address) : "";

  // Join/leave the realtime channel.
  useEffect(() => {
    if (!supa || !code || !address) return;
    setSubscribed(false);
    const channel = supa.channel(`combat-live:${code}`, {
      config: { presence: { key: address } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as unknown as Record<
        string,
        SeatState[]
      >;
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
  }, [supa, code, address]);

  // Broadcast my seat whenever it changes.
  const myState: SeatState = useMemo(
    () => ({
      address: address ?? "",
      name,
      isHost,
      tokenId: myTokenId,
      image: myImage,
      ready: myReady,
      seed: isHost ? hostSeed : null,
      startAt: isHost ? hostStartAt : null,
      rematch: isHost ? rematch : 0,
    }),
    [address, name, isHost, myTokenId, myImage, myReady, hostSeed, hostStartAt, rematch],
  );

  useEffect(() => {
    if (subscribed && channelRef.current) {
      channelRef.current.track(myState);
    }
  }, [subscribed, myState]);

  // Deduped seats → host/guest.
  const seatList = useMemo(() => {
    const byAddr = new Map<string, SeatState>();
    for (const s of seats) if (s?.address) byAddr.set(s.address, s);
    return [...byAddr.values()];
  }, [seats]);
  const host = seatList.find((s) => s.isHost) ?? null;
  const guest = seatList.find((s) => !s.isHost) ?? null;
  const roomFull =
    !isHost && !!guest && guest.address !== address && !!host && host.address !== address;

  // Host fires the match once both are ready.
  useEffect(() => {
    if (!isHost || hostSeed != null) return;
    if (host?.ready && guest?.ready && host?.tokenId && guest?.tokenId) {
      setHostSeed(Math.floor(Math.random() * 1_000_000_000));
      setHostStartAt(Date.now() + 1500);
    }
  }, [isHost, hostSeed, host?.ready, guest?.ready, host?.tokenId, guest?.tokenId]);

  // Both clients: begin the fight from the host's seed/startAt.
  const activeSeed = host?.seed ?? null;
  const activeStart = host?.startAt ?? null;
  const activeRematch = host?.rematch ?? 0;
  const idA = host?.tokenId ?? null;
  const idB = guest?.tokenId ?? null;
  const imageA = host?.image ?? null;
  const imageB = guest?.image ?? null;

  const result = useMemo<CombatResult | null>(() => {
    if (activeSeed == null || !idA || !idB) return null;
    return simulate(deriveFighter(idA), deriveFighter(idB), activeSeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeed, idA, idB, activeRematch]);

  useEffect(() => {
    if (activeSeed == null || activeStart == null || !result) return;
    setIdx(0);
    setRunning(false);
    const t = setTimeout(() => setRunning(true), Math.max(0, activeStart - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeed, activeStart, activeRematch, result]);

  useEffect(() => {
    if (!result || !running || idx >= result.events.length) return;
    const t = setTimeout(() => setIdx((i) => i + 1), 650);
    return () => clearTimeout(t);
  }, [result, running, idx]);

  const done = !!result && idx >= result.events.length;
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
    setRematch(0);
    setIdx(0);
    setRunning(false);
    window.history.replaceState({}, "", window.location.pathname);
  }
  function pick(tokenId: string, image: string | null) {
    if (myReady) return;
    setMyTokenId(tokenId);
    setMyImage(image);
  }
  function doRematch() {
    if (!isHost) return;
    setHostSeed(Math.floor(Math.random() * 1_000_000_000));
    setHostStartAt(Date.now() + 1200);
    setRematch((r) => r + 1);
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
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then reload. (Single-player
            Combat works without it.)
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!address) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Connect your wallet to battle with a T00n you own.
            </p>
            <ConnectButton />
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
        <button
          onClick={leaveRoom}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
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
          {/* Seats */}
          <div className="grid grid-cols-2 gap-3">
            <SeatCard seat={host} label="Host" you={host?.address === address} />
            <SeatCard seat={guest} label="Challenger" you={guest?.address === address} />
          </div>

          {/* Fight or lobby */}
          {result ? (
            <div className="mt-6">
              <Arena
                result={result}
                idx={idx}
                lastEvent={lastEvent}
                done={done}
                nameOf={(id) => `#${id}`}
                imageA={imageA}
                imageB={imageB}
                hideControls
              />
              <div className="mt-4 flex items-center justify-center gap-3">
                {!done && !running && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Fight starting…
                  </span>
                )}
                {done && isHost && (
                  <button
                    onClick={doRematch}
                    className="flex items-center gap-1.5 rounded-md bg-ethereum-purple/15 px-4 py-2 text-sm text-ethereum-purple hover:bg-ethereum-purple/25"
                  >
                    <Swords className="h-4 w-4" /> Rematch
                  </button>
                )}
                {done && !isHost && (
                  <span className="text-sm text-muted-foreground">
                    Waiting for host to rematch…
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                Pick your T00n
              </h2>
              {loadingNfts ? (
                <p className="text-sm text-muted-foreground">Loading your T00ns…</p>
              ) : owned.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No T00ns found in this wallet — you need to own one to battle.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
                  {owned.map((n) => (
                    <button
                      key={n.tokenId}
                      onClick={() => pick(n.tokenId, n.imageUrl ?? null)}
                      disabled={myReady}
                      className={cn(
                        "overflow-hidden rounded-lg border text-left transition-all disabled:opacity-60",
                        myTokenId === n.tokenId
                          ? "border-ethereum-purple ring-2 ring-ethereum-purple/50"
                          : "border-border/60 hover:border-ethereum-purple/40",
                      )}
                    >
                      <span className="block aspect-square w-full bg-white/[0.03]">
                        <NFTMedia
                          imageUrl={n.imageUrl}
                          alt={`#${n.tokenId}`}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="block truncate p-1.5 text-xs">#{n.tokenId}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
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
                  {myReady ? "Ready ✓ (tap to unready)" : "Ready up"}
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
          Two wallets, two T00ns, one fight — in real time. Create a room, share
          the link, each side brings a T00n they own, ready up, and battle.
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
      <div className="mb-2 flex items-center justify-between">
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
