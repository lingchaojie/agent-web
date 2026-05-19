# native-claude-client-experience Specification

## Purpose
Define the native Claude Code-like client experience for layout, conversation rendering, transient status, streaming continuity, and resilient empty or error states.

## Requirements

### Requirement: Native Claude-like application shell
The system SHALL render an application shell that closely follows the native Claude client layout: a persistent session/project rail on wide screens, a single focused conversation canvas, a sticky composer, and drawer-style navigation on narrow screens.

#### Scenario: Wide screen shell
- **WHEN** an authenticated user opens the app on a wide viewport
- **THEN** the UI displays a left rail for projects and sessions, a main conversation canvas, and a composer anchored to the conversation area without requiring page-level scrolling for normal message input

#### Scenario: Narrow screen shell
- **WHEN** an authenticated user opens the app on a narrow mobile viewport
- **THEN** project/session navigation is reachable through drawer or stacked navigation while the active conversation remains the primary view after a session is selected

### Requirement: CLI-like conversation rendering
The system SHALL render live conversation content as a Claude Code CLI-like streaming surface derived from structured Claude session events whenever available, with stable regions for user prompts, assistant responses, tool panels, system notices, and interactive permission or choice prompts.

#### Scenario: Tool output is shown as a native-style card
- **WHEN** structured Claude events identify a tool, command, or tool-result semantic region
- **THEN** the UI renders it as a collapsible or summarized card distinct from assistant prose

#### Scenario: Interactive prompt is actionable
- **WHEN** Claude requests permission or presents a choice through structured event data
- **THEN** the UI renders the prompt inline with clear native-style action controls and does not require the user to type the raw terminal selection manually

#### Scenario: Terminal chrome is not assistant prose
- **WHEN** Claude Code emits status, spinner, model, token, hook, thinking, or redraw output alongside structured events
- **THEN** the UI shows at most transient activity state and never displays that chrome inside assistant prose regions

#### Scenario: Degraded fallback is visible
- **WHEN** the server is using PTY fallback transcript normalization because structured events are unavailable
- **THEN** the UI exposes a non-disruptive degraded-state indicator while still rendering typed regions from the fallback stream

### Requirement: Animated status transitions
The system SHALL render Claude lifecycle, structured usage/activity changes, degraded fallback state, and PTY-only fallback activity as replaceable animated UI state, not as transcript regions, while respecting reduced-motion preferences.

#### Scenario: Working state replaces idle state
- **WHEN** a running session changes from idle to working based on structured activity or lifecycle events
- **THEN** the status indicator animates or transitions in place to the working state without appending a chat message

#### Scenario: Reduced motion is respected
- **WHEN** the user agent reports reduced-motion preference
- **THEN** status changes remain visible but use non-motion or minimal-motion transitions

#### Scenario: Structured source unavailable state appears
- **WHEN** a session enters degraded PTY fallback because structured events are unavailable
- **THEN** the status area communicates degraded mode without adding a transcript region

### Requirement: Streaming visual continuity
The system SHALL show in-progress assistant output as one stable active region that updates until finalized from structured assistant lifecycle events, preserving scroll position and avoiding duplicate visible bubbles during streaming.

#### Scenario: Assistant region updates while streaming
- **WHEN** the server sends structured updates for the same assistant response
- **THEN** the UI updates one visible assistant region rather than rendering one region per chunk

#### Scenario: User scroll is not stolen
- **WHEN** new stream updates arrive while the user has scrolled away from the bottom of the conversation
- **THEN** the UI preserves the user's scroll position and provides a clear way to jump to the latest content

#### Scenario: Reconnect does not duplicate structured content
- **WHEN** a client reconnects after receiving structured live deltas
- **THEN** the restored snapshot or recovered deltas do not duplicate already-rendered user, assistant, tool, or interaction regions

### Requirement: Native-style empty and error states
The system SHALL provide polished empty, loading, disconnected, failed, and unauthenticated states that fit the same native-Claude-like visual system.

#### Scenario: No session selected
- **WHEN** the user has selected a project but no session
- **THEN** the main canvas displays a calm native-style empty state with clear actions to start, continue, or resume a session

#### Scenario: Realtime connection fails
- **WHEN** the active session WebSocket disconnects unexpectedly
- **THEN** the UI shows a non-destructive disconnected state with retry or reconnect feedback without losing the last rendered conversation blocks
