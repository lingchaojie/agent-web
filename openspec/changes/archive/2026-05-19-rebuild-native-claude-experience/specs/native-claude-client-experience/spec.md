## ADDED Requirements

### Requirement: Native Claude-like application shell
The system SHALL render an application shell that closely follows the native Claude client layout: a persistent session/project rail on wide screens, a single focused conversation canvas, a sticky composer, and drawer-style navigation on narrow screens.

#### Scenario: Wide screen shell
- **WHEN** an authenticated user opens the app on a wide viewport
- **THEN** the UI displays a left rail for projects and sessions, a main conversation canvas, and a composer anchored to the conversation area without requiring page-level scrolling for normal message input

#### Scenario: Narrow screen shell
- **WHEN** an authenticated user opens the app on a narrow mobile viewport
- **THEN** project/session navigation is reachable through drawer or stacked navigation while the active conversation remains the primary view after a session is selected

### Requirement: Conversation block rendering
The system SHALL render conversation content as typed blocks instead of raw terminal messages, with distinct native-style treatments for user prompts, assistant responses, tool/activity summaries, system notices, and interactive permission or choice prompts.

#### Scenario: Tool output is shown as a native-style card
- **WHEN** a conversation contains a tool or command block
- **THEN** the UI renders it as a collapsible or summarized card distinct from assistant prose

#### Scenario: Interactive prompt is actionable
- **WHEN** Claude requests permission or presents a choice
- **THEN** the UI renders the prompt inline with clear native-style action controls and does not require the user to type the raw terminal selection manually

### Requirement: Animated status transitions
The system SHALL render Claude lifecycle and activity changes as replaceable animated UI state, not as transcript blocks, while respecting reduced-motion preferences.

#### Scenario: Working state replaces idle state
- **WHEN** a running session changes from idle to working
- **THEN** the status indicator animates or transitions in place to the working state without appending a chat message

#### Scenario: Reduced motion is respected
- **WHEN** the user agent reports reduced-motion preference
- **THEN** status changes remain visible but use non-motion or minimal-motion transitions

### Requirement: Streaming visual continuity
The system SHALL show in-progress assistant output as a stable block that updates until finalized, preserving scroll position and avoiding duplicate visible bubbles during streaming.

#### Scenario: Assistant block updates while streaming
- **WHEN** the server sends multiple updates for the same assistant response
- **THEN** the UI updates one visible assistant block rather than rendering one block per chunk

#### Scenario: User scroll is not stolen
- **WHEN** new stream updates arrive while the user has scrolled away from the bottom of the conversation
- **THEN** the UI preserves the user's scroll position and provides a clear way to jump to the latest content

### Requirement: Native-style empty and error states
The system SHALL provide polished empty, loading, disconnected, failed, and unauthenticated states that fit the same native-Claude-like visual system.

#### Scenario: No session selected
- **WHEN** the user has selected a project but no session
- **THEN** the main canvas displays a calm native-style empty state with clear actions to start, continue, or resume a session

#### Scenario: Realtime connection fails
- **WHEN** the active session WebSocket disconnects unexpectedly
- **THEN** the UI shows a non-destructive disconnected state with retry or reconnect feedback without losing the last rendered conversation blocks
