# claude-cli-like-render-state Specification

## Purpose
Define the CLI-like render-state model that converts structured Claude events into stable user-visible regions and transient activity state.
## Requirements
### Requirement: CLI-like render state
The system SHALL render live Claude sessions from a CLI-like render state rather than from a raw event-by-event chat transcript.

#### Scenario: Structured events do not become one visible bubble each
- **WHEN** Claude Code emits structured `system`, `assistant`, `stream_event`, tool, status, usage, or lifecycle entries
- **THEN** the client does not render those entries one-for-one as separate chat bubbles
- **AND** only user-visible semantic regions appear in the session surface

#### Scenario: Active assistant output updates in place
- **WHEN** Claude streams text deltas for one assistant response
- **THEN** the render state maintains one active assistant output region and updates its text in place until completion
- **AND** intermediate deltas do not create repeated assistant rows

#### Scenario: Transient status replaces itself
- **WHEN** Claude emits thinking, requesting, model, token, hook, usage, or progress status
- **THEN** the render state updates a transient status area
- **AND** the transient status is not persisted as transcript content and is not replayed as a historical message

#### Scenario: Tool activity is separate from assistant prose
- **WHEN** Claude emits tool-use, command, or tool-result events
- **THEN** the render state represents them as a tool panel or tool activity region distinct from assistant prose
- **AND** the tool metadata is not merged into assistant text

#### Scenario: Permission or choice is an inline control
- **WHEN** Claude requests permission or presents a choice
- **THEN** the render state exposes an inline interaction control with actionable choices
- **AND** the user is not required to type raw terminal selection text unless running in explicit degraded fallback mode

### Requirement: Structured events are render inputs only
The system SHALL treat Claude Code structured events as inputs to a render reducer, not as the UI model itself.

#### Scenario: System and thinking events are control data
- **WHEN** structured events include `system/status`, `thinking_delta`, `signature_delta`, hook responses, or usage payloads
- **THEN** those entries may influence activity/status/debug metadata
- **AND** they do not create visible transcript regions by default

#### Scenario: Unknown structured entries are safe by default
- **WHEN** the selected structured source emits an unrecognized entry
- **THEN** the render reducer records safe diagnostic metadata or transient activity
- **AND** it does not show the raw entry as assistant prose or as a normal chat bubble

### Requirement: Mobile CLI-like behavior
The system SHALL preserve the native CLI-like streaming interaction model on mobile.

#### Scenario: Composer remains reachable during streaming
- **WHEN** assistant output, tool activity, or status changes stream on a mobile viewport
- **THEN** the composer remains reachable and the session surface scrolls within the chat area rather than the whole page becoming unusable

#### Scenario: Long output streams without layout churn
- **WHEN** Claude emits a long assistant response
- **THEN** the active output region grows or scrolls predictably without creating many small bubbles or stealing scroll unexpectedly

### Requirement: Web-sent user prompts render as stable regions
The system SHALL render each user prompt sent through the web session composer as a stable user-visible region in the CLI-like render state before assistant, tool, or interaction output produced in response is displayed.

#### Scenario: User prompt appears in active live session surface
- **WHEN** a user sends a prompt through the web composer for a structured live session
- **THEN** the session surface displays that prompt as a final user region in the right-hand conversation view
- **AND** subsequent assistant or tool regions appear after the user region

#### Scenario: User prompt is not duplicated by fallback blocks
- **WHEN** the same user prompt is represented in durable conversation blocks and the CLI-like render state
- **THEN** the client displays one user-visible region for that prompt in the primary session surface

#### Scenario: Prompt remains visible after reconnect
- **WHEN** a client reconnects to the same live session after sending a prompt
- **THEN** the recovered snapshot or deltas include the user prompt in the render state order without requiring the client to reconstruct it from local form state

