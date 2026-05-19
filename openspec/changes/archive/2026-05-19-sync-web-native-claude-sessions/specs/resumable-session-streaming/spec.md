## MODIFIED Requirements

### Requirement: Session snapshot on subscribe
The system SHALL provide a complete ordered session snapshot when a client subscribes to a session stream, including the native Claude session ID when it is known.

#### Scenario: Initial subscribe
- **WHEN** a client subscribes to a valid session without an `afterSequence` value
- **THEN** the server sends the current session view state, ordered durable conversation blocks, latest stream sequence, and known native Claude session ID before sending live deltas

#### Scenario: Unknown session subscribe
- **WHEN** a client subscribes to a session that does not exist or is not accessible
- **THEN** the server sends a structured error and does not attach the client to unrelated session events

## ADDED Requirements

### Requirement: Native identity updates stream to clients
The system SHALL emit ordered stream deltas when a session's native Claude session ID becomes known or is reconciled.

#### Scenario: Native identity discovered during live stream
- **WHEN** Claude emits a native `session_id` after a client has already subscribed to the app session stream
- **THEN** the server sends an ordered delta containing the native Claude session ID without replacing or duplicating conversation blocks

#### Scenario: Duplicate native identity update
- **WHEN** the client receives a native identity delta for the same native Claude session ID it has already applied
- **THEN** the client keeps the existing rendered state and does not reset the conversation stream
