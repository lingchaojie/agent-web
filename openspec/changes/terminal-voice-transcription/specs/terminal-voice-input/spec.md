## ADDED Requirements

### Requirement: Terminal exposes voice dictation control
The system SHALL provide a speech dictation control inside live browser terminal sessions when the terminal session is active.

#### Scenario: Live terminal is open
- **WHEN** the user opens a running live session in the browser terminal
- **THEN** the terminal UI shows a voice dictation affordance without showing the old chat composer

#### Scenario: Terminal is unavailable
- **WHEN** the live terminal cannot accept input because it is detached, stopped, rejected, or unavailable
- **THEN** the terminal voice dictation control is disabled or hidden consistently with terminal input availability

### Requirement: Terminal dictation inserts text at the active cursor
The system SHALL insert finalized speech recognition text through the terminal input path at the current terminal cursor and MUST NOT submit it automatically.

#### Scenario: Final transcript arrives
- **WHEN** speech recognition returns finalized text while a terminal dictation hold is active
- **THEN** the system sends that text to the active terminal session as input data without adding Enter

#### Scenario: User submits after dictation
- **WHEN** the user presses Enter after transcribed text has been inserted into the terminal
- **THEN** Claude Code receives the submitted prompt through the normal terminal input flow

#### Scenario: Existing prompt text is present
- **WHEN** the Claude Code prompt already contains text before dictation completes
- **THEN** finalized transcript text is inserted after the current terminal cursor without clearing existing terminal input

### Requirement: Terminal dictation previews interim speech safely
The system SHALL show interim speech recognition text as temporary dictation feedback without sending interim text to the terminal.

#### Scenario: Interim transcript arrives
- **WHEN** speech recognition returns interim text during a terminal dictation hold
- **THEN** the terminal UI shows the interim text as listening feedback and does not send it to the terminal input WebSocket

#### Scenario: Interim becomes final
- **WHEN** speech recognition later returns final text for the same hold
- **THEN** only the finalized text is inserted into the terminal input path

### Requirement: Terminal dictation is non-destructive on cancellation or failure
The system SHALL keep the terminal session usable and avoid inserting cancelled or failed speech text.

#### Scenario: Hold is cancelled
- **WHEN** the user cancels a terminal dictation hold before final text is committed
- **THEN** the system aborts recognition, shows a cancelled state, and does not insert cancelled interim text into the terminal

#### Scenario: Speech recognition fails
- **WHEN** speech recognition reports an error during terminal dictation
- **THEN** the terminal UI shows a concise error message and keeps keyboard terminal input available

#### Scenario: Speech recognition is unsupported
- **WHEN** the browser does not support the speech recognition API
- **THEN** the terminal UI indicates voice input is unavailable and normal terminal typing remains available

### Requirement: Terminal dictation does not persist audio
The system SHALL NOT persist voice audio captured for terminal dictation in client storage, server storage, transcripts, or session events.

#### Scenario: Terminal dictation completes
- **WHEN** terminal speech dictation produces finalized text
- **THEN** the app sends only text input to the terminal and does not store or upload audio

#### Scenario: Terminal dictation is cancelled or fails
- **WHEN** terminal speech dictation is cancelled or fails
- **THEN** the app discards the active recognition attempt without storing audio data
