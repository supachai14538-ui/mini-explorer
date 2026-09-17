import "./styles.css";
import { initializeFirebase, missingFirebaseConfig, type FirebaseServices } from "./firebase";
import { POC_QUESTION } from "./question";
import {
  advanceAuthorityState,
  configurePresence,
  createRoom,
  joinRoom,
  prepareRound,
  submitAnswer,
  subscribeToRoom,
  subscribeToServerOffset,
  updateDiagnostics,
  updateReadiness,
} from "./room";
import {
  areChoicesVisible,
  isQuestionImageVisible,
  millisecondsRemaining,
  millisecondsUntilReveal,
  sharedNow,
} from "./timing";
import type { GameMode, ReadinessRecord, RoomRecord } from "./types";
import type { Unsubscribe } from "firebase/database";

const rootCandidate = document.querySelector<HTMLElement>("#app");
if (!rootCandidate) throw new Error("App root not found.");
const root: HTMLElement = rootCandidate;

const SESSION_KEY = "mini-explorer-poc-session";

let services: FirebaseServices | null = null;
let roomId: string | null = null;
let room: RoomRecord | null = null;
let displayName = "";
let serverOffsetMs = 0;
let roomUnsubscribe: Unsubscribe | null = null;
let presenceUnsubscribe: Unsubscribe | null = null;
let offsetUnsubscribe: Unsubscribe | null = null;
let ticker: number | null = null;
let advancingAuthority = false;
let statusMessage = "Connecting to Firebase…";
let errorMessage = "";
let localPreparationId: string | null = null;
let localPreparationStatus = "Not started";
let readyHeld = false;
let artificialReadyDelayMs = 0;
let selectedMode: GameMode = "classic";
let pendingReady: { preparationId: string; values: ReadinessRecord } | null = null;
let duplicateTestTrace = "";
const receivedRevealRounds = new Set<string>();
const recordedRevealRounds = new Set<string>();

function now(): number {
  return sharedNow(Date.now(), serverOffsetMs);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value?: number): string {
  if (value === undefined) return "—";
  return `${new Date(value).toISOString()} (${Math.round(value)} ms)`;
}

function participantIds(): string[] {
  return Object.keys(room?.game.participantIds ?? {});
}

function currentReadiness(): Record<string, ReadinessRecord> {
  const preparationId = room?.game.preparationId;
  return preparationId ? (room?.readiness?.[preparationId] ?? {}) : {};
}

function renderLobby(): void {
  root.innerHTML = `
    <section class="shell narrow">
      <header class="hero">
        <p class="eyebrow">Phase 3 · Multiplayer Timing POC</p>
        <h1>Mini Explorer</h1>
        <p>This prototype measures synchronization. It is not the production game.</p>
      </header>
      ${errorMessage ? `<p class="message error">${escapeHtml(errorMessage)}</p>` : ""}
      ${statusMessage ? `<p class="message">${escapeHtml(statusMessage)}</p>` : ""}
      <div class="card stack">
        <label>
          Display name
          <input id="display-name" name="displayName" maxlength="24" value="${escapeHtml(displayName)}" placeholder="Explorer name" />
        </label>
        <button type="button" data-action="create-room">Create room</button>
        <div class="divider"><span>or join</span></div>
        <label>
          Room code
          <input id="room-code" name="roomCode" maxlength="6" autocomplete="off" placeholder="ABC234" />
        </label>
        <button type="button" class="secondary" data-action="join-room">Join room</button>
      </div>
      <p class="fine-print">POC assumption: 2–4 active clients. Authentication is anonymous and only identifies a browser session.</p>
    </section>
  `;
}

function renderConfigError(error: Error): void {
  const missing = missingFirebaseConfig();
  root.innerHTML = `
    <section class="shell narrow">
      <header class="hero">
        <p class="eyebrow">Phase 3 · Setup required</p>
        <h1>Firebase configuration missing</h1>
      </header>
      <div class="card stack">
        <p>${escapeHtml(error.message)}</p>
        <p>Copy <code>.env.example</code> to <code>.env.local</code>, add a Firebase Web App config, enable Anonymous Authentication, and deploy the included Realtime Database rules.</p>
        <p>Missing: <code>${escapeHtml(missing.join(", "))}</code></p>
      </div>
    </section>
  `;
}

