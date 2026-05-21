## MODIFIED Requirements

### Requirement: Speech transcription populates the composer without sending
The system SHALL place finalized recognized text into the composer input for review and MUST NOT submit it automatically. The underlying speech recognition behavior SHALL be reusable by other text-input surfaces, including live terminal input, without requiring the old composer UI.

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

#### Scenario: Recognition behavior is reused outside composer
- **WHEN** another input surface uses the speech recognition adapter
- **THEN** it receives interim, final, error, and end callbacks without depending on the composer component

### Requirement: Voice audio is not persisted by the app
The system SHALL NOT persist voice audio captured for speech dictation in client storage, server storage, chat transcript history, session events, or terminal session events.

#### Scenario: Dictation completes
- **WHEN** a speech dictation hold completes successfully
- **THEN** the app stores only the resulting text and does not store an audio file or audio blob

#### Scenario: Dictation is cancelled or fails
- **WHEN** a speech dictation hold is cancelled or fails
- **THEN** the app discards the active recognition attempt without storing audio data

#### Scenario: Prompt is sent after dictation
- **WHEN** the user later submits text that includes transcribed speech
- **THEN** the session receives only the text prompt through the existing input path and no audio payload
