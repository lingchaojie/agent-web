# structured-claude-session-events Specification

## Purpose
Define how live Claude Code behavior is discovered and consumed through typed structured events instead of terminal transcript scraping.

## Requirements

### Requirement: Structured Claude event source discovery
The system SHALL discover and select the best available structured Claude Code session event source before using live output as renderable session content.

#### Scenario: Structured source is available
- **WHEN** Claude Code exposes a supported structured output, JSONL, SDK, or session event mechanism in the current environment
- **THEN** the server records that capability and starts the live session with structured events as the authoritative render source

#### Scenario: Structured source is unavailable
- **WHEN** no supported structured Claude event source can be verified
- **THEN** the server marks the session as degraded PTY fallback and does not silently treat terminal scraping as native-parity structured semantics

#### Scenario: Multiple structured sources are available
- **WHEN** more than one supported structured event mechanism is detected
- **THEN** the system selects the source with stable event identifiers, explicit ordering, and complete user/assistant/tool/permission coverage before lower-fidelity sources

### Requirement: Claude event adapter contract
The system SHALL expose live Claude behavior through a typed `ClaudeEventSource` boundary rather than through terminal text classification.

#### Scenario: User and assistant events stream
- **WHEN** Claude receives a user prompt and emits assistant response events
- **THEN** the adapter emits typed user-message and assistant-message lifecycle events with stable ordering metadata suitable for a render-state reducer

#### Scenario: Tool events stream
- **WHEN** Claude starts, updates, or completes a tool or command action
- **THEN** the adapter emits typed tool-use events that can update tool panels or tool activity regions distinct from assistant prose

#### Scenario: Permission or choice prompt streams
- **WHEN** Claude requests permission or presents choices
- **THEN** the adapter emits structured prompt events with action identifiers and labels suitable for inline UI controls

#### Scenario: Activity events stream
- **WHEN** Claude emits thinking, token usage, model, hook, redraw, or lifecycle status changes
- **THEN** the adapter emits activity or usage events that update transient state without creating visible render regions

#### Scenario: Unknown structured entry appears
- **WHEN** the selected structured source emits an unrecognized schema entry
- **THEN** the adapter preserves ordering, records safe diagnostic metadata, and does not convert the unknown entry into assistant prose or a normal visible message

### Requirement: PTY fallback separation
The system SHALL keep PTY output separate from structured transcript semantics whenever a structured event source is active.

#### Scenario: PTY emits chrome while structured source is active
- **WHEN** terminal output contains Claude Code status, spinner, model, token, hook, or redraw text during a structured session
- **THEN** the server may update coarse activity state but SHALL NOT create or update visible render regions from that PTY output

#### Scenario: PTY fallback is active
- **WHEN** the session explicitly runs in degraded PTY fallback mode
- **THEN** visible regions may be produced by the existing terminal normalizer with fallback source metadata and regression coverage for known chrome leakage

### Requirement: Structured fixture coverage
The system SHALL cover structured event parsing and render-reducer behavior with fixtures before integrating it into live session streaming.

#### Scenario: Fixture represents assistant streaming
- **WHEN** a fixture contains assistant start, delta, and completed events
- **THEN** tests verify that one active assistant region is created, updated, and finalized in order

#### Scenario: Fixture represents tools and permissions
- **WHEN** a fixture contains tool-use and permission or choice events
- **THEN** tests verify that the resulting render state contains distinct tool and interaction regions rather than merged assistant prose