function renderPlayers(): string {
  const authorityUid = room?.meta.authorityUid;
  const players = Object.entries(room?.players ?? {});
  return players
    .map(([uid, player]) => {
      const badges = [
        uid === authorityUid ? "authority" : "client",
        player.active ? "active" : "disconnected",
      ];
      return `<li><span>${escapeHtml(player.displayName)}</span><small>${badges.join(" · ")} · ${escapeHtml(uid.slice(0, 8))}</small></li>`;
    })
    .join("");
}

function renderQuestion(sharedTime: number): string {
  if (!room) return "";
  const game = room.game;
  const mode = game.mode ?? "classic";
  const choicesVisible = game.state === "RESULT" || areChoicesVisible(sharedTime, game.revealAt);
  const imageVisible = isQuestionImageVisible(mode, sharedTime, game.revealAt, game.state);
  const roundAnswers = game.roundId ? room.answers?.[game.roundId] : undefined;
  const ownAnswer = services && roundAnswers ? roundAnswers[services.user.uid] : undefined;
  const remaining = millisecondsRemaining(sharedTime, game.revealAt, game.durationMs);
  const canAnswer =
    choicesVisible &&
    game.state === "QUESTION" &&
    remaining !== null &&
    remaining > 0 &&
    !ownAnswer;

  if (!game.questionId || game.state === "LOBBY") {
    return `<div class="question-placeholder"><p>Waiting for the authority to prepare the POC question.</p></div>`;
  }

  const choices = POC_QUESTION.choices
    .map((choice) => {
      const selected = ownAnswer?.choiceId === choice.id;
      const correct = game.state === "RESULT" && choice.id === POC_QUESTION.correctChoiceId;
      return `<button class="choice ${selected ? "selected" : ""} ${correct ? "correct" : ""}" data-action="answer" data-choice-id="${choice.id}" ${canAnswer ? "" : "disabled"}>${escapeHtml(choice.label)}</button>`;
    })
    .join("");

  const revealWait = millisecondsUntilReveal(sharedTime, game.revealAt);
  const overlayText = !choicesVisible
    ? game.state === "PREPARING"
      ? "Preloading and decoding before Ready"
      : game.state === "ALL_READY"
        ? "All clients ready"
        : `Reveal in ${((revealWait ?? 0) / 1000).toFixed(2)}s`
    : mode === "blink" && !imageVisible && game.state !== "RESULT"
      ? "BLINK · image hidden by shared clock"
      : "";

  const result = game.state === "RESULT"
    ? `<div class="result"><strong>${ownAnswer?.choiceId === POC_QUESTION.correctChoiceId ? "Correct" : "Not correct"}</strong><span>Answer: Paris · lock reason: ${escapeHtml(game.lockReason)}</span></div>`
    : "";

  return `
    <div class="question-stage">
      <div class="image-frame ${imageVisible ? "visible" : "hidden"}" data-live="image-frame">
        <img src="${POC_QUESTION.imageUrl}" alt="Stylized Eiffel Tower timing fixture" />
        <div class="image-cover" data-live="image-cover" ${overlayText ? "" : "hidden"}>${escapeHtml(overlayText)}</div>
      </div>
      <div class="question-content ${choicesVisible ? "visible" : "concealed"}" data-live="question-content">
        <p class="eyebrow">${escapeHtml(mode.toUpperCase())} · static fixture</p>
        <h2>${escapeHtml(POC_QUESTION.prompt)}</h2>
        <div class="choices">${choices}</div>
        ${ownAnswer ? `<p class="message">Answer accepted at ${formatTime(ownAnswer.submittedAt)}</p>` : ""}
        ${ownAnswer && game.state === "RESULT" ? `<button type="button" class="text-button" data-action="duplicate-answer">Send the same answer again (Test G)</button>` : ""}
        ${duplicateTestTrace ? `<p class="message" role="status" data-test-g-trace>${escapeHtml(duplicateTestTrace)}</p>` : ""}
        ${result}
      </div>
    </div>
  `;
}

function renderReadinessTable(): string {
  if (!room || !services) return "";
  const readiness = currentReadiness();
  return participantIds()
    .map((uid) => {
      const record = readiness[uid];
      const player = room?.players?.[uid];
      return `<tr>
        <td>${escapeHtml(player?.displayName ?? uid.slice(0, 8))}${uid === services?.user.uid ? " (you)" : ""}</td>
        <td>${formatTime(record?.preloadCompletedAt)}</td>
        <td>${formatTime(record?.decodeCompletedAt)}</td>
        <td>${formatTime(record?.readyAt)}</td>
        <td>${record?.artificialDelayMs ?? 0} ms</td>
      </tr>`;
    })
    .join("");
}

