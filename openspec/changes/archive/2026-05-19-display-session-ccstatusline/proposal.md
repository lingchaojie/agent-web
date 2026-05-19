## Why

The web client currently shows live Claude sessions and transient activity, but it does not show the local Claude Code `ccstatusline` output that users rely on in the native client. Showing the same statusline per selected session makes the web UI feel consistent with the local Claude Code client while preserving session-specific context, usage, model, and git/worktree cues.

## What Changes

- Add a compact, fixed statusline panel above the composer for the currently selected session.
- Reuse the local Claude Code `statusLine.command` output, including ANSI color formatting, instead of rebuilding statusline fields in the web UI.
- Refresh statusline output per session using the configured `statusLine.refreshInterval` and push updates live to subscribed clients.
- Bind statusline state to the selected session so switching sessions immediately shows that session's latest statusline output.
- Hide local-only keyboard shortcut hints such as `(shift+tab to cycle)` from the web statusline display.
- Show command failures or unavailable statusline data as a compact non-transcript status state.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `native-claude-client-experience`: add a native-client-like fixed statusline panel for the active web session.
- `resumable-session-streaming`: extend the session stream contract with ordered, session-scoped statusline snapshots and updates.

## Impact

- Client UI: `ChatView` and related styling/rendering for the compact statusline panel above the composer.
- Shared types/reducers: session stream event and state additions for statusline snapshots and live updates.
- Server realtime flow: read local Claude Code statusLine settings, execute the configured command with session-specific stdin context, refresh on the configured interval, and broadcast updates per subscribed session.
- Tests: server statusline execution/streaming tests, shared reducer tests, and client rendering/session-switching tests.
