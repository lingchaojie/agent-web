# native-session-identity-sync Specification

## Purpose
Define how web-created and web-resumed app sessions persist native Claude session identity so they stay synchronized with local Claude Code history and resume flows.

## Requirements

### Requirement: Web sessions persist native Claude identity
The system SHALL persist the authoritative native Claude session ID for every web-created or web-continued session once Claude emits that identity.

#### Scenario: New web session emits native identity
- **WHEN** a web-created Claude process emits a stream-json event containing `session_id`
- **THEN** the app session record is updated with that native Claude session ID without changing the app session route ID

#### Scenario: Native identity is delayed
- **WHEN** a web-created session starts before any native Claude session ID is known
- **THEN** the session remains usable and is reconciled after the first valid native Claude session ID is observed

#### Scenario: Native identity is already known
- **WHEN** a resumed history session starts with a known native Claude session ID
- **THEN** the app session uses that native ID when launching Claude and preserves it on subsequent updates

### Requirement: Native identity reconciles local history and app sessions
The system SHALL use the native Claude session ID to relate local Claude transcript history entries and web app session records that represent the same conversation.

#### Scenario: History entry has active app session
- **WHEN** local history discovery finds a transcript whose session ID matches an existing app session's native Claude session ID
- **THEN** the API exposes the relationship so the client can continue the existing app session instead of creating a duplicate conversation

#### Scenario: Resume request matches existing native session
- **WHEN** the web app receives a resume request for a native Claude session ID that is already associated with an app session
- **THEN** the system reuses or returns the existing app session identity rather than seeding duplicate restored blocks into a new app session

### Requirement: Native sync requires shared Claude config
The system SHALL only claim native/web session synchronization when the web server and local Claude Code client use the same Claude configuration and transcript directory.

#### Scenario: Shared config directory is configured
- **WHEN** the configured Claude history directory is the same directory used by the local Claude Code client
- **THEN** web-created prompt-mode transcripts are discoverable by the local client's `/resume` flow

#### Scenario: Shared config directory is unavailable
- **WHEN** the web server cannot access the local Claude Code transcript directory
- **THEN** the system keeps web sessions functional but does not report them as synchronized with local `/resume`