function renderDiagnostics(sharedTime: number, imageVisible: boolean): string {
  if (!room || !services) return "";
  const game = room.game;
  const diagnostic = game.roundId ? room.diagnostics?.[game.roundId]?.[services.user.uid] : undefined;
  const remaining = millisecondsRemaining(sharedTime, game.revealAt, game.durationMs);
  return `
    <details class="card diagnostics" open>
      <summary>Diagnostic data</summary>
      <dl class="diagnostic-grid">
        <div><dt>Room ID</dt><dd>${escapeHtml(roomId)}</dd></div>
        <div><dt>Client ID</dt><dd>${escapeHtml(services.user.uid)}</dd></div>
        <div><dt>Current State</dt><dd>${escapeHtml(game.state)}</dd></div>
        <div><dt>Last State Event</dt><dd>${escapeHtml(game.lastEvent)}</dd></div>
        <div><dt>Server offset</dt><dd data-live="server-offset">${Math.round(serverOffsetMs)} ms</dd></div>
        <div><dt>Current shared time</dt><dd data-live="shared-time">${formatTime(sharedTime)}</dd></div>
        <div><dt>Expected revealAt</dt><dd>${formatTime(game.revealAt)}</dd></div>
        <div><dt>Remaining time</dt><dd data-live="remaining-time">${remaining === null ? "—" : `${(remaining / 1000).toFixed(2)} s`}</dd></div>
        <div><dt>Image visibility</dt><dd data-live="image-visibility">${imageVisible ? "VISIBLE" : "HIDDEN"}</dd></div>
        <div><dt>Local preparation</dt><dd>${escapeHtml(localPreparationStatus)}</dd></div>
        <div><dt>revealAt received</dt><dd>${formatTime(diagnostic?.revealAtReceivedAt)}</dd></div>
        <div><dt>Actual client reveal</dt><dd>${formatTime(diagnostic?.actualRevealAt)}</dd></div>
        <div><dt>Reveal difference</dt><dd>${diagnostic?.revealDeltaMs === undefined ? "—" : `${diagnostic.revealDeltaMs} ms`}</dd></div>
      </dl>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Preload complete</th><th>Decode complete</th><th>Ready</th><th>POC delay</th></tr></thead>
          <tbody>${renderReadinessTable()}</tbody>
        </table>
      </div>
    </details>
  `;
}

function updateLiveClockUi(): void {
  if (!room) return;
  const sharedTime = now();
  const game = room.game;
  const mode = game.mode ?? "classic";
  const choicesVisible = game.state === "RESULT" || areChoicesVisible(sharedTime, game.revealAt);
  const imageVisible = isQuestionImageVisible(mode, sharedTime, game.revealAt, game.state);
  const remaining = millisecondsRemaining(sharedTime, game.revealAt, game.durationMs);
  const revealWait = millisecondsUntilReveal(sharedTime, game.revealAt);
  const overlayText = !choicesVisible
    ? game.state === "PREPARING"
      ? "Preloading and decoding before Ready"
      : game.state === "ALL_READY"
        ? "All clients ready"
        : `Reveal in ${((revealWait ?? 0) / 1000).toFixed(2)}s`
    : mode === "blink" && !imageVisible && game.state !== "RESULT"
      ? "BLINK · image hidden by shared clock"
      : "";

  const imageFrame = root.querySelector<HTMLElement>('[data-live="image-frame"]');
  imageFrame?.classList.toggle("visible", imageVisible);
  imageFrame?.classList.toggle("hidden", !imageVisible);

  const questionContent = root.querySelector<HTMLElement>('[data-live="question-content"]');
  questionContent?.classList.toggle("visible", choicesVisible);
  questionContent?.classList.toggle("concealed", !choicesVisible);

  const imageCover = root.querySelector<HTMLElement>('[data-live="image-cover"]');
  if (imageCover) {
    imageCover.textContent = overlayText;
    imageCover.hidden = overlayText.length === 0;
  }

  const values: Record<string, string> = {
    "server-offset": `${Math.round(serverOffsetMs)} ms`,
    "shared-time": formatTime(sharedTime),
    "remaining-time": remaining === null ? "—" : `${(remaining / 1000).toFixed(2)} s`,
    "image-visibility": imageVisible ? "VISIBLE" : "HIDDEN",
  };
  for (const [key, value] of Object.entries(values)) {
    const target = root.querySelector<HTMLElement>(`[data-live="${key}"]`);
    if (target) target.textContent = value;
  }
}

