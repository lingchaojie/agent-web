# resumable-session-streaming Specification

## Purpose
Define the realtime session stream contract that lets clients subscribe, recover, render structured Claude output, and receive native identity updates without duplicating conversation state.

## Requirements

### Requirement: Session snapshot on subscribe
The system SHALL provide a complete ordered session snapshot when a client subscribes to a session stream, including the native Claude session ID when it is known.

#### Scenario: Initial subscribe
- **WHEN** a client subscribes to a valid session without an `afterSequence` value
- **THEN** the server sends the current session view state, ordered durable conversation blocks, current render state, latest stream sequence, and known native Claude session ID before sending live deltas

#### Scenario: Unknown session subscribe
- **WHEN** a client subscribes to a session that does not exist or is not accessible
- **THEN** the server sends a structured error and does not attach the client to unrelated session events

### Requirement: Ordered render-state deltas
The system SHALL emit monotonic ordered deltas for render-region additions, active-region updates, finalization, transient activity changes, native identity changes, and session lifecycle changes, using structured Claude event sequence semantics whenever available.

#### Scenario: Assistant response streams through one active region
- **WHEN** the structured Claude event source emits multiple chunks for one assistant response
- **THEN** the server emits deltas that add or update a single active assistant region until a finalization delta folds it into stable render history

#### Scenario: Duplicate delta is ignored by client reducer
- **WHEN** the client receives a delta sequence it has already applied
- **THEN** the client keeps the existing rendered state and does not duplicate regions, blocks, identity metadata, or status transitions

#### Scenario: Structured output arrives during input delivery
- **WHEN** a user input is delivered successfully and structured Claude output is observed synchronously during that delivery
- **THEN** the stream orders the durable user region before the assistant, tool, or interaction regions produced in response

### Requirement: Reconnect recovery
The system SHALL allow a reconnecting client to recover from the last known sequence or receive a fresh snapshot when delta recovery is unavailable.

#### Scenario: Reconnect with recoverable sequence
- **WHEN** a client reconnects with an `afterSequence` value that the server can satisfy
- **THEN** the server sends only the missing deltas after that sequence in order

#### Scenario: Reconnect with stale sequence
- **WHEN** a client reconnects with an `afterSequence` older than retained stream history
- **THEN** the server sends a fresh snapshot that fully replaces the client's session view

### Requirement: Transient activity is not persisted as transcript
The system SHALL keep Claude spinner, thinking, hook, token counter, terminal redraw, structured usage events, model updates, and connection activity as transient session state rather than durable conversation regions.

#### Scenario: Activity event during thinking
- **WHEN** Claude emits a structured usage/activity event or PTY redraw frame while working
- **THEN** the server updates activity state and does not persist or replay that event as a transcript region

#### Scenario: Meaningful reply after activity
- **WHEN** Claude emits structured assistant message content after transient activity events
- **THEN** the server streams the meaningful text through the active assistant region and finalizes it into stable render history

#### Scenario: PTY chrome during structured session
- **WHEN** a structured session also emits terminal model, token, spinner, hook, or redraw chrome
- **THEN** the stream does not append that PTY text as a durable region

### Requirement: Authoritative session lifecycle state
The system SHALL expose authoritative lifecycle state for running, idle, waiting-for-input, stopping, stopped, failed, and degraded-fallback sessions.

#### Scenario: Session stops
- **WHEN** the Claude process exits, the structured event source stops, or the user stops a session
- **THEN** all subscribed clients receive a session lifecycle delta showing the stopped state

#### Scenario: Session waits for permission
- **WHEN** Claude presents an actionable permission or choice prompt through structured data or an allowed interaction fallback
- **THEN** the session state indicates that user input is required and the prompt actions are available through structured data

#### Scenario: Structured source becomes unavailable
- **WHEN** a live session cannot obtain or loses its structured event source
- **THEN** all subscribed clients receive lifecycle or activity state indicating degraded PTY fallback before any fallback-derived transcript regions are emitted

### Requirement: Native identity updates stream to clients
The system SHALL emit ordered stream deltas when a session's native Claude session ID becomes known or is reconciled.

#### Scenario: Native identity discovered during live stream
- **WHEN** Claude emits a native `session_id` after a client has already subscribed to the app session stream
- **THEN** the server sends an ordered delta containing the native Claude session ID without replacing or duplicating conversation blocks

#### Scenario: Duplicate native identity update
- **WHEN** the client receives a native identity delta for the same native Claude session ID it has already applied
- **THEN** the client keeps the existing rendered state and does not reset the conversation stream
