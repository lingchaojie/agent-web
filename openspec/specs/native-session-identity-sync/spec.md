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

### Requirement: Web prompts update Claude resume picker history
The system SHALL append Claude Code-compatible history index entries for web prompts after a web app session is associated with a native Claude session ID.

#### Scenario: First web prompt after native identity is known
- **WHEN** the user sends input in a web session whose native Claude session ID is known
- **THEN** the server appends an entry to the shared Claude `history.jsonl` with the prompt display text, project path, timestamp, and native Claude session ID

#### Scenario: Duplicate resume index entry
- **WHEN** the same project, prompt display, and native Claude session ID have already been indexed
- **THEN** the server does not append a duplicate history index entry

#### Scenario: Native identity is not known yet
- **WHEN** the user sends input before the web session has observed a native Claude session ID
- **THEN** the server defers the prompt index entry and writes it with the native Claude session ID once that identity is observed

### Requirement: Web prompt transcripts are visible in native resume picker
The system SHALL keep successful web prompt-mode turns eligible for the local Claude Code `/resume` picker for the same project and native session.

#### Scenario: Successful web prompt turn exits
- **WHEN** a web-created or web-resumed prompt-mode turn exits successfully after the session has a native Claude session ID
- **THEN** the system normalizes that native transcript's web prompt-mode entries so the local Claude Code `/resume` picker treats the session as a native interactive session

#### Scenario: Web prompt turn fails
- **WHEN** a web prompt-mode turn exits with a non-zero status
- **THEN** the system does not normalize the native transcript for resume picker visibility

### Requirement: Native sync requires shared Claude config
The system SHALL only claim native/web session synchronization when the web server and local Claude Code client use the same Claude configuration and transcript directory.

#### Scenario: Shared config directory is configured
- **WHEN** the configured Claude history directory is the same directory used by the local Claude Code client
- **THEN** web-created prompt-mode transcripts are discoverable by the local client's `/resume` flow

#### Scenario: Shared config directory is unavailable
- **WHEN** the web server cannot access the local Claude Code transcript directory
- **THEN** the system keeps web sessions functional but does not report them as synchronized with local `/resume`