function renderRoom(): void {
  if (!room || !roomId || !services) return;
  const sharedTime = now();
  const game = room.game;
  const isAuthority = room.meta.authorityUid === services.user.uid;
  const imageVisible = isQuestionImageVisible(game.mode ?? "classic", sharedTime, game.revealAt, game.state);
  const activeCount = Object.values(room.players ?? {}).filter((player) => player.active).length;
  const canPrepare = isAuthority && (game.state === "LOBBY" || game.state === "RESULT");

  root.innerHTML = `
    <section class="shell">
      <header class="room-header">
        <div>
          <p class="eyebrow">Phase 3 · Timing POC</p>
          <h1>Room ${escapeHtml(roomId)}</h1>
        </div>
        <div class="state-pill">${escapeHtml(game.state)}</div>
      </header>
      ${errorMessage ? `<p class="message error">${escapeHtml(errorMessage)}</p>` : ""}
      ${statusMessage ? `<p class="message">${escapeHtml(statusMessage)}</p>` : ""}
      <div class="layout">
        <aside class="stack">
          <section class="card">
            <h2>Clients (${activeCount}/4 active)</h2>
            <ul class="players">${renderPlayers()}</ul>
          </section>
          <section class="card stack">
            <h2>POC controls</h2>
            <label>
              Artificial ready delay (ms)
              <input id="ready-delay" type="number" min="0" max="30000" step="250" value="${artificialReadyDelayMs}" ${game.state === "PREPARING" ? "disabled" : ""} />
            </label>
            <label class="checkbox-row">
              <input id="hold-ready" type="checkbox" ${readyHeld ? "checked" : ""} ${game.state === "PREPARING" ? "disabled" : ""} />
              Hold Ready report (Tests B/E)
            </label>
            ${pendingReady ? `<button type="button" data-action="release-ready">Release Ready now</button>` : ""}
            ${canPrepare ? `
              <label>
                Timing scenario
                <select id="game-mode">
                  <option value="classic" ${selectedMode === "classic" ? "selected" : ""}>Classic</option>
                  <option value="blink" ${selectedMode === "blink" ? "selected" : ""}>Blink shared clock</option>
                </select>
              </label>
              <button type="button" data-action="prepare-round" ${activeCount < 2 || activeCount > 4 ? "disabled" : ""}>Prepare question</button>
            ` : ""}
            <p class="fine-print">30s duration and 3s countdown are POC assumptions, not final game rules.</p>
          </section>
        </aside>
        <section class="play-area">${renderQuestion(sharedTime)}</section>
      </div>
      ${renderDiagnostics(sharedTime, imageVisible)}
    </section>
  `;
}

function render(): void {
  if (!services) {
    root.innerHTML = `<section class="shell narrow"><p class="message">${escapeHtml(statusMessage)}</p></section>`;
    return;
  }
  if (roomId && room) renderRoom();
  else renderLobby();
}

async function connectToRoom(targetRoomId: string, name: string, restored = false): Promise<void> {
  if (!services) return;
  roomUnsubscribe?.();
  presenceUnsubscribe?.();
  roomId = targetRoomId;
  displayName = name;
  room = null;
  localPreparationId = null;
  pendingReady = null;
  statusMessage = restored ? "Restored browser session; reconnect behavior remains a POC observation." : "Joined room.";
  errorMessage = "";
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, displayName }));
  presenceUnsubscribe = await configurePresence(services.database, roomId, services.user.uid, now);
  let restorePending = restored;
  roomUnsubscribe = subscribeToRoom(services.database, roomId, (nextRoom) => {
    room = nextRoom;
    if (!nextRoom) {
      errorMessage = "Room no longer exists.";
      roomId = null;
      sessionStorage.removeItem(SESSION_KEY);
      render();
      return;
    }
    const shouldRecordRestore = restorePending;
    restorePending = false;
    processRoomSnapshot(nextRoom, shouldRecordRestore);
    render();
  });
}

