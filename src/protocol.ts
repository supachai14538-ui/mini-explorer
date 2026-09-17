import type { AnswerRecord, GameRecord, RoomRecord } from "./types";
import {
  POC_COUNTDOWN_MS,
  POC_DURATION_MS,
  allParticipantsAnswered,
  allParticipantsReady,
} from "./timing";

export interface AuthorityTransition {
  expectedState: GameRecord["state"];
  event: GameRecord["state"];
  changes: Partial<GameRecord> & { state: GameRecord["state"] };
}

export function firstAnswerOrAbort(
  current: AnswerRecord | null,
  candidate: AnswerRecord,
): AnswerRecord | undefined {
  return current === null ? candidate : undefined;
}

export function nextAuthorityTransition(room: RoomRecord, now: number): AuthorityTransition | null {
  const game = room.game;
  const roundId = game.roundId;
  if (!roundId) return null;

  if (game.state === "PREPARING") {
    const readiness = room.readiness?.[game.preparationId ?? ""];
    if (!allParticipantsReady(game.participantIds, readiness)) return null;
    return {
      expectedState: "PREPARING",
      event: "ALL_READY",
      changes: { state: "ALL_READY", allReadyAt: now },
    };
  }

  if (game.state === "ALL_READY") {
    return {
      expectedState: "ALL_READY",
      event: "COUNTDOWN",
      changes: {
        state: "COUNTDOWN",
        revealAt: now + (game.countdownMs ?? POC_COUNTDOWN_MS),
      },
    };
  }

  if (game.state === "COUNTDOWN" && game.revealAt !== undefined && now >= game.revealAt) {
    return {
      expectedState: "COUNTDOWN",
      event: "QUESTION",
      changes: { state: "QUESTION" },
    };
  }

  if (game.state === "QUESTION" && game.revealAt !== undefined) {
    const answers = room.answers?.[roundId];
    const allAnswered = allParticipantsAnswered(game.participantIds, answers);
    const timedOut = now >= game.revealAt + (game.durationMs ?? POC_DURATION_MS);
    if (!allAnswered && !timedOut) return null;
    return {
      expectedState: "QUESTION",
      event: "ANSWER_LOCK",
      changes: {
        state: "ANSWER_LOCK",
        answerLockAt: now,
        lockReason: allAnswered ? "all-answered" : "timeout",
      },
    };
  }

  if (game.state === "ANSWER_LOCK") {
    return {
      expectedState: "ANSWER_LOCK",
      event: "RESULT",
      changes: { state: "RESULT", resultAt: now },
    };
  }

  return null;
}
