import { describe, expect, it } from "vitest";
import {
  allParticipantsAnswered,
  allParticipantsReady,
  areChoicesVisible,
  hasRevealTimeArrived,
  isBlinkImageVisible,
  isQuestionImageVisible,
  millisecondsRemaining,
  millisecondsUntilReveal,
  sharedNow,
} from "./timing";

describe("shared timing", () => {
  it("derives shared time from the measured server offset", () => {
    expect(sharedNow(1_000, 125)).toBe(1_125);
  });

  it("does not reveal before revealAt", () => {
    expect(hasRevealTimeArrived(9_999, 10_000)).toBe(false);
    expect(areChoicesVisible(9_999, 10_000)).toBe(false);
    expect(isQuestionImageVisible("classic", 9_999, 10_000, "COUNTDOWN")).toBe(false);
    expect(millisecondsUntilReveal(9_500, 10_000)).toBe(500);
  });

  it("reveals classic image and choices at revealAt", () => {
    expect(hasRevealTimeArrived(10_000, 10_000)).toBe(true);
    expect(areChoicesVisible(10_000, 10_000)).toBe(true);
    expect(isQuestionImageVisible("classic", 10_000, 10_000, "COUNTDOWN")).toBe(true);
  });

  it("derives remaining time from revealAt", () => {
    expect(millisecondsRemaining(15_000, 10_000, 30_000)).toBe(25_000);
    expect(millisecondsRemaining(41_000, 10_000, 30_000)).toBe(0);
  });
});

describe("blink shared clock", () => {
  const revealAt = 10_000;

  it.each([
    [10_000, true],
    [14_999, true],
    [15_000, false],
    [19_999, false],
    [20_000, true],
    [25_000, false],
    [30_000, true],
    [35_000, false],
    [40_000, false],
  ])("returns visibility at shared time %i", (now, visible) => {
    expect(isBlinkImageVisible(now, revealAt)).toBe(visible);
  });
});

describe("barriers", () => {
  const participants = { alpha: true, beta: true } as const;

  it("waits for every participant to report ready", () => {
    expect(allParticipantsReady(participants, { alpha: { readyAt: 1 } })).toBe(false);
    expect(
      allParticipantsReady(participants, {
        alpha: { readyAt: 1 },
        beta: { readyAt: 2 },
      }),
    ).toBe(true);
  });

  it("detects when all participants answered", () => {
    expect(allParticipantsAnswered(participants, { alpha: {} })).toBe(false);
    expect(allParticipantsAnswered(participants, { alpha: {}, beta: {} })).toBe(true);
  });
});
