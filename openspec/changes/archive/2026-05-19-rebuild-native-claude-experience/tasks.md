## 1. Baseline Audit and Test Harness

- [x] 1.1 Review current uncommitted changes only to extract independently useful tests, fixtures, logs, screenshots, and parser examples; treat half-finished frontend implementation code as failed direction and do not build on it.
- [x] 1.2 Add failing shared-type/reducer tests for conversation blocks, session view state, snapshot application, ordered deltas, duplicate deltas, and stale snapshot replacement.
- [x] 1.3 Add failing server tests for subscribe snapshot, recoverable reconnect, stale reconnect fallback, lifecycle deltas, and transient activity non-persistence.
- [x] 1.4 Add failing client tests for native shell layout states, streaming block update behavior, prompt action rendering, disconnected state, and reduced-motion status transitions.

## 2. Shared Conversation and Stream Model

- [x] 2.1 Replace `ChatMessage`-centric shared contracts with conversation block, session view, stream snapshot, stream delta, lifecycle, activity, and prompt action types.
- [x] 2.2 Implement a pure client/server-safe reducer that applies snapshots and ordered deltas idempotently.
- [x] 2.3 Update interaction parsing contracts so permission and choice prompts produce structured interaction blocks and waiting-for-input session state.
- [x] 2.4 Update terminal text classification to output durable transcript content, in-progress block updates, and transient activity events compatible with the new stream model.

## 3. Persistence and Backend Streaming

- [x] 3.1 Add SQLite schema support for ordered conversation blocks, session view state, and bounded stream event retention without deleting existing local data.
- [x] 3.2 Rewrite `SessionRegistry` around conversation blocks, sequence allocation, snapshot construction, and session lifecycle state updates.
- [x] 3.3 Rewrite `RealtimeHub` to broadcast snapshot/delta stream events and to persist only durable blocks or block updates.
- [x] 3.4 Update session WebSocket route validation from attach/input/action messages to subscribe/input/action messages with optional reconnect sequence.
- [x] 3.5 Update create, continue, resume, stop, and PTY exit flows to emit authoritative lifecycle deltas and recover cleanly on runner errors.

## 4. Claude History Restoration

- [x] 4.1 Extend the Claude history reader to parse bounded JSONL transcript files into ordered conversation blocks with stable metadata.
- [x] 4.2 Represent tool use, tool results, commands, system notices, user text, and assistant text as distinct block kinds where safely identifiable.
- [x] 4.3 Update history routes to expose conversation previews and restored session snapshots for available local projects only.
- [x] 4.4 Update resume flow so restored blocks appear in the active session snapshot before new live stream deltas are appended.

## 5. Native-Claude-Style Frontend Rewrite

- [x] 5.1 Start the frontend shell from the new native-Claude-style design and focused hooks/store modules for auth, project/session browsing, active stream subscription, block reduction, and responsive navigation state, rather than refactoring the failed pane/dashboard implementation.
- [x] 5.2 Rebuild the app shell with native-Claude-like sidebar/session rail, conversation canvas, sticky composer, mobile drawer navigation, and polished empty/loading/error states.
- [x] 5.3 Rebuild conversation rendering around typed blocks for user messages, assistant messages, tool cards, system notices, and interaction prompts.
- [x] 5.4 Implement reconnect-aware stream subscription that applies snapshots/deltas without duplicate blocks and preserves visible state across browser refresh where possible.
- [x] 5.5 Implement animated in-place lifecycle/activity indicators for idle, working, waiting-for-input, stopping, stopped, failed, connected, reconnecting, and disconnected states.
- [x] 5.6 Rebuild composer and prompt action controls so text input and action selection send structured WebSocket messages and update optimistic UI only when accepted by the stream model.

## 6. Cleanup and Migration

- [x] 6.1 Remove obsolete dashboard/panel rendering code, append-only message rendering, and compatibility shims that are no longer used by the new stream model.
- [x] 6.2 Preserve or rewrite only independently useful regression tests/fixtures/references from the failed local attempt; otherwise remove obsolete frontend implementation code instead of adapting it.
- [x] 6.3 Update API helpers and route tests to match the new REST/WebSocket contracts.
- [x] 6.4 Ensure database migration/reset behavior is documented in code or test setup without deleting the user's local database automatically.

## 7. Verification

- [x] 7.1 Run targeted shared reducer, terminal classification, realtime hub, history restoration, and client rendering tests.
- [x] 7.2 Run the full Vitest suite and TypeScript build.
- [x] 7.3 Start the dev server and manually verify in a browser: login, project selection, new session, continue session, resume history, live streaming update, reconnect/refresh recovery, prompt action selection, stop/fail state, mobile drawer layout, and reduced-motion behavior.
- [x] 7.4 Compare the final UI against native Claude client references/screenshots and adjust spacing, typography, status animation, and block treatments until the experience is visually aligned.
