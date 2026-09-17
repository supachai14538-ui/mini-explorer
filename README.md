# Mini Explorer
Mobile-first multiplayer location guessing party game for friends. Guess real-world places from images through synchronized real-time gameplay, explore modes, and multiple battle types.

## Phase 3 Multiplayer Timing POC

This branch contains a deliberately small browser prototype for validating the approved multiplayer timing protocol. It is not a production game implementation.

### Run locally

Requirements: Node.js 22.12+ and access to the Phase 3 Firebase project.

The live POC environment is associated with Firebase project `mini-explorer-712b4`. Its Realtime Database is in `asia-southeast1` (Singapore) at `https://mini-explorer-712b4-default-rtdb.asia-southeast1.firebasedatabase.app`.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and add the Firebase Web App configuration for `mini-explorer-712b4`. The local file is ignored by Git.
3. Confirm that Anonymous Authentication remains enabled.
4. Verify the Firebase CLI target with `npx firebase-tools use`.
5. Deploy only the checked-in Realtime Database rules with `npx firebase-tools deploy --only database --project mini-explorer-712b4`.
6. Run `npm run dev` and open the shown URL. Environment verification needs one browser; the later A–H test session needs 2–4 separate browser profiles or devices.

The included rules are intentionally POC-level. Authenticated clients in a room can read the room and can update the player collection; they are not production authorization rules.

### Commands

- `npm run dev` — run the local prototype
- `npm test` — run pure timing and barrier tests
- `npm run build` — type-check and produce a static build

### POC flow

`Room → Prepare Question → Preload → Decode → Client Ready → All Players Ready → Countdown → revealAt → Synchronized Reveal → Timer → Answer Lock → Result`

The authority client creates the room and owns game-state transitions. Every participating client must successfully preload and decode the local static image before it writes `readyAt`. Once every participant is ready, the authority writes a future `revealAt`. Receiving that database value never reveals the content by itself: each client compares its Firebase server-offset-adjusted clock with `revealAt`.

Classic keeps the image visible for the question. Blink derives each 5-second SHOW/HIDE interval from elapsed shared time (`sharedNow - revealAt`), so it cannot drift through independent local interval counters. Answers use a Realtime Database transaction at the per-client answer path, and the database rules reject replacement writes.

### Runtime data shape

```text
rooms/{roomId}
├── meta
│   ├── authorityUid
│   ├── createdAt
│   └── pocMaxPlayers
├── players/{uid}
├── game
│   ├── state
│   ├── mode
│   ├── preparationId / roundId
│   ├── participantIds
│   ├── durationMs / countdownMs
│   ├── revealAt
│   └── transition timestamps / lastEvent
├── readiness/{preparationId}/{uid}
│   ├── preloadStartedAt
│   ├── preloadCompletedAt
│   ├── decodeCompletedAt
│   └── readyAt
├── answers/{roundId}/{uid}
├── diagnostics/{roundId}/{uid}
└── events/{roundId}/{eventId}
```

### Manual test matrix

Use separate browser profiles so each client receives a distinct anonymous UID.

- **A — Normal Network:** Join 2–4 clients, prepare Classic, and compare reveal timestamps.
- **B — Slow Client:** Set an artificial ready delay on one client before starting; verify all clients remain hidden.
- **C — Network Delay:** Throttle one browser in developer tools; compare `revealAt received`, actual reveal, and reveal difference.
- **D — Different Device Speed:** Use clients on different devices; verify decode completion differs but reveal remains gated.
- **E — Late Ready:** Enable **Hold Ready report** before starting, then release it after other clients are ready.
- **F — Blink Timing:** Select Blink and verify all clients derive SHOW/HIDE from the same shared clock.
- **G — Duplicate Answer:** Answer once, then use the duplicate-answer diagnostic action; the second transaction must be rejected.
- **H — Refresh/Temporary Disconnect:** Refresh or briefly disconnect a client and record observed presence/session behavior. This POC does not define the final reconnect policy.

### POC assumptions and limitations

- The 30-second duration, 3-second countdown, and 2–4 client limit are experimental POC values.
- One original local SVG fixture is used only to exercise preload/decode behavior; it is not Question Bank content.
- The browser that creates the room is the authority. There is no authority migration; if it disconnects, state progression pauses.
- Anonymous auth identifies a browser installation and is not a profile system.
- Firebase Realtime Database remains an experimental runtime choice until the POC is reviewed.
- Refresh/reconnect behavior is measured, not declared as a final game rule.
- Exact speed scoring is intentionally absent because the formula remains unresolved.

See [the approved Phase 3 specification](docs/phase-3-multiplayer-timing-poc.md) for scope and acceptance criteria.
