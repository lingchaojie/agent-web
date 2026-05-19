## 1. Live User Prompt Rendering

- [x] 1.1 Add regression coverage showing a web-sent prompt appears in `SessionRenderState` before assistant output.
- [x] 1.2 Update the live input delivery path to append a final user render region when input is accepted.
- [x] 1.3 Ensure snapshots and reconnect deltas include web-sent user render regions without duplicating durable blocks.

## 2. Transcript Window API

- [x] 2.1 Add tests for latest-window transcript loading, older-page loading, end-of-history behavior, and unsafe transcript handling.
- [x] 2.2 Extend the Claude history reader with a bounded transcript window result containing normalized regions, a cursor, and `hasMoreOlder` metadata.
- [x] 2.3 Add API routes for loading transcript windows by native history session and by app session native identity.
- [x] 2.4 Preserve existing resume and history-list deduplication behavior while adding the new read-only transcript routes.

## 3. Unified Client Session History View

- [x] 3.1 Add client API helpers and state for transcript window loading and older-page pagination.
- [x] 3.2 Update session selection so live app sessions and Claude history sessions open into a shared transcript-capable view.
- [x] 3.3 Render the latest transcript window by default, prepend older regions on upward scroll, and preserve scroll anchor.
- [x] 3.4 Keep active live-session WebSocket updates available alongside transcript history when the selected app session is running.

## 4. Verification

- [x] 4.1 Run server and shared tests covering stream rendering, history reading, routes, and reducers.
- [x] 4.2 Run frontend build or typecheck.
- [x] 4.3 Manually verify in the browser that new user prompts display and that history pagination works for live and history sessions.
