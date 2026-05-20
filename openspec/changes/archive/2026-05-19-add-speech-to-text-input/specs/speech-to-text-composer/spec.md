## ADDED Requirements

### Requirement: Composer exposes voice input mode
The system SHALL allow users to switch the chat composer between text entry and speech dictation without leaving the active session.

#### Scenario: User switches to voice input
- **WHEN** the user activates the voice-input toggle in an enabled chat composer
- **THEN** the composer shows a hold-to-speak control and keeps the existing typed text available for later review or submission

#### Scenario: User returns to text input
- **WHEN** the user activates the keyboard/text toggle from voice-input mode
- **THEN** the composer shows the normal text entry controls with any existing typed or transcribed text preserved

#### Scenario: Composer is disabled
- **WHEN** the chat composer is disabled because the session cannot accept input
- **THEN** the speech input controls are disabled consistently with text submission controls

### Requirement: Hold-to-speak captures speech while pressed
The system SHALL start speech recognition when the user presses and holds the voice control and stop recognition when the hold ends.

#### Scenario: Press begins recognition
- **WHEN** the user presses and holds the voice control on a browser with speech recognition support and microphone access
- **THEN** the composer enters a listening state and begins collecting speech recognition results for that hold

#### Scenario: Release finalizes recognition
- **WHEN** the user releases the voice control after speaking
- **THEN** the composer stops listening and waits for any final recognition result from that hold

#### Scenario: Continuous speech during hold
- **WHEN** the user continues speaking while holding the voice control
- **THEN** the composer keeps recognition active and accumulates finalized transcript chunks until the hold ends or recognition fails

#### Scenario: Hold is cancelled
- **WHEN** the user cancels the hold through pointer cancellation, drag-away cancellation, or an explicit cancel affordance
- **THEN** the composer aborts the active recognition attempt and does not insert the cancelled hold's uncommitted interim text

### Requirement: Speech transcription populates the composer without sending
The system SHALL place finalized recognized text into the composer input for review and MUST NOT submit it automatically.

#### Scenario: Final transcript is inserted
- **WHEN** speech recognition returns finalized text for a completed hold
- **THEN** the composer inserts that text into the existing input value and keeps the send button under user control

#### Scenario: Interim transcript is previewed
- **WHEN** speech recognition returns interim text before finalization
- **THEN** the composer may show the interim text as listening feedback without treating it as submitted or durable composer text

#### Scenario: Dictation does not auto-send
- **WHEN** recognized text is inserted into the composer
- **THEN** no WebSocket input message is sent until the user explicitly submits the composer

#### Scenario: Existing text is preserved
- **WHEN** the composer already contains text before speech dictation completes
- **THEN** the recognized text is added without deleting the existing text

### Requirement: Unsupported and failed speech recognition is non-destructive
The system SHALL keep normal text input usable when speech recognition is unsupported, denied, or fails.

#### Scenario: Browser lacks speech recognition support
- **WHEN** the user opens voice-input mode on a browser without a supported speech recognition API
- **THEN** the composer shows that voice input is unavailable and leaves normal text input available

#### Scenario: Microphone permission is denied
- **WHEN** speech recognition cannot start because microphone access is denied or unavailable
- **THEN** the composer shows a concise error state and does not change or submit the existing input text

#### Scenario: Recognition fails mid-hold
- **WHEN** speech recognition reports an error during an active hold
- **THEN** the composer exits the listening state, preserves any text already committed before the failed hold, and leaves the user able to retry or type

### Requirement: Voice audio is not persisted by the app
The system SHALL NOT persist voice audio captured for speech dictation in client storage, server storage, chat transcript history, or session events.

#### Scenario: Dictation completes
- **WHEN** a speech dictation hold completes successfully
- **THEN** the app stores only the resulting composer text and does not store an audio file or audio blob

#### Scenario: Dictation is cancelled or fails
- **WHEN** a speech dictation hold is cancelled or fails
- **THEN** the app discards the active recognition attempt without storing audio data

#### Scenario: Prompt is sent after dictation
- **WHEN** the user later submits composer text that includes transcribed speech
- **THEN** the session receives only the text prompt through the existing input path and no audio payload