async function processRoomSnapshot(nextRoom: RoomRecord, restored: boolean): Promise<void> {
  if (!services || !roomId) return;
  const game = nextRoom.game;
  const uid = services.user.uid;

  if (restored && game.roundId && !nextRoom.diagnostics?.[game.roundId]?.[uid]?.restoredSessionAt) {
    void updateDiagnostics(services.database, roomId, game.roundId, uid, { restoredSessionAt: now() });
  }

  if (game.state === "PREPARING" && game.preparationId && game.participantIds?.[uid] && localPreparationId !== game.preparationId) {
    localPreparationId = game.preparationId;
    void prepareClient(game.preparationId);
  }

  if (game.revealAt !== undefined && game.roundId && !receivedRevealRounds.has(game.roundId)) {
    receivedRevealRounds.add(game.roundId);
    void updateDiagnostics(services.database, roomId, game.roundId, uid, { revealAtReceivedAt: now() });
  }

  const revealArrived = game.revealAt !== undefined && now() >= game.revealAt;
  if (revealArrived && game.roundId && !recordedRevealRounds.has(game.roundId)) {
    recordedRevealRounds.add(game.roundId);
    const actualRevealAt = now();
    void updateDiagnostics(services.database, roomId, game.roundId, uid, {
      actualRevealAt,
      revealDeltaMs: Math.round(actualRevealAt - game.revealAt!),
    });
  }

  void advanceIfAuthority(nextRoom);
}

async function prepareClient(preparationId: string): Promise<void> {
  if (!services || !roomId) return;
  const capturedRoomId = roomId;
  const uid = services.user.uid;
  const values: ReadinessRecord = {
    preloadStartedAt: now(),
    artificialDelayMs: artificialReadyDelayMs,
  };
  localPreparationStatus = "Preloading image";
  render();
  await updateReadiness(services.database, capturedRoomId, preparationId, uid, values);

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("Static image preload failed.")), { once: true });
    });
    image.src = POC_QUESTION.imageUrl;
    await loaded;
    values.preloadCompletedAt = now();
    localPreparationStatus = "Preloaded; decoding image";
    render();
    await updateReadiness(services.database, capturedRoomId, preparationId, uid, {
      preloadCompletedAt: values.preloadCompletedAt,
    });

    await image.decode();
    values.decodeCompletedAt = now();
    localPreparationStatus = artificialReadyDelayMs > 0 ? `Decoded; applying ${artificialReadyDelayMs} ms POC delay` : "Decoded";
    render();
    await updateReadiness(services.database, capturedRoomId, preparationId, uid, {
      decodeCompletedAt: values.decodeCompletedAt,
    });

    if (artificialReadyDelayMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, artificialReadyDelayMs));
    }
    if (localPreparationId !== preparationId) return;
    if (readyHeld) {
      pendingReady = { preparationId, values };
      localPreparationStatus = "Decoded; Ready report held by diagnostic control";
      render();
      return;
    }
    await reportReady(preparationId, values);
  } catch (error) {
    localPreparationStatus = "Preparation failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function reportReady(preparationId: string, values: ReadinessRecord): Promise<void> {
  if (!services || !roomId) return;
  values.readyAt = now();
  await updateReadiness(services.database, roomId, preparationId, services.user.uid, {
    readyAt: values.readyAt,
    artificialDelayMs: values.artificialDelayMs ?? 0,
  });
  pendingReady = null;
  localPreparationStatus = "CLIENT_READY reported after preload + decode";
  statusMessage = "Client Ready reported.";
  render();
}

async function advanceIfAuthority(nextRoom = room): Promise<void> {
  if (!services || !roomId || !nextRoom || advancingAuthority) return;
  if (nextRoom.meta.authorityUid !== services.user.uid) return;
  advancingAuthority = true;
  try {
    await advanceAuthorityState(services.database, roomId, nextRoom, services.user.uid, now());
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    advancingAuthority = false;
  }
}

