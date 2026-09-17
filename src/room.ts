import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
  type Unsubscribe,
} from "firebase/database";
import type {
  AnswerRecord,
  DiagnosticRecord,
  GameMode,
  GameRecord,
  PlayerRecord,
  ReadinessRecord,
  RoomMeta,
  RoomRecord,
} from "./types";
import { POC_COUNTDOWN_MS, POC_DURATION_MS, POC_MAX_PLAYERS, POC_MIN_PLAYERS } from "./timing";
import { POC_QUESTION } from "./question";
import { firstAnswerOrAbort, nextAuthorityTransition } from "./protocol";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function roomPath(roomId: string): string {
  return `rooms/${roomId}`;
}

function randomToken(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

async function appendEvent(
  database: Database,
  roomId: string,
  roundId: string,
  event: string,
  at: number,
): Promise<void> {
  const eventRef = push(ref(database, `${roomPath(roomId)}/events/${roundId}`));
  await set(eventRef, { event, at });
}

export async function createRoom(
  database: Database,
  uid: string,
  displayName: string,
  now: number,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = randomToken(6);
    const meta: RoomMeta = {
      authorityUid: uid,
      createdAt: now,
      pocMaxPlayers: POC_MAX_PLAYERS,
    };
    const result = await runTransaction(ref(database, `${roomPath(roomId)}/meta`), (current) =>
      current === null ? meta : undefined,
    );
    if (!result.committed) continue;

    const player: PlayerRecord = {
      displayName,
      active: true,
      joinedAt: now,
      lastSeenAt: now,
    };
    const game: GameRecord = {
      state: "LOBBY",
      lastEvent: "room-created",
      lastEventAt: now,
    };
    await Promise.all([
      set(ref(database, `${roomPath(roomId)}/players/${uid}`), player),
      set(ref(database, `${roomPath(roomId)}/game`), game),
    ]);
    return roomId;
  }
  throw new Error("Could not allocate a unique room code.");
}

export async function joinRoom(
  database: Database,
  roomIdInput: string,
  uid: string,
  displayName: string,
  now: number,
): Promise<string> {
  const roomId = normalizeRoomId(roomIdInput);
  const metaSnapshot = await get(ref(database, `${roomPath(roomId)}/meta`));
  if (!metaSnapshot.exists()) throw new Error("Room not found.");

  const playersRef = ref(database, `${roomPath(roomId)}/players`);
  let roomFull = false;
  const result = await runTransaction(playersRef, (current: Record<string, PlayerRecord> | null) => {
    const players = current ?? {};
    const existing = players[uid];
    const activeCount = Object.values(players).filter((player) => player.active).length;
    if ((!existing || !existing.active) && activeCount >= POC_MAX_PLAYERS) {
      roomFull = true;
      return;
    }
    return {
      ...players,
      [uid]: {
        displayName,
        active: true,
        joinedAt: existing?.joinedAt ?? now,
        lastSeenAt: now,
      },
    };
  });

  if (!result.committed) {
    throw new Error(roomFull ? "Room already has four active POC clients." : "Could not join room.");
  }
  return roomId;
}

export async function configurePresence(
  database: Database,
  roomId: string,
  uid: string,
  now: () => number,
): Promise<Unsubscribe> {
  const playerRef = ref(database, `${roomPath(roomId)}/players/${uid}`);
  const connectedRef = ref(database, ".info/connected");
  return onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;
    await onDisconnect(playerRef).update({
      active: false,
      disconnectedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
    await update(playerRef, { active: true, lastSeenAt: now() });
  });
}

export function subscribeToServerOffset(
  database: Database,
  listener: (offsetMs: number) => void,
): Unsubscribe {
  return onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    listener(typeof snapshot.val() === "number" ? snapshot.val() : 0);
  });
}

export function subscribeToRoom(
  database: Database,
  roomId: string,
  listener: (room: RoomRecord | null) => void,
): Unsubscribe {
  return onValue(ref(database, roomPath(roomId)), (snapshot) => {
    listener(snapshot.exists() ? (snapshot.val() as RoomRecord) : null);
  });
}

export async function prepareRound(
  database: Database,
  roomId: string,
  authorityUid: string,
  mode: GameMode,
  now: number,
): Promise<string> {
  const roomSnapshot = await get(ref(database, roomPath(roomId)));
  const room = roomSnapshot.val() as RoomRecord | null;
  if (!room || room.meta.authorityUid !== authorityUid) throw new Error("Only the room authority can prepare a round.");

  const activeIds = Object.entries(room.players ?? {})
    .filter(([, player]) => player.active)
    .map(([uid]) => uid);
  if (activeIds.length < POC_MIN_PLAYERS || activeIds.length > POC_MAX_PLAYERS) {
    throw new Error("The POC requires 2–4 active clients.");
  }

  const roundId = `${now}-${randomToken(4)}`;
  const game: GameRecord = {
    state: "PREPARING",
    mode,
    questionId: POC_QUESTION.id,
    preparationId: roundId,
    roundId,
    participantIds: Object.fromEntries(activeIds.map((uid) => [uid, true])),
    durationMs: POC_DURATION_MS,
    countdownMs: POC_COUNTDOWN_MS,
    prepareStartedAt: now,
    lastEvent: "prepare-question",
    lastEventAt: now,
  };
  await set(ref(database, `${roomPath(roomId)}/game`), game);
  await appendEvent(database, roomId, roundId, "PREPARING", now);
  return roundId;
}

export async function updateReadiness(
  database: Database,
  roomId: string,
  preparationId: string,
  uid: string,
  values: Partial<ReadinessRecord>,
): Promise<void> {
  await update(ref(database, `${roomPath(roomId)}/readiness/${preparationId}/${uid}`), values);
}

export async function updateDiagnostics(
  database: Database,
  roomId: string,
  roundId: string,
  uid: string,
  values: Partial<DiagnosticRecord>,
): Promise<void> {
  await update(ref(database, `${roomPath(roomId)}/diagnostics/${roundId}/${uid}`), values);
}

export async function submitAnswer(
  database: Database,
  roomId: string,
  roundId: string,
  uid: string,
  choiceId: string,
  now: number,
): Promise<boolean> {
  const answer: AnswerRecord = { choiceId, submittedAt: now };
  const result = await runTransaction(
    ref(database, `${roomPath(roomId)}/answers/${roundId}/${uid}`),
    (current: AnswerRecord | null) => firstAnswerOrAbort(current, answer),
  );
  return result.committed;
}

async function transitionGame(
  database: Database,
  roomId: string,
  expectedState: GameRecord["state"],
  roundId: string,
  event: string,
  now: number,
  changes: Partial<GameRecord>,
): Promise<boolean> {
  const result = await runTransaction(ref(database, `${roomPath(roomId)}/game`), (current: GameRecord | null) => {
    if (!current || current.state !== expectedState || current.roundId !== roundId) return;
    return {
      ...current,
      ...changes,
      lastEvent: event,
      lastEventAt: now,
    };
  });
  if (result.committed) await appendEvent(database, roomId, roundId, event, now);
  return result.committed;
}

export async function advanceAuthorityState(
  database: Database,
  roomId: string,
  room: RoomRecord,
  authorityUid: string,
  now: number,
): Promise<boolean> {
  if (room.meta.authorityUid !== authorityUid) return false;
  const game = room.game;
  const roundId = game.roundId;
  if (!roundId) return false;
  const transition = nextAuthorityTransition(room, now);
  if (!transition) return false;
  return transitionGame(
    database,
    roomId,
    transition.expectedState,
    roundId,
    transition.event,
    now,
    transition.changes,
  );
}
