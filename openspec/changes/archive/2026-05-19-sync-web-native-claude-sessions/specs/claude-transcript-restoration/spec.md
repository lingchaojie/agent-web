## MODIFIED Requirements

### Requirement: Restored sessions can become live sessions
The system SHALL allow a restored Claude history session to be resumed as a live session while preserving restored blocks as the initial conversation snapshot and preserving the native Claude session identity used by local Claude Code resume.

#### Scenario: Resume restored session
- **WHEN** the user resumes a discovered Claude history session
- **THEN** the app starts Claude Code in resume mode with the restored transcript's native Claude session ID and the active conversation first displays restored historical blocks before new live deltas arrive

#### Scenario: New live output after resume
- **WHEN** Claude emits new output after a restored session is resumed
- **THEN** the new output appends or updates blocks after the restored sequence without duplicating restored transcript content

#### Scenario: Continued restored session remains native-resumable
- **WHEN** the user sends a new prompt in a web session that was created from a restored Claude history transcript
- **THEN** the prompt continues the same native Claude session so the local Claude Code client can later resume the combined conversation

## ADDED Requirements

### Requirement: Restored history deduplicates against live app sessions
The system SHALL avoid creating duplicate restored app sessions when the requested native Claude history session is already represented by an existing app session.

#### Scenario: Existing app session for history resume
- **WHEN** the user requests resume for a discovered Claude history session whose native session ID is already stored on an app session
- **THEN** the system returns or activates the existing app session rather than creating a second restored snapshot from the same transcript

#### Scenario: No existing app session for history resume
- **WHEN** the user requests resume for a discovered Claude history session whose native session ID is not associated with an app session
- **THEN** the system creates one restored app session seeded from the transcript and stores the native Claude session ID on that session