async function handleCreateRoom(): Promise<void> {
  if (!services) return;
  const input = document.querySelector<HTMLInputElement>("#display-name");
  const name = input?.value.trim() ?? "";
  if (!name) {
    errorMessage = "Enter a display name.";
    render();
    return;
  }
  statusMessage = "Creating room…";
  errorMessage = "";
  render();
  try {
    const createdRoomId = await createRoom(services.database, services.user.uid, name, now());
    await connectToRoom(createdRoomId, name);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function handleJoinRoom(): Promise<void> {
  if (!services) return;
  const name = document.querySelector<HTMLInputElement>("#display-name")?.value.trim() ?? "";
  const code = document.querySelector<HTMLInputElement>("#room-code")?.value.trim() ?? "";
  if (!name || !code) {
    errorMessage = "Enter a display name and room code.";
    render();
    return;
  }
  statusMessage = "Joining room…";
  errorMessage = "";
  render();
  try {
    const joinedRoomId = await joinRoom(services.database, code, services.user.uid, name, now());
    await connectToRoom(joinedRoomId, name);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function handlePrepareRound(): Promise<void> {
  if (!services || !roomId) return;
  const mode = selectedMode;
  errorMessage = "";
  try {
    await prepareRound(services.database, roomId, services.user.uid, mode, now());
    statusMessage = `Preparing ${mode} timing scenario.`;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function handleAnswer(choiceId: string): Promise<void> {
  if (!services || !roomId || !room?.game.roundId) return;
  try {
    const committed = await submitAnswer(services.database, roomId, room.game.roundId, services.user.uid, choiceId, now());
    statusMessage = committed ? "Answer accepted and locked." : "Duplicate answer rejected.";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function handleDuplicateAnswer(): Promise<void> {
  duplicateTestTrace = "CLICK RECEIVED → HANDLER ENTERED";
  render();
  if (!services || !roomId || !room?.game.roundId) {
    duplicateTestTrace += " → STOPPED: missing Firebase session, room, or round";
    render();
    return;
  }
  const currentAnswer = room.answers?.[room.game.roundId]?.[services.user.uid];
  if (!currentAnswer) {
    duplicateTestTrace += " → STOPPED: local accepted answer not found";
    render();
    return;
  }
  try {
    duplicateTestTrace += " → DUPLICATE SUBMIT ATTEMPTED";
    render();
    const committed = await submitAnswer(
      services.database,
      roomId,
      room.game.roundId,
      services.user.uid,
      currentAnswer.choiceId,
      now(),
    );
    duplicateTestTrace += ` → FIREBASE TRANSACTION RESULT: committed=${committed}`;
    if (committed) throw new Error("Duplicate protection failed: second write committed.");
    await updateDiagnostics(services.database, roomId, room.game.roundId, services.user.uid, {
      duplicateAnswerRejectedAt: now(),
    });
    duplicateTestTrace += " → EXPECTED DUPLICATE REJECTION/NO-OP";
    statusMessage = "Test G: duplicate answer rejected by transaction.";
  } catch (error) {
    duplicateTestTrace += ` → ERROR: ${error instanceof Error ? error.message : String(error)}`;
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  render();
}

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!button || button.hasAttribute("disabled")) return;
  const action = button.dataset.action;
  if (action === "create-room") void handleCreateRoom();
  if (action === "join-room") void handleJoinRoom();
  if (action === "prepare-round") void handlePrepareRound();
  if (action === "answer" && button.dataset.choiceId) void handleAnswer(button.dataset.choiceId);
  if (action === "duplicate-answer") void handleDuplicateAnswer();
  if (action === "release-ready" && pendingReady) {
    void reportReady(pendingReady.preparationId, pendingReady.values);
  }
});

root.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === "hold-ready") readyHeld = target.checked;
  if (target instanceof HTMLInputElement && target.id === "ready-delay") {
    artificialReadyDelayMs = Math.max(0, Math.min(30_000, Number(target.value) || 0));
  }
  if (target instanceof HTMLSelectElement && target.id === "game-mode") {
    selectedMode = target.value as GameMode;
  }
});

async function start(): Promise<void> {
  render();
  try {
    services = await initializeFirebase();
    statusMessage = "Anonymous Firebase session ready.";
    offsetUnsubscribe = subscribeToServerOffset(services.database, (offset) => {
      serverOffsetMs = offset;
    });

    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const session = JSON.parse(saved) as { roomId?: string; displayName?: string };
        if (session.roomId && session.displayName) {
          const restoredRoomId = await joinRoom(
            services.database,
            session.roomId,
            services.user.uid,
            session.displayName,
            now(),
          );
          await connectToRoom(restoredRoomId, session.displayName, true);
        }
      } catch (error) {
        sessionStorage.removeItem(SESSION_KEY);
        errorMessage = `Session restore observation: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    render();
    ticker = window.setInterval(() => {
      if (room) {
        void processRoomSnapshot(room, false);
        updateLiveClockUi();
      }
    }, 100);
  } catch (error) {
    renderConfigError(error instanceof Error ? error : new Error(String(error)));
  }
}

window.addEventListener("beforeunload", () => {
  roomUnsubscribe?.();
  presenceUnsubscribe?.();
  offsetUnsubscribe?.();
  if (ticker !== null) window.clearInterval(ticker);
});

void start();
