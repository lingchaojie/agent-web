## ADDED Requirements

### Requirement: Session statusline stream state
The system SHALL expose session-scoped statusline state through the realtime session stream.

#### Scenario: Initial subscribe includes statusline
- **WHEN** a client subscribes to a valid live app session
- **THEN** the server sends the session snapshot with the latest known statusline state for that session when available
- **AND** the statusline state is separate from durable conversation blocks and render regions

#### Scenario: Statusline refresh update
- **WHEN** the configured statusline refresh interval elapses for a subscribed session
- **THEN** the server executes the configured local `statusLine.command` with stdin context for that session
- **AND** the server sends an ordered statusline update to that session's subscribed clients

#### Scenario: Different sessions keep separate statuslines
- **WHEN** two sessions are subscribed at the same time
- **THEN** each session receives only statusline updates generated from its own session context
- **AND** updates for one session do not overwrite the other session's latest statusline state

#### Scenario: Command failure is streamed as statusline state
- **WHEN** the statusline command exits unsuccessfully, times out, or cannot be started
- **THEN** the server sends a statusline state indicating the failure for that session
- **AND** no statusline failure is appended as a transcript block or render region

#### Scenario: Unsubscribed session does not keep refreshing
- **WHEN** the last realtime client unsubscribes or disconnects from a session
- **THEN** the server stops that session's periodic statusline refresh loop
- **AND** later subscribers receive a fresh snapshot or refresh for that session
