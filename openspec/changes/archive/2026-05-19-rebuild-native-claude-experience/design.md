## Context

The app currently runs Claude Code in a PTY, stores recent output as `ChatMessage` rows, and streams WebSocket events that append messages or activity flags. The frontend renders three coarse panes: projects, sessions/history, and chat. Recent local work added terminal cleanup and basic tests, but the architecture is still built around terminal chunks rather than Claude conversation state.

The target experience is a local web controller that feels like the native Claude client: calm conversation-first layout, precise typography and spacing, inline tool/action affordances, stable streaming recovery, and animated status changes that update in place. The implementation must remain local-first and authenticated by the existing bearer-token mechanism. Half-finished frontend changes are not a foundation for the rebuild; treat them as failed direction by default and carry forward only independently useful tests, fixtures, screenshots, logs, or parser examples.

## Goals / Non-Goals

**Goals:**
- Rebuild the UI as a native-Claude-style client rather than a dashboard of terminal logs.
- Use a single conversation block model for live sessions, resumed sessions, and historical Claude transcripts.
- Make WebSocket streaming resumable through ordered snapshots and deltas, including browser refresh and reconnect cases.
- Preserve transient Claude status as structured state that animates in place without becoming transcript content.
- Keep project/session creation, resume, stop, and prompt action flows usable on desktop and mobile.
- Add tests before rewriting each major behavior so the rebuild can safely discard the failed implementation.

**Non-Goals:**
- Pixel-copy private implementation details unavailable from the native Claude client.
- Build a full terminal emulator or expose raw PTY screen state as the main UI.
- Add remote multi-user collaboration, cloud sync, or non-local project execution.
- Replace Fastify, React, Vite, SQLite, or node-pty unless an implementation task proves a blocker.
- Preserve compatibility with the current `ChatMessage` WebSocket shape for new client code.

## Decisions

### 1. Rebuild around conversation blocks, not terminal lines

Introduce shared types for a `ConversationBlock` model with durable block kinds such as `user`, `assistant`, `tool`, `system`, and `interaction`, plus metadata for sequence, timestamps, streaming state, tool/action summaries, and source. The server will normalize PTY output, user input, actions, and Claude JSONL history into this model before persistence or replay.

Alternative considered: keep `ChatMessage` and add more rendering flags. Rejected because the old type forces every concern into text bubbles and cannot represent native-style tool cards, streamed assistant updates, prompt actions, or history restoration without brittle client heuristics.

### 2. Treat transient activity as session view state

Session status must be a first-class view model separate from transcript blocks. Use structured fields such as lifecycle (`running`, `idle`, `waiting-for-input`, `stopping`, `stopped`, `failed`), current activity label, connection state, pending action, and last sequence. The client animates transitions between these states with CSS/React state changes, but the server owns the authoritative state.

Alternative considered: infer status from latest transcript text. Rejected because Claude status frames are transient terminal UI and because reconnecting clients need the current state even when no transcript block changed.

### 3. Make the WebSocket protocol snapshot-and-delta based

Replace the append-only `attached`/`output` protocol with ordered stream messages:
- client sends `subscribe` with `sessionId` and optional `afterSequence`;
- server replies with a `snapshot` containing session view state, ordered blocks, and the latest sequence;
- server sends `block-added`, `block-updated`, `block-finalized`, `activity-changed`, `session-changed`, and `error` deltas with monotonic sequence numbers;
- client acks only if needed for future backpressure, not in the first rebuild.

If `afterSequence` is too old or unknown, the server sends a fresh snapshot. This supports reload, reconnect, and mobile pane changes without duplicate blocks.

Alternative considered: keep REST replay plus live WebSocket append. Rejected because it creates races between replay and live output and makes recovery logic live in the client.

### 4. Persist durable blocks and stream sequence boundaries in SQLite

Add or replace persistence tables for sessions, conversation blocks, and stream events. Durable blocks are retained in order. Transient activity is retained as current session state but not as transcript history. For running sessions, recent deltas can be reconstructed from blocks plus session state; a bounded stream-event table can improve reconnect for in-flight block updates.

