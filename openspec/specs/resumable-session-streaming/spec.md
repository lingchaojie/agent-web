## ADDED Requirements

### Requirement: Session snapshot on subscribe
The system SHALL provide a complete ordered session snapshot when a client subscribes to a session stream.

#### Scenario: Initial subscribe
- **WHEN** a client subscribes to a valid session without an `afterSequence` value
- **THEN** the server sends the current session view state, ordered durable conversation blocks, and latest stream sequence before sending live deltas

#### Scenario: Unknown session subscribe
- **WHEN** a client subscribes to a session that does not exist or is not accessible
- **THEN** the server sends a structured error and does not attach the client to unrelated session events

### Requirement: Ordered stream deltas
The system SHALL emit monotonic ordered deltas for conversation block additions, in-progress block updates, finalized blocks, activity changes, and session lifecycle changes.

#### Scenario: Assistant response streams through one block
- **WHEN** Claude emits multiple chunks for one assistant response
- **THEN** the server emits deltas that add or update a single assistant block until a finalization delta marks it complete

#### Scenario: Duplicate delta is ignored by client reducer
- **WHEN** the client receives a delta sequence it has already applied
- **THEN** the client keeps the existing rendered state and does not duplicate blocks or status transitions

### Requirement: Reconnect recovery
The system SHALL allow a reconnecting client to recover from the last known sequence or receive a fresh snapshot when delta recovery is unavailable.

#### Scenario: Reconnect with recoverable sequence
- **WHEN** a client reconnects with an `afterSequence` value that the server can satisfy
- **THEN** the server sends only the missing deltas after that sequence in order

#### Scenario: Reconnect with stale sequence
- **WHEN** a client reconnects with an `afterSequence` older than retained stream history
- **THEN** the server sends a fresh snapshot that fully replaces the client's session view

### Requirement: Transient activity is not persisted as transcript
The system SHALL keep Claude spinner, thinking, hook, token counter, terminal redraw, and connection activity as transient session state rather than durable conversation blocks.

#### Scenario: Activity frame during thinking
- **WHEN** Claude emits a terminal redraw or progress frame while working
- **THEN** the server updates activity state and does not persist or replay that frame as a transcript block

#### Scenario: Meaningful reply after activity
- **WHEN** Claude emits meaningful assistant text after transient activity frames
- **THEN** the server persists and streams the meaningful text as assistant conversation content

### Requirement: Authoritative session lifecycle state
The system SHALL expose authoritative lifecycle state for running, idle, waiting-for-input, stopping, stopped, and failed sessions.

#### Scenario: Session stops
- **WHEN** the PTY process exits or the user stops a session
- **THEN** all subscribed clients receive a session lifecycle delta showing the stopped state

#### Scenario: Session waits for permission
- **WHEN** Claude presents an actionable permission or choice prompt
- **THEN** the session state indicates that user input is required and the prompt actions are available through structured data
