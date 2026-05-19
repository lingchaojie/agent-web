## 1. Verify Native Claude Identity Behavior

- [x] 1.1 Run or fixture-test `claude -p --output-format=stream-json` behavior to confirm where `session_id` appears for new, continue, and resume modes.
- [x] 1.2 Add regression fixtures for stream-json events that include immediate and delayed native `session_id` values.

## 2. Persist Native Session Identity

- [x] 2.1 Update app session persistence so `claudeSessionId` can be set or updated after session creation.
- [x] 2.2 Teach the Claude event source or semantic mapper to surface native `session_id` observations from stream-json events.
- [x] 2.3 Update the session registry lifecycle so observed native IDs are stored on the existing app session without changing the app session ID.
- [x] 2.4 Add server tests proving new web-created sessions persist native Claude IDs when events arrive late or immediately.

## 3. Stream Native Identity to Clients

- [x] 3.1 Extend shared session snapshot/delta types to include native Claude session identity updates.
- [x] 3.2 Update stream reducers to apply native identity metadata idempotently without resetting conversation blocks.
- [x] 3.3 Update realtime hub/session snapshot generation to include known native Claude session IDs on subscribe.
- [x] 3.4 Add shared and server stream tests for native identity snapshots, deltas, and duplicate deltas.

## 4. Reconcile History and Live Sessions

- [x] 4.1 Add lookup support for finding existing app sessions by native Claude session ID.
- [x] 4.2 Update history listing or resume APIs to expose or reuse existing app sessions when a transcript maps to a known native ID.
- [x] 4.3 Ensure resume-from-history launches Claude with `-r <native-session-id>` and stores that ID on the app session before new output streams.
- [x] 4.4 Add route tests covering history resume deduplication and continued restored sessions staying native-resumable.

## 5. Client Integration

- [x] 5.1 Update client session/history models to display or retain native session identity where needed for deduplication.
- [x] 5.2 Update session selection/resume UI behavior so duplicate history entries prefer the existing app session when the API reports one.
- [x] 5.3 Add client tests for opening existing app sessions from matched history entries and for identity updates during an active stream.

## 6. Validation

- [x] 6.1 Run the targeted server, shared, and client tests for session identity, history restoration, and stream reducers.
- [x] 6.2 Manually verify a web-created session appears in the local Claude Code `/resume` list when both use the same Claude config directory.
- [x] 6.3 Manually verify resuming that same session from web app and local Claude Code appends to one native transcript rather than creating duplicate conversations.
