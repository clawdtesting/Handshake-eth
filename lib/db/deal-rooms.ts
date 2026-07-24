import { getServiceClient } from "@/lib/supabase/server";
import type {
  DealRoom,
  DealRoomDetail,
  DealRoomDraft,
  DealRoomEvent,
  DealRoomRevision,
  DealRoomStatus,
  DeclineReason,
  RevisionNFT,
  RoomNotification,
} from "@/lib/types";

/**
 * Data layer for Deal Rooms.
 *
 * Concurrency model: `deal_rooms.version` is an optimistic lock. Every
 * mutation updates the room with `.eq("version", expectedVersion)` and
 * increments it; zero rows updated means someone else moved first → the
 * caller returns 409 and the client refreshes. Revisions are append-only.
 */

// numeric columns must round-trip as strings (see lib/db/offers.ts).
const REVISION_SELECT =
  "*, maker_mon_amount::text, taker_mon_amount::text, flat_fee::text, deal_room_revision_nfts(*, token_id::text), deal_room_acceptances(wallet_address)";

function mapRevisionNft(row: any): RevisionNFT {
  return {
    contractAddress: row.contract_address,
    tokenId: row.token_id,
    side: row.side,
    collectionName: row.collection_name,
    name: row.name,
    imageUrl: row.image_url,
    rarityRank: row.rarity_rank ?? null,
  };
}

function mapRevision(row: any): DealRoomRevision {
  const nfts: any[] = row.deal_room_revision_nfts ?? [];
  const sorted = [...nfts].sort((a, b) => a.item_position - b.item_position);
  return {
    id: row.id,
    roomId: row.room_id,
    revisionNumber: row.revision_number,
    proposedBy: row.proposed_by,
    makerAddress: row.maker_address,
    takerAddress: row.taker_address,
    makerNFTs: sorted.filter((n) => n.side === "maker").map(mapRevisionNft),
    takerNFTs: sorted.filter((n) => n.side === "taker").map(mapRevisionNft),
    makerEthAmount: row.maker_mon_amount,
    takerEthAmount: row.taker_mon_amount,
    feeBps: row.fee_bps,
    flatFee: row.flat_fee,
    offerExpiry: Number(row.offer_expiry),
    termsHash: row.terms_hash,
    note: row.note,
    createdAt: row.created_at,
    acceptedBy: (row.deal_room_acceptances ?? []).map(
      (a: any) => a.wallet_address
    ),
  };
}

export function mapRoom(row: any): DealRoom {
  return {
    id: row.id,
    chainId: row.chain_id,
    participantA: row.participant_a,
    participantB: row.participant_b,
    initiatedBy: row.initiated_by,
    sourceOfferId: row.source_offer_id,
    sourceWantedPostId: row.source_wanted_post_id,
    finalOfferId: row.final_offer_id,
    currentRevisionId: row.current_revision_id,
    status: row.status,
    version: Number(row.version),
    declinedBy: row.declined_by,
    declineReason: row.decline_reason,
    signedAt: row.signed_at,
    settledAt: row.settled_at,
    expiresAt: row.expires_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: any): DealRoomEvent {
  return {
    id: row.id,
    roomId: row.room_id,
    revisionId: row.revision_id,
    actor: row.actor,
    eventType: row.event_type,
    body: row.body,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export function isParticipant(room: DealRoom, wallet: string): boolean {
  const w = wallet.toLowerCase();
  return room.participantA === w || room.participantB === w;
}

export function counterpartyOf(room: DealRoom, wallet: string): string {
  const w = wallet.toLowerCase();
  return room.participantA === w ? room.participantB : room.participantA;
}

export function orderedPair(a: string, b: string): [string, string] {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x < y ? [x, y] : [y, x];
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function getRoomRow(
  id: string
): Promise<(DealRoom & { realtimeToken: string }) | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("deal_rooms")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...mapRoom(data), realtimeToken: data.realtime_token };
}

export async function getRoomDetail(
  id: string
): Promise<DealRoomDetail | null> {
  const db = getServiceClient();
  const room = await getRoomRow(id);
  if (!room) return null;

  const [{ data: revs, error: revErr }, { data: events, error: evErr }] =
    await Promise.all([
      db
        .from("deal_room_revisions")
        .select(REVISION_SELECT)
        .eq("room_id", id)
        .order("revision_number", { ascending: false }),
      db
        .from("deal_room_events")
        .select("*")
        .eq("room_id", id)
        .order("created_at", { ascending: true })
        .limit(200),
    ]);
  if (revErr) throw revErr;
  if (evErr) throw evErr;

  const revisions = (revs ?? []).map(mapRevision);
  return {
    ...room,
    currentRevision:
      revisions.find((r) => r.id === room.currentRevisionId) ?? null,
    revisions,
    events: (events ?? []).map(mapEvent),
  };
}

export async function listRoomsForWallet(
  wallet: string,
  limit = 50
): Promise<Array<DealRoom & { currentRevision: DealRoomRevision | null }>> {
  const db = getServiceClient();
  const w = wallet.toLowerCase();
  const { data, error } = await db
    .from("deal_rooms")
    .select(`*, current:deal_room_revisions!fk_deal_rooms_current_revision(${REVISION_SELECT})`)
    .or(`participant_a.eq.${w},participant_b.eq.${w}`)
    .order("last_activity_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...mapRoom(row),
    currentRevision: row.current ? mapRevision(row.current) : null,
  }));
}

