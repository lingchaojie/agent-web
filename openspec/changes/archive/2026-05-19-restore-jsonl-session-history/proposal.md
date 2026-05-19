## Why

Newly sent user prompts in live sessions are not visible in the main session surface, which makes the conversation feel broken even though Claude receives the input. Session browsing also splits live sessions from local Claude history, so users cannot click any session and reliably review the full native JSONL transcript with scalable loading.

## What Changes

- Ensure user prompts sent from a live web session become visible user regions in the CLI-like render surface before Claude's response appears.
- Add a unified session history view for both live app sessions and Claude history sessions, backed by local Claude JSONL transcripts when a native Claude session ID is known.
- Default history rendering to the latest transcript window and load older transcript entries when the user scrolls upward.
- Preserve current resume behavior: history sessions can still be resumed, and existing app sessions continue to deduplicate by native Claude session ID.
- Keep transcript parsing bounded and safe; no transcript content is executed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-cli-like-render-state`: Live user prompts must appear as stable user-visible render regions in the active session surface.
- `claude-transcript-restoration`: Local Claude JSONL history must be openable for both live and historical sessions with latest-first initial loading and older-on-scroll pagination.

## Impact

- Server APIs: add or extend history snapshot/window endpoints for app sessions and native Claude history sessions.
- Server services: enhance JSONL transcript reading to support bounded windows and cursor-based older-page loading.
- Session streaming/rendering: include user input in render state, not only in durable block fallback state.
- Client UI: allow opening live or history sessions into the same transcript view, defaulting to the latest JSONL interactions and loading older entries on upward scroll.
- Tests: cover user prompt render visibility, unified history open behavior, pagination boundaries, and deduplication with existing app sessions.
