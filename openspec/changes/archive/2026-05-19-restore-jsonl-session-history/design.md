## Context

The app already has two related models for session content:

- Live app sessions stream durable blocks and a CLI-like `SessionRenderState` over WebSocket.
- Local Claude JSONL transcripts are discovered as `HistorySession` previews and can seed a resumed app session.

The current live input path appends a durable user block, but the primary chat UI prefers `SessionRenderState` when present. Because the render state is only updated from Claude semantic events, user prompts sent through the web composer can be missing from the visible right-hand session surface.

History viewing is also split: live sessions are opened through the real-time stream, while historical sessions expose only a snapshot preview. Users need a single mental model: click any session and see the native Claude conversation history from local JSONL, with recent context first and older context loaded on demand.

## Goals / Non-Goals

**Goals:**

- Make web-sent user prompts visible as stable user regions in the CLI-like render surface immediately after successful send.
- Let users open either a live app session or a Claude history session into a transcript view backed by local Claude JSONL when a native session ID is known.
- Load the latest transcript window by default and fetch older entries as the user scrolls upward.
- Preserve live streaming behavior for active sessions and restored-session resume/deduplication semantics.
- Keep transcript reading bounded, ordered, and safe.

**Non-Goals:**

- Do not implement full-text transcript search.
- Do not merge or rewrite native Claude JSONL files for display pagination.
- Do not create a remote/cloud history store.
- Do not require a live app session before a native history transcript can be viewed.

## Decisions

### Render user input through the same render-state path

When a web composer input is accepted, the server should append the durable user block as it does today and also update/broadcast the render state with a final user region. This keeps the current persistence model while fixing the UI path that prefers render state over blocks.

Alternative considered: force the client to render durable blocks alongside render state. That risks duplicate assistant/tool regions and weakens the existing CLI-like render-state boundary.

### Add a transcript-window API instead of returning entire JSONL files

Expose a bounded transcript window for a native Claude session ID, with metadata for whether older entries exist and a cursor for the next older page. The initial request returns the latest N normalized regions. Subsequent upward-scroll requests return older windows.

Alternative considered: return the entire transcript snapshot and let the client slice it. That is simpler but contradicts the desired lazy loading behavior and can make large transcripts expensive.

### Resolve transcript identity from app sessions when possible

For live app sessions, use the stored native `claudeSessionId` to locate the local JSONL transcript. For pure history sessions, use the history item native session ID directly. If a live app session does not yet have a native Claude session ID, fall back to the live stream view until identity is observed.

Alternative considered: invent an app-session-only transcript. That would not satisfy the requirement to read all interactions from native local Claude JSONL.

### Keep live stream and history window separate but visually unified

Opening a running app session should still subscribe to live stream updates. The transcript view can show JSONL history as the historical base and then apply live deltas for new activity when available. Pure stopped history sessions do not need a live WebSocket subscription unless resumed.

Alternative considered: always resume history sessions before showing them. That would unexpectedly start Claude processes and blur read-only viewing with execution.

## Risks / Trade-offs

- JSONL transcript may lag behind live stream writes → Show live stream deltas for active sessions and refresh/reload transcript windows when needed.
- User prompt could duplicate if it appears in both JSONL and live delta after refresh → Dedupe by stable region identity derived from transcript position/event IDs plus live block IDs where available.
- Large JSONL files can be expensive to scan backward → Keep existing file size limits and implement bounded page reads; if backward scanning is impractical initially, parse within the safe cap and slice windows server-side.
- Sessions without native `claudeSessionId` cannot use JSONL history immediately → Use live stream state until `session-identity-observed` updates identity.
- Scroll-up pagination can disturb viewport position → Preserve scroll anchor when prepending older regions.
