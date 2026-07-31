"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Check, Copy, Loader2, ShieldCheck, ShieldAlert, Swords, Trophy, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NFTMedia } from "@/components/ui/nft-media";
import { Arena } from "@/components/combat/arena";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useWalletNFTs } from "@/hooks/use-market";
import { BURNT_COLLECTION_ADDRESS } from "@/lib/burnt/config";
import { deriveFighter, simulate, type CombatResult } from "@/lib/combat/engine";
import { cn, shortAddress } from "@/lib/utils";

const BEST_OF = 3;
const WINS_NEEDED = Math.ceil(BEST_OF / 2); // 2

interface SeatState {
  address: string;
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

type Verdict = "checking" | "ok" | "bad";

function randomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function verifyOwner(token: string, owner: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/combat/owner?token=${token}&owner=${owner}`);
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.owned;
  } catch {
    return false;
  }
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
  const [verify, setVerify] = useState<Record<string, Verdict>>({});

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
  }, [supa, code, address]);

  // Broadcast my seat.
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
      round: isHost ? round : 0,
      winsA: isHost ? winsA : 0,
      winsB: isHost ? winsB : 0,
    }),
    [address, name, isHost, myTokenId, myImage, myReady, hostSeed, hostStartAt, round, winsA, winsB],
  );
  useEffect(() => {
    if (subscribed && channelRef.current) channelRef.current.track(myState);
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

  // --- ownership verification ---
  const keyFor = (s: SeatState | null) =>
    s && s.tokenId ? `${s.address}:${s.tokenId}` : null;
  const myKey = address && myTokenId ? `${address}:${myTokenId}` : null;
  const hostKey = keyFor(host);
  const guestKey = keyFor(guest);
  const mineOk = myKey ? verify[myKey] === "ok" : false;
  const bothVerified =
    !!hostKey && !!guestKey && verify[hostKey] === "ok" && verify[guestKey] === "ok";
  const someBad =
    (hostKey && verify[hostKey] === "bad") || (guestKey && verify[guestKey] === "bad");

  // Verify my own pick (gates ready-up).
  useEffect(() => {
    if (!myKey || !address || !myTokenId) return;
    if (verify[myKey]) return;
    setVerify((v) => ({ ...v, [myKey]: "checking" }));
    verifyOwner(myTokenId, address).then((ok) =>
      setVerify((v) => ({ ...v, [myKey]: ok ? "ok" : "bad" })),
    );
  }, [myKey, address, myTokenId, verify]);

  // Verify each seat that has locked in a token (defends against a tampered
  // client claiming a token it doesn't own).
  useEffect(() => {
    for (const s of [host, guest]) {
      const k = keyFor(s);
      if (!s || !k || verify[k]) continue;
      setVerify((v) => ({ ...v, [k]: "checking" }));
      verifyOwner(s.tokenId!, s.address).then((ok) =>
        setVerify((v) => ({ ...v, [k]: ok ? "ok" : "bad" })),
      );
    }
  }, [hostKey, guestKey, host, guest, verify]);

  // Host starts round 1 once both are ready AND provably own their T00n.
  useEffect(() => {
    if (!isHost || round !== 0 || matchOver) return;
    if (host?.ready && guest?.ready && host?.tokenId && guest?.tokenId && bothVerified) {
      setHostSeed(Math.floor(Math.random() * 1_000_000_000));
      setHostStartAt(Date.now() + 1500);
      setRound(1);
    }
  }, [isHost, round, matchOver, host?.ready, guest?.ready, host?.tokenId, guest?.tokenId, bothVerified]);

  const result = useMemo<CombatResult | null>(() => {
    if (activeSeed == null || !idA || !idB) return null;
    return simulate(deriveFighter(idA), deriveFighter(idB), activeSeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeed, idA, idB, activeRound]);

  // Begin the round (both clients), gated on verification.
  useEffect(() => {
    if (activeSeed == null || activeStart == null || !result || !bothVerified) return;
    setIdx(0);
    setRunning(false);
    const t = setTimeout(() => setRunning(true), Math.max(0, activeStart - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeed, activeStart, activeRound, result, bothVerified]);

  useEffect(() => {
    if (!result || !running || idx >= result.events.length) return;
    const t = setTimeout(() => setIdx((i) => i + 1), 650);
    return () => clearTimeout(t);
  }, [result, running, idx]);

  const done = !!result && idx >= result.events.length;

  // Host tallies the round winner exactly once.
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

  const inSeries = activeRound >= 1;
  const matchWinnerId =
    sWinsA >= WINS_NEEDED ? idA : sWinsB >= WINS_NEEDED ? idB : null;

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
            <SeatCard
              seat={host}
              label="Host"
              you={host?.address === address}
              verdict={hostKey ? verify[hostKey] : undefined}
            />
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
            <SeatCard
              seat={guest}
              label="Challenger"
              you={guest?.address === address}
              verdict={guestKey ? verify[guestKey] : undefined}
            />
          </div>

          {someBad && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              <ShieldAlert className="h-4 w-4" /> A fighter doesn&apos;t own the
              T00n they picked — the match can&apos;t start.
            </div>
          )}

          {inSeries && result ? (
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
              />
              <div className="mt-4 flex items-center justify-center gap-3">
                {!done && !running && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Round {activeRound}{" "}
                    starting…
                  </span>
                )}
                {done && !matchOver && isHost && (
                  <button
                    onClick={nextRound}
                    className="flex items-center gap-1.5 rounded-md bg-ethereum-purple/15 px-4 py-2 text-sm text-ethereum-purple hover:bg-ethereum-purple/25"
                  >
                    <Swords className="h-4 w-4" /> Next round
                  </button>
                )}
                {done && matchOver && isHost && (
                  <button
                    onClick={newMatch}
                    className="flex items-center gap-1.5 rounded-md bg-ethereum-purple/15 px-4 py-2 text-sm text-ethereum-purple hover:bg-ethereum-purple/25"
                  >
                    <Swords className="h-4 w-4" /> New match
                  </button>
                )}
                {done && !isHost && (
                  <span className="text-sm text-muted-foreground">
                    Waiting for host…
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

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setMyReady((r) => !r)}
                  disabled={!myTokenId || (!myReady && !mineOk)}
                  className={cn(
                    "rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
                    myReady
                      ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                      : "bg-ethereum-purple text-ethereum-black hover:bg-ethereum-purple/90",
                  )}
                >
                  {myReady ? "Ready ✓ (tap to unready)" : "Ready up"}
                </button>
                {myTokenId && !mineOk && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {myKey && verify[myKey] === "bad" ? (
                      <>
                        <ShieldAlert className="h-3.5 w-3.5 text-red-400" /> You
                        don&apos;t own #{myTokenId}
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying
                        ownership…
                      </>
                    )}
                  </span>
                )}
                {mineOk && !myReady && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" /> Ownership verified
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {host?.ready && guest?.ready
                    ? bothVerified
                      ? "Both ready — starting…"
                      : "Verifying ownership…"
                    : guest
                      ? "Waiting for both fighters to ready up."
                      : "Waiting for a challenger to join…"}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Ownership is checked on-chain, and the host sets the match seed —
                no grinding a favourable roll.
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
          Two wallets, two T00ns, one best-of-{BEST_OF} — in real time. Create a
          room, share the link, each side brings a T00n they own, ready up, and
          battle.
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
  verdict,
}: {
  seat: SeatState | null;
  label: string;
  you: boolean;
  verdict?: Verdict;
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
        <span className="flex items-center gap-1.5">
          {verdict === "ok" && <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
          {verdict === "bad" && <ShieldAlert className="h-3.5 w-3.5 text-red-400" />}
          {seat?.ready && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Check className="h-3.5 w-3.5" /> ready
            </span>
          )}
        </span>
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
