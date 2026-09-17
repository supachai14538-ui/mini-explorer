import type { GameMode, GameRecord } from "./types";

export const POC_DURATION_MS = 30_000;
export const POC_COUNTDOWN_MS = 3_000;
export const POC_MAX_PLAYERS = 4;
export const POC_MIN_PLAYERS = 2;
export const BLINK_INTERVAL_MS = 5_000;

export function sharedNow(localNow: number, serverOffsetMs: number): number {
  return localNow + serverOffsetMs;
}

export function millisecondsUntilReveal(now: number, revealAt?: number): number | null {
  if (revealAt === undefined) return null;
  return Math.max(0, revealAt - now);
}

export function millisecondsRemaining(
  now: number,
  revealAt?: number,
  durationMs = POC_DURATION_MS,
): number | null {
  if (revealAt === undefined) return null;
  return Math.max(0, revealAt + durationMs - now);
}

export function hasRevealTimeArrived(now: number, revealAt?: number): boolean {
  return revealAt !== undefined && now >= revealAt;
}

export function isBlinkImageVisible(now: number, revealAt: number): boolean {
  if (now < revealAt || now >= revealAt + POC_DURATION_MS) return false;
  const elapsed = now - revealAt;
  return Math.floor(elapsed / BLINK_INTERVAL_MS) % 2 === 0;
}

export function isQuestionImageVisible(
  mode: GameMode,
  now: number,
  revealAt?: number,
  state?: GameRecord["state"],
): boolean {
  if (state === "RESULT") return true;
  if (revealAt === undefined || now < revealAt) return false;
  if (mode === "blink") return isBlinkImageVisible(now, revealAt);
  return true;
}

export function areChoicesVisible(now: number, revealAt?: number): boolean {
  return revealAt !== undefined && now >= revealAt;
}

export function allParticipantsReady(
  participantIds: Record<string, true> | undefined,
  readiness: Record<string, { readyAt?: number }> | undefined,
): boolean {
  const ids = Object.keys(participantIds ?? {});
  return ids.length > 0 && ids.every((uid) => Boolean(readiness?.[uid]?.readyAt));
}

export function allParticipantsAnswered(
  participantIds: Record<string, true> | undefined,
  answers: Record<string, unknown> | undefined,
): boolean {
  const ids = Object.keys(participantIds ?? {});
  return ids.length > 0 && ids.every((uid) => answers?.[uid] !== undefined);
}
