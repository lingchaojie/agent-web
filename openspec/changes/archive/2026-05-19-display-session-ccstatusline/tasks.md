## 1. Shared stream contract

- [x] 1.1 Add shared `SessionStatuslineState` and `statusline-changed` stream event types.
- [x] 1.2 Update the session stream reducer to store statusline state from snapshots and statusline update events.
- [x] 1.3 Add reducer tests for snapshot statusline, ordered statusline updates, duplicate/older update handling, and session separation.

## 2. Server statusline execution

- [x] 2.1 Add a server service that reads local Claude Code `statusLine` settings and resolves command, padding, and refresh interval defaults.
- [x] 2.2 Build per-session statusline stdin context from app session, project/worktree path, native Claude session id, lifecycle/activity, and available render metadata.
- [x] 2.3 Execute the configured statusline command with stdin, timeout, stdout/stderr capture, ANSI-preserving output, and compact failure state.
- [x] 2.4 Filter native-only shortcut hints such as `(shift+tab to cycle)` from statusline output.
- [x] 2.5 Add server unit tests for settings loading, stdin context, successful command output, command failure, timeout, and shortcut filtering.

## 3. Realtime integration

- [x] 3.1 Extend session snapshots to include the latest statusline state when available.
- [x] 3.2 Start a shared per-session refresh loop while at least one WebSocket client is subscribed.
- [x] 3.3 Broadcast ordered `statusline-changed` events on refresh without appending transcript blocks or render regions.
- [x] 3.4 Stop the refresh loop when the last client unsubscribes or disconnects.
- [x] 3.5 Add realtime tests for initial snapshot, periodic refresh, multi-client sharing, multi-session isolation, and cleanup after unsubscribe.

## 4. Client rendering

- [x] 4.1 Add an ANSI-to-safe-React renderer or safe ANSI-to-HTML helper for statusline output.
- [x] 4.2 Add a compact `SessionStatusline` component rendered above the composer in `ChatView`.
- [x] 4.3 Style the statusline panel as a dark terminal-like fixed strip with monospace text, ANSI colors, natural line breaks, and horizontal overflow.
- [x] 4.4 Ensure switching selected sessions clears stale statusline output until the new session snapshot/update arrives.
- [x] 4.5 Add client tests for statusline rendering, ANSI color preservation, unavailable/error state, shortcut hint omission, and session switching.

## 5. Verification

- [x] 5.1 Run the full automated test suite.
- [x] 5.2 Start the dev server and verify in a browser that selecting different sessions shows each session's statusline above the composer.
- [x] 5.3 Verify the statusline refreshes at the configured interval and does not add transcript messages.
