export type GameMode = "classic" | "blink";

export type RuntimeState =
  | "LOBBY"
  | "PREPARING"
  | "ALL_READY"
  | "COUNTDOWN"
  | "QUESTION"
  | "ANSWER_LOCK"
  | "RESULT";

export interface RoomMeta {
  authorityUid: string;
  createdAt: number;
  pocMaxPlayers: number;
}

export interface PlayerRecord {
  displayName: string;
  active: boolean;
  joinedAt: number;
  lastSeenAt: number;
  disconnectedAt?: number;
}

export interface ReadinessRecord {
  preloadStartedAt?: number;
  preloadCompletedAt?: number;
  decodeCompletedAt?: number;
  readyAt?: number;
  artificialDelayMs?: number;
}

export interface AnswerRecord {
  choiceId: string;
  submittedAt: number;
}

export interface DiagnosticRecord {
  revealAtReceivedAt?: number;
  actualRevealAt?: number;
  revealDeltaMs?: number;
  duplicateAnswerRejectedAt?: number;
  restoredSessionAt?: number;
}

export interface GameRecord {
  state: RuntimeState;
  mode?: GameMode;
  questionId?: string;
  preparationId?: string;
  roundId?: string;
  participantIds?: Record<string, true>;
  durationMs?: number;
  countdownMs?: number;
  prepareStartedAt?: number;
  allReadyAt?: number;
  revealAt?: number;
  answerLockAt?: number;
  resultAt?: number;
  lockReason?: "all-answered" | "timeout";
  lastEvent: string;
  lastEventAt: number;
}

export interface RoomRecord {
  meta: RoomMeta;
  players?: Record<string, PlayerRecord>;
  game: GameRecord;
  readiness?: Record<string, Record<string, ReadinessRecord>>;
  answers?: Record<string, Record<string, AnswerRecord>>;
  diagnostics?: Record<string, Record<string, DiagnosticRecord>>;
}

export interface QuestionChoice {
  id: string;
  label: string;
}

export interface QuestionFixture {
  id: string;
  prompt: string;
  imageUrl: string;
  choices: QuestionChoice[];
  correctChoiceId: string;
  note: string;
}
