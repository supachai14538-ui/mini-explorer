import { describe, expect, it } from "vitest";
import { firstAnswerOrAbort, nextAuthorityTransition } from "./protocol";
import type { AnswerRecord, RoomRecord } from "./types";

function roomAt(state: RoomRecord["game"]["state"]): RoomRecord {
  return {
    meta: { authorityUid: "host", createdAt: 0, pocMaxPlayers: 4 },
    players: {},
    game: {
      state,
      roundId: "round-1",
      preparationId: "round-1",
      participantIds: { host: true, guest: true },
      countdownMs: 3_000,
      durationMs: 30_000,
      lastEvent: state,
      lastEventAt: 0,
    },
  };
}

describe("authority protocol", () => {
  it("does not cross the ready barrier until every participant is ready", () => {
    const room = roomAt("PREPARING");
    room.readiness = { "round-1": { host: { readyAt: 10 } } };
    expect(nextAuthorityTransition(room, 100)).toBeNull();

    room.readiness["round-1"]!.guest = { readyAt: 20 };
    expect(nextAuthorityTransition(room, 100)).toEqual({
      expectedState: "PREPARING",
      event: "ALL_READY",
      changes: { state: "ALL_READY", allReadyAt: 100 },
    });
  });

  it("arms a future revealAt from shared time", () => {
    expect(nextAuthorityTransition(roomAt("ALL_READY"), 10_000)).toEqual({
      expectedState: "ALL_READY",
      event: "COUNTDOWN",
      changes: { state: "COUNTDOWN", revealAt: 13_000 },
    });
  });

  it("does not enter QUESTION before revealAt", () => {
    const room = roomAt("COUNTDOWN");
    room.game.revealAt = 13_000;
    expect(nextAuthorityTransition(room, 12_999)).toBeNull();
    expect(nextAuthorityTransition(room, 13_000)?.changes.state).toBe("QUESTION");
  });

  it("locks when all participants have answered", () => {
    const room = roomAt("QUESTION");
    room.game.revealAt = 10_000;
    room.answers = { "round-1": { host: { choiceId: "a", submittedAt: 11_000 }, guest: { choiceId: "b", submittedAt: 12_000 } } };
    expect(nextAuthorityTransition(room, 12_000)?.changes).toMatchObject({
      state: "ANSWER_LOCK",
      lockReason: "all-answered",
    });
  });

  it("locks on the shared timeout", () => {
    const room = roomAt("QUESTION");
    room.game.revealAt = 10_000;
    expect(nextAuthorityTransition(room, 39_999)).toBeNull();
    expect(nextAuthorityTransition(room, 40_000)?.changes).toMatchObject({
      state: "ANSWER_LOCK",
      lockReason: "timeout",
    });
  });

  it("moves from answer lock to result", () => {
    expect(nextAuthorityTransition(roomAt("ANSWER_LOCK"), 50_000)?.changes.state).toBe("RESULT");
  });
});

describe("duplicate answer protection", () => {
  const first: AnswerRecord = { choiceId: "paris", submittedAt: 10 };
  const second: AnswerRecord = { choiceId: "rome", submittedAt: 11 };

  it("accepts the first answer and aborts replacement", () => {
    expect(firstAnswerOrAbort(null, first)).toEqual(first);
    expect(firstAnswerOrAbort(first, second)).toBeUndefined();
  });
});
