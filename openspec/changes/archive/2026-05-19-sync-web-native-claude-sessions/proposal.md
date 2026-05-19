## Why

Web-created or web-continued conversations are not reliably visible to the local Claude Code client and cannot always be recovered with `/resume`, likely because the web server runs Claude through non-interactive `claude -p` stream-json invocations while tracking its own app session IDs separately from Claude Code's native session IDs.

Users need the web app and local Claude Code client to treat the same conversation as the same resumable Claude session, so work started or continued in either surface remains discoverable and recoverable from the other.

## What Changes

- Capture and persist the authoritative Claude Code `session_id` emitted by stream-json events for web-created and web-continued sessions.
- Align web session creation, continuation, and history resume around Claude Code's native session identity instead of only the app-generated UUID.
- Refresh or expose local Claude history so web sessions whose native transcripts are created by `claude -p` appear in the same history/session browser and can be resumed without duplication.
- Add reconciliation behavior for sessions that start before the native `session_id` is known, including updating the app session record once Claude emits it.
- Add tests covering native session ID persistence, web-to-native resume visibility, and resume-from-history continuation without duplicate transcript blocks.

## Capabilities

### New Capabilities
- `native-session-identity-sync`: Keeps web app sessions and local Claude Code session history synchronized through the native Claude session ID.

### Modified Capabilities
- `claude-transcript-restoration`: Restored and resumed history sessions must preserve the native Claude session identity across live continuation.
- `resumable-session-streaming`: Live stream snapshots and deltas must expose stable native session identity once known.

## Impact

- Server session lifecycle and persistence: `src/server/routes/sessionRoutes.ts`, `src/server/services/sessionRegistry.ts`, `src/server/db.ts`, and related types.
- Claude process integration: `src/server/services/claudeEventSource.ts` and semantic event mapping that observes stream-json `session_id` values.
- History discovery/restoration: `src/server/services/claudeHistoryReader.ts`, `src/server/routes/historyRoutes.ts`, and client APIs that list available sessions.
- Shared stream/session contracts: `src/shared/types.ts`, `src/shared/sessionStream.ts`, and tests for stream reducers and route behavior.
- No breaking API removals are expected; existing app session IDs remain internal routing identifiers while native Claude session IDs become the cross-surface resume identity.
