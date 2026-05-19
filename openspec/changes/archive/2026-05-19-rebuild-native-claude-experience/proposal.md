## Why

The current mobile web UI was built as a lightweight terminal-output controller, but the attempted frontend optimization is not viable because it cannot faithfully reproduce Claude's native conversation model, streaming recovery, or status transitions from line-oriented PTY text. Rebuilding the frontend and supporting backend contracts around structured session state will make the app feel like the native Claude client instead of a noisy terminal transcript viewer.

## What Changes

- **BREAKING**: Replace the existing project/session/chat UI composition with a native-Claude-style shell: persistent sidebar, conversation canvas, inline composer, empty states, session switcher, and mobile drawer behavior.
- Introduce a structured conversation event model that separates durable transcript blocks, transient activity, tool/action affordances, connection state, and session lifecycle state.
- Replace append-only WebSocket output handling with resumable streaming snapshots and ordered deltas so the client can recover the visible stream after reconnect, route changes, or browser refresh.
- Add backend support for restoring Claude history into the same conversation model used by live sessions, not a separate list of raw transcript summaries.
- Redesign status rendering so thinking/working/hook/permission/idle/stopped transitions animate in place and never pollute transcript history.
- Keep authentication, local-only project discovery, PTY process control, and Fastify/React/Vite/SQLite foundations unless a task explicitly requires changing them.
- Add regression coverage for state recovery, live status transitions, history restoration, and native-like responsive layout behavior.

## Capabilities

### New Capabilities
- `native-claude-client-experience`: A production-grade React interface that closely matches native Claude client layout, visual hierarchy, interaction rhythm, responsive behavior, and animated state transitions.
- `resumable-session-streaming`: A realtime session protocol that delivers ordered snapshots/deltas for durable transcript blocks and transient status so clients can reconnect without losing or duplicating streamed UI state.
- `claude-transcript-restoration`: Backend parsing and normalization of local Claude history into the same conversation block model used by live sessions, enabling accurate session browsing and resume previews.

### Modified Capabilities

## Impact

- Frontend app shell and components in `src/client/App.tsx`, `src/client/components/*`, `src/client/api.ts`, and `src/client/styles.css` will be replaced or heavily rewritten.
- Shared contracts in `src/shared/types.ts` will move from `ChatMessage`-centric output to conversation blocks, stream events, session view models, and status metadata.
- Server routes/services in `src/server/routes/sessionRoutes.ts`, `src/server/routes/historyRoutes.ts`, `src/server/services/realtimeHub.ts`, `src/server/services/sessionRegistry.ts`, `src/server/services/claudeHistoryReader.ts`, `src/server/services/interactionParser.ts`, and terminal parsing helpers will be rebuilt around structured state.
- SQLite persistence may need additive schema changes or replacement tables for ordered conversation blocks, stream sequence numbers, and transient-to-durable event boundaries.
- Tests under `tests/client` and `tests/server` will need broad updates; new coverage should protect recovery semantics before the rewrite proceeds.
- Existing half-finished frontend modifications are not assumed useful and should be default-discarded; only independently valuable tests, fixtures, logs, screenshots, or parser examples may be carried forward as references.
