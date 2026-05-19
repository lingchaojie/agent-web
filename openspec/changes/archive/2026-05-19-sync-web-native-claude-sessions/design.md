## Context

The web app currently creates its own app session ID when `POST /api/sessions` starts Claude, then launches Claude with stream-json prompt mode. Resume-from-history can store a `claudeSessionId`, but new web-created sessions begin with `claudeSessionId: null` even though Claude's stream-json events can later include the native `session_id`. Local Claude Code `/resume` and the history reader are anchored to transcript files under the Claude config directory, whose JSONL filename corresponds to the native Claude session ID.

This means the app can display and continue a conversation internally while the native Claude Code client cannot reliably discover that same conversation, or the web UI can create a second app session for a native transcript that is already associated with a live web session.

## Goals / Non-Goals

**Goals:**

- Persist the authoritative native Claude `session_id` as soon as it appears in stream-json events.
- Keep app session IDs for HTTP/WebSocket routing while using native Claude session IDs for cross-surface resume identity.
- Ensure web-created, web-continued, and web-resumed sessions converge on one native transcript and do not duplicate restored blocks.
- Expose native session identity in session snapshots/deltas so clients can reconcile after the ID becomes known.
- Add tests for new sessions, continuation, history resume, and stream reducer behavior.

**Non-Goals:**

- Replacing the stream-json integration with an interactive PTY.
- Implementing full bidirectional live co-editing between an already-open native Claude terminal and the web app.
- Modifying Claude Code's transcript storage format.
- Supporting remote machines whose web server and local Claude Code client do not share the same Claude config directory.

## Decisions

### Use native Claude `session_id` as the cross-surface identity

The app will keep its generated app session ID as the stable internal route key, but it will persist the first authoritative Claude `session_id` emitted by stream-json events and treat that as the identity used for native resume and transcript matching.

Alternatives considered:
- Use the app UUID as the only session key. This does not help local Claude Code because `/resume` is transcript/native-session based.
- Derive identity from the transcript file path after process exit. This is too late for live reconciliation and brittle while a session is running.
- Stop using `claude -p` and run an interactive native client process. This is a larger architecture change and would risk losing the structured stream-json events the web UI already depends on.

### Reconcile app sessions when the native ID becomes known

The Claude event source will surface native session identity updates from stream-json events. The session registry/database will update the app session's `claudeSessionId` when a non-empty native ID is observed. Stream snapshots and deltas will include that native ID so connected clients can update their local view without changing the app session route.

Alternatives considered:
- Require the native ID before creating the app session. Claude may only emit it after launch, so this would make session creation awkward and delay WebSocket subscription.
- Create a second app session once the native ID is known. That would fragment web state and increase duplication risk.

### Deduplicate history and live sessions by native ID

History listing and resume should recognize when a discovered native transcript already maps to an existing app session. In that case the UI/API should prefer the existing app session or expose enough metadata to continue it rather than creating duplicate web sessions seeded from the same transcript.

Alternatives considered:
- Keep history and live sessions separate. This preserves current boundaries but allows duplicate sessions for the same native transcript.
- Hide all history entries that have any app session. That loses useful recovery behavior after a web session stops unless the app session record remains resumable.

### Continue resumed history with `claude -r <native-session-id>`

When web resumes a history session, follow-up turns must continue the native transcript identified by the JSONL filename, not the app session UUID. Existing restored blocks remain snapshot seed data; new stream events append after the restored sequence.

Alternatives considered:
- Use `claude -c` for history continuation. `-c` selects the most recent session and can drift to the wrong transcript when multiple sessions exist.
- Always start a fresh prompt-mode session from restored text. That would not make the native client see one continuous conversation.

## Risks / Trade-offs

- Native `session_id` event is missing or delayed → Keep the app session usable with `claudeSessionId: null`, then reconcile when a valid ID appears; tests should cover delayed identity.
- `claude -p` may write transcripts differently than the interactive client → Verify with integration or fixture coverage that prompt-mode runs emit `session_id` and create JSONL files under the shared Claude config directory.
- Duplicate app sessions may already exist for one native transcript → Prefer deterministic lookup by `claudeSessionId` for new resume attempts and leave existing records intact rather than destructive migration.
- Client state may change identity mid-stream → Treat native ID as metadata on the session, not as the reducer key for conversation blocks.
- Shared config directory assumption may not hold in containerized deployments → Document and enforce that native sync requires the web server process to use the same Claude config directory as the local Claude Code client.

## Migration Plan

1. Add persistence support for native Claude session IDs on app sessions if the current database schema does not fully support updating that field after creation.
2. Update the Claude event source and registry callback flow to emit/persist native `session_id` observations.
3. Update session snapshots/deltas and client reducers to carry native session identity.
4. Update history listing/resume APIs to reconcile discovered transcripts against existing app sessions by native ID.
5. Add tests and fixtures for new-session identity capture, resumed history continuation, and deduplication behavior.
6. Rollback is safe by ignoring the new native identity fields in clients; app session IDs remain valid internal route keys.

## Open Questions

- Does the installed Claude Code version always emit `session_id` for `claude -p --output-format=stream-json` before or during the first response? Implementation should verify this against the local CLI and keep delayed capture support.
- Should the session browser visually merge live app sessions and local history sessions, or should it keep sections separate while linking duplicates? The backend should provide enough identity metadata for either UI treatment.