export async function findActiveRoomForSource(
  chainId: number,
  a: string,
  b: string,
  sourceOfferId: string
): Promise<DealRoom | null> {
  const db = getServiceClient();
  const [pa, pb] = orderedPair(a, b);
  const { data, error } = await db
    .from("deal_rooms")
    .select("*")
    .eq("chain_id", chainId)
    .eq("participant_a", pa)
    .eq("participant_b", pb)
    .eq("source_offer_id", sourceOfferId)
    .in("status", ["open", "agreed", "signed"])
    .maybeSingle();
  if (error) throw error;
  return data ? mapRoom(data) : null;
}

export async function getRoomByFinalOffer(
  finalOfferId: string
): Promise<DealRoom | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("deal_rooms")
    .select("*")
    .eq("final_offer_id", finalOfferId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRoom(data) : null;
}

export async function listRoomsBySourceOffer(
  sourceOfferId: string
): Promise<DealRoom[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("deal_rooms")
    .select("*")
    .eq("source_offer_id", sourceOfferId)
    .in("status", ["open", "agreed", "signed"]);
  if (error) throw error;
  return (data ?? []).map(mapRoom);
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

async function insertRevisionRows(
  roomId: string,
  revisionNumber: number,
  proposedBy: string,
  draft: DealRoomDraft,
  hash: string,
  note: string | null
): Promise<DealRoomRevision> {
  const db = getServiceClient();
  const { data: rev, error } = await db
    .from("deal_room_revisions")
    .insert({
      room_id: roomId,
      revision_number: revisionNumber,
      proposed_by: proposedBy.toLowerCase(),
      maker_address: draft.makerAddress.toLowerCase(),
      taker_address: draft.takerAddress.toLowerCase(),
      maker_mon_amount: draft.makerEthAmount,
      taker_mon_amount: draft.takerEthAmount,
      fee_bps: draft.feeBps,
      flat_fee: draft.flatFee,
      offer_expiry: draft.offerExpiry,
      terms_hash: hash,
      note,
    })
    .select("*, maker_mon_amount::text, taker_mon_amount::text, flat_fee::text")
    .single();
  if (error) throw error;

  const nftRows = [
    ...draft.makerNFTs.map((n, i) => ({ ...n, side: "maker" as const, item_position: i })),
    ...draft.takerNFTs.map((n, i) => ({ ...n, side: "taker" as const, item_position: i })),
  ].map((n) => ({
    revision_id: rev.id,
    side: n.side,
    item_position: n.item_position,
    contract_address: n.contractAddress.toLowerCase(),
    token_id: n.tokenId,
    collection_name: n.collectionName ?? null,
    name: n.name ?? null,
    image_url: n.imageUrl ?? null,
    rarity_rank: n.rarityRank ?? null,
  }));
  if (nftRows.length > 0) {
    const { error: nftError } = await db
      .from("deal_room_revision_nfts")
      .insert(nftRows);
    if (nftError) {
      await db.from("deal_room_revisions").delete().eq("id", rev.id);
      throw nftError;
    }
  }
  return mapRevision({
    ...rev,
    deal_room_revision_nfts: nftRows,
    deal_room_acceptances: [],
  });
}

export class RoomConflictError extends Error {
  constructor(message = "Room was modified concurrently") {
    super(message);
    this.name = "RoomConflictError";
  }
}

export class DuplicateTermsError extends Error {
  constructor(message = "Identical terms were already proposed in this room") {
    super(message);
    this.name = "DuplicateTermsError";
  }
}

/**
 * Compare-and-swap update on the room row. Throws RoomConflictError when the
 * expected version no longer matches (someone else mutated first).
 */
async function casRoom(
  roomId: string,
  expectedVersion: number,
  patch: Record<string, unknown>
): Promise<DealRoom> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("deal_rooms")
    .update({
      ...patch,
      version: expectedVersion + 1,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", roomId)
    .eq("version", expectedVersion)
    .select("*");
  if (error) throw error;
  if (!data || data.length === 0) throw new RoomConflictError();
  return mapRoom(data[0]);
}

export async function createRoom(p: {
  chainId: number;
  initiatedBy: string;
  counterparty: string;
  sourceOfferId: string | null;
  sourceWantedPostId: string | null;
  expiresAt: Date;
  draft: DealRoomDraft;
  termsHash: string;
  note: string | null;
}): Promise<{ room: DealRoom & { realtimeToken: string }; revision: DealRoomRevision }> {
  const db = getServiceClient();
  const [pa, pb] = orderedPair(p.initiatedBy, p.counterparty);
  const { data: roomRow, error } = await db
    .from("deal_rooms")
    .insert({
      chain_id: p.chainId,
      participant_a: pa,
      participant_b: pb,
      initiated_by: p.initiatedBy.toLowerCase(),
      source_offer_id: p.sourceOfferId,
      source_wanted_post_id: p.sourceWantedPostId,
      status: "open",
      expires_at: p.expiresAt.toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;

  try {
    const revision = await insertRevisionRows(
      roomRow.id,
      1,
      p.initiatedBy,
      p.draft,
      p.termsHash,
      p.note
    );
    await casRoom(roomRow.id, 1, { current_revision_id: revision.id });
    await recordRoomEvent(roomRow.id, "room_created", p.initiatedBy, revision.id);
    const room = await getRoomRow(roomRow.id);
    return { room: room!, revision };
  } catch (err) {
    await db.from("deal_rooms").delete().eq("id", roomRow.id);
    throw err;
  }
}

/**
 * Appends a revision, points the room at it, and clears the agreement state:
 * the new revision starts with only the proposer's implicit acceptance —
 * recorded explicitly so "agreed by you, waiting on them" renders correctly.
 */
export async function proposeRevision(p: {
  room: DealRoom;
  expectedVersion: number;
  proposedBy: string;
  draft: DealRoomDraft;
  termsHash: string;
  note: string | null;
}): Promise<{ room: DealRoom; revision: DealRoomRevision }> {
  const db = getServiceClient();

  // CAS first: bump the version before inserting so two simultaneous
  // proposers can't both append (loser gets 409 before touching revisions).
  const room = await casRoom(p.room.id, p.expectedVersion, {
    status: "open",
  });

  let revision: DealRoomRevision;
  try {
    const { data: maxRow } = await db
      .from("deal_room_revisions")
      .select("revision_number")
      .eq("room_id", p.room.id)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNumber = (maxRow?.revision_number ?? 0) + 1;
    revision = await insertRevisionRows(
      p.room.id,
      nextNumber,
      p.proposedBy,
      p.draft,
      p.termsHash,
      p.note
    );
  } catch (err: any) {
    if (err?.code === "23505") throw new DuplicateTermsError();
    throw err;
  }

  const updated = await casRoom(p.room.id, room.version, {
    current_revision_id: revision.id,
  });

  // Proposer implicitly accepts their own terms.
  await db.from("deal_room_acceptances").insert({
    revision_id: revision.id,
    wallet_address: p.proposedBy.toLowerCase(),
  });
  revision.acceptedBy = [p.proposedBy.toLowerCase()];

  await recordRoomEvent(
    p.room.id,
    "revision_proposed",
    p.proposedBy,
    revision.id,
    p.note
  );
  return { room: updated, revision };
}

/**
 * Records `wallet`'s acceptance of the current revision. When both
 * participants have accepted, the room transitions to `agreed`.
 */
export async function agreeToRevision(p: {
  room: DealRoom;
  expectedVersion: number;
  revisionId: string;
  wallet: string;
}): Promise<{ room: DealRoom; bothAgreed: boolean }> {
  const db = getServiceClient();
  if (p.room.currentRevisionId !== p.revisionId) {
    throw new RoomConflictError("A newer revision exists");
  }

  const { error: insErr } = await db.from("deal_room_acceptances").upsert(
    {
      revision_id: p.revisionId,
      wallet_address: p.wallet.toLowerCase(),
    },
    { onConflict: "revision_id,wallet_address" }
  );
  if (insErr) throw insErr;

  const { data: acceptances, error: accErr } = await db
    .from("deal_room_acceptances")
    .select("wallet_address")
    .eq("revision_id", p.revisionId);
  if (accErr) throw accErr;

  const wallets = new Set((acceptances ?? []).map((a: any) => a.wallet_address));
  const bothAgreed =
    wallets.has(p.room.participantA) && wallets.has(p.room.participantB);

  const room = await casRoom(p.room.id, p.expectedVersion, {
    ...(bothAgreed ? { status: "agreed" } : {}),
  });

  await recordRoomEvent(
    p.room.id,
    bothAgreed ? "room_agreed" : "revision_agreed",
    p.wallet,
    p.revisionId
  );
  return { room, bothAgreed };
}

export async function setRoomStatus(p: {
  roomId: string;
  expectedVersion: number;
  status: DealRoomStatus;
  patch?: Record<string, unknown>;
  eventType?: string;
  actor?: string | null;
  eventBody?: string | null;
}): Promise<DealRoom> {
  const room = await casRoom(p.roomId, p.expectedVersion, {
    status: p.status,
    ...(p.patch ?? {}),
  });
  if (p.eventType) {
    await recordRoomEvent(p.roomId, p.eventType, p.actor ?? null, null, p.eventBody ?? null);
  }
  return room;
}

export async function declineRoom(p: {
  room: DealRoom;
  expectedVersion: number;
  wallet: string;
  reason: DeclineReason;
}): Promise<DealRoom> {
  return setRoomStatus({
    roomId: p.room.id,
    expectedVersion: p.expectedVersion,
    status: "declined",
    patch: { declined_by: p.wallet.toLowerCase(), decline_reason: p.reason },
    eventType: "room_declined",
    actor: p.wallet,
    eventBody: p.reason,
  });
}

/** Status changes driven by verified on-chain facts — no version gate (last write wins on truth). */
export async function forceRoomStatus(
  roomId: string,
  status: DealRoomStatus,
  patch: Record<string, unknown> = {},
  eventType?: string,
  eventBody?: string | null
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from("deal_rooms")
    .update({ ...patch, status, last_activity_at: new Date().toISOString() })
    .eq("id", roomId);
  if (error) throw error;
  if (eventType) {
    await recordRoomEvent(roomId, eventType, null, null, eventBody ?? null);
  }
}

export async function recordRoomEvent(
  roomId: string,
  eventType: string,
  actor: string | null,
  revisionId: string | null = null,
  body: string | null = null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("deal_room_events").insert({
    room_id: roomId,
    revision_id: revisionId,
    actor: actor?.toLowerCase() ?? null,
    event_type: eventType,
    body,
    metadata,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------

export async function createNotification(p: {
  recipient: string;
  type: string;
  roomId?: string | null;
  offerId?: string | null;
  actor?: string | null;
  title: string;
  body: string;
  actionPath: string;
  dedupeKey: string;
}): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("notifications").upsert(
    {
      recipient_wallet: p.recipient.toLowerCase(),
      notification_type: p.type,
      room_id: p.roomId ?? null,
      offer_id: p.offerId ?? null,
      actor_wallet: p.actor?.toLowerCase() ?? null,
      title: p.title.slice(0, 120),
      body: p.body.slice(0, 280),
      action_path: p.actionPath,
      dedupe_key: p.dedupeKey,
    },
    { onConflict: "dedupe_key", ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function listNotifications(
  wallet: string,
  unreadOnly: boolean,
  limit = 50
): Promise<RoomNotification[]> {
  const db = getServiceClient();
  let query = db
    .from("notifications")
    .select("*")
    .eq("recipient_wallet", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    recipientWallet: row.recipient_wallet,
    notificationType: row.notification_type,
    roomId: row.room_id,
    offerId: row.offer_id,
    actorWallet: row.actor_wallet,
    title: row.title,
    body: row.body,
    actionPath: row.action_path,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function markNotificationRead(
  wallet: string,
  id: string
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient_wallet", wallet.toLowerCase());
  if (error) throw error;
}

export async function markAllNotificationsRead(wallet: string): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_wallet", wallet.toLowerCase())
    .is("read_at", null);
  if (error) throw error;
}