Alternative considered: only store final blocks and keep stream sequence in memory. Rejected because browser refresh during a long response must recover the visible partial block when possible, and server restart should not replay stale terminal junk.

### 5. Parse Claude JSONL history into the same model

Extend `claudeHistoryReader` from summary extraction into transcript restoration. It should read safe bounded JSONL files, derive project/session metadata, convert user/assistant/tool-like content into conversation blocks, and expose history sessions as previews backed by block restoration. Resuming a history session should create a live session whose initial snapshot uses restored blocks before new PTY output arrives.

Alternative considered: leave history as a side list and only rebuild live sessions. Rejected because the user explicitly wants streaming render recovery and native-like continuity; browsing history must look like the same product, not a separate artifact.

### 6. Use a focused React state machine for the client shell

Replace the current top-level `App` state spread with a small client store/hook that owns: authenticated user state, project list, selected project, session list/previews, active session subscription, block reducer, and responsive pane state. Components should be split by native-client responsibilities: app shell/sidebar, session rail, conversation canvas, block renderer, status indicator, prompt action tray, and composer.

Alternative considered: continue passing state through the existing component tree. Rejected because the rewrite will otherwise recreate the same tangled pane/session/socket coupling that made the current approach hard to recover.

### 7. Visual direction: refined native-client mimicry

The UI should be intentionally restrained: warm neutral background, thin dividers, precise spacing, rounded conversation cards only where native Claude uses cards, sidebar density similar to Claude, a sticky composer, and subtle transitions for pane changes and status chips. Avoid generic decorative AI gradients. The differentiator is fidelity and calmness, not novelty.

Alternative considered: create a bold custom visual identity. Rejected for this change because the success criterion is matching the native Claude client closely.

## Risks / Trade-offs

- Native Claude details are partly implicit → Use observable behavior and screenshots/manual comparison as acceptance criteria; do not claim exact private parity.
- Rewriting both client and backend is broad → Implement capability slices in order: model/tests, backend stream, history restoration, then frontend shell.
- Terminal output can still be ambiguous → Prefer preserving uncertain content as transcript blocks while keeping known transient redraw/status frames out of durable history.
- Stream ordering bugs can duplicate or drop blocks → Require reducer tests for snapshot, reconnect, duplicate delta, out-of-order delta, and block update/finalize flows.
- SQLite schema changes can strand old local data → Use additive migrations or a clear local reset task; do not delete `webagent.db` without explicit user approval.
- Mobile animation can hide state changes or hurt accessibility → Respect reduced-motion settings and keep state text available to assistive technology.
- Existing uncommitted frontend work may encode the failed direction → Do not build on it by default; extract only independently useful tests, parser fixtures, logs, or visual references before replacing it.

## Migration Plan

1. Inventory current uncommitted changes only to identify independently useful tests, fixtures, logs, screenshots, or parser examples; do not treat half-finished frontend implementation code as a base.
2. Define shared conversation, stream, and session view types with reducer tests that fail against the old message model.
3. Add server persistence and stream protocol support while keeping local auth/project/session route entry points stable.
4. Implement Claude JSONL restoration into conversation blocks and wire history previews to restored snapshots.
5. Replace the React shell and component tree with the native-style layout and stream reducer.
6. Remove obsolete terminal-line rendering, old pane-specific state, and compatibility shims after the new tests pass.
7. Verify with unit tests, full build, and manual browser runs covering new session, continue, resume history, reconnect, stop/fail, mobile drawer, and reduced-motion status changes.

Rollback is local: keep the change isolated in git, and revert the rewrite if the new stream contract fails. Database changes must be additive or accompanied by a documented local reset confirmation.

## Open Questions

- Whether the existing screenshots are sufficient visual references, or whether the implementation phase should capture fresh native Claude client references before CSS work begins.
- Whether restored JSONL transcripts should include tool result content expanded by default or collapsed like native tool cards.
- Whether stream event retention should be bounded by count, time, or reconstructed entirely from current blocks for the first implementation.
