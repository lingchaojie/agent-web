# claude-transcript-restoration Specification

## Purpose
Define how local Claude JSONL history is discovered, safely normalized into app render state, resumed as live sessions, and reconciled with existing app sessions.
## Requirements
### Requirement: Claude history sessions are discoverable as conversation previews
The system SHALL discover local Claude JSONL history sessions for available projects and expose previews that can be opened in the same session browser as live web-created sessions.

#### Scenario: Available project history is listed
- **WHEN** a Claude history JSONL file belongs to an available local project
- **THEN** the session browser shows a preview with title, project, last meaningful message, update time, native Claude session ID, and any matching app session relationship

#### Scenario: Unavailable project history is hidden
- **WHEN** a Claude history JSONL file points to an unavailable or unsafe project path
- **THEN** the system does not expose that history session in the selectable project/session UI

### Requirement: JSONL transcript is normalized into render regions
The system SHALL parse supported Claude JSONL transcript entries into initial render regions compatible with the live CLI-like render state used by structured Claude session events.

#### Scenario: User and assistant messages restore
- **WHEN** a transcript contains user and assistant message entries
- **THEN** the restored snapshot contains ordered user and assistant conversation regions with stable timestamps and source metadata compatible with live structured event metadata

#### Scenario: Tool-like entries restore distinctly
- **WHEN** a transcript contains tool use, tool result, command, or system-like entries that can be identified safely
- **THEN** the restored snapshot represents them as distinct non-prose regions rather than merging them into assistant prose

#### Scenario: Shared render normalizer handles live and restored entries
- **WHEN** equivalent Claude user, assistant, tool, permission, or usage semantics appear in live structured events and restored JSONL entries
- **THEN** both paths map them to compatible render region kinds, active/final statuses, and transient activity behavior

### Requirement: Restored sessions can become live sessions
The system SHALL allow a restored Claude history session to be resumed as a live session while preserving restored regions as the initial conversation snapshot and preserving the native Claude session identity used by local Claude Code resume.

#### Scenario: Resume restored session
- **WHEN** the user resumes a discovered Claude history session
- **THEN** the app starts Claude Code in resume mode with the restored transcript's native Claude session ID and the active conversation first displays restored historical regions before new live deltas arrive

#### Scenario: New live output after resume
- **WHEN** Claude emits new structured output after a restored session is resumed
- **THEN** the new output appends or updates regions after the restored sequence without duplicating restored transcript content

#### Scenario: Continued restored session remains native-resumable
- **WHEN** the user sends a new prompt in a web session that was created from a restored Claude history transcript
- **THEN** the prompt continues the same native Claude session so the local Claude Code client can later resume the combined conversation

#### Scenario: Resume lacks structured metadata
- **WHEN** the resumed Claude session cannot expose enough structured metadata to deduplicate against restored history
- **THEN** the system enters explicit degraded fallback or pauses implementation rather than appending guessed PTY transcript content as if it were authoritative

### Requirement: Restored history deduplicates against live app sessions
The system SHALL avoid creating duplicate restored app sessions when the requested native Claude history session is already represented by an existing app session.

#### Scenario: Existing app session for history resume
- **WHEN** the user requests resume for a discovered Claude history session whose native session ID is already stored on an app session
- **THEN** the system returns or activates the existing app session rather than creating a second restored snapshot from the same transcript

#### Scenario: No existing app session for history resume
- **WHEN** the user requests resume for a discovered Claude history session whose native session ID is not associated with an app session
- **THEN** the system creates one restored app session seeded from the transcript and stores the native Claude session ID on that session

### Requirement: Transcript restoration is bounded and safe
The system SHALL parse local history files with size limits, symlink protections, invalid-line tolerance, and no execution of transcript content.

#### Scenario: Oversized transcript is skipped
- **WHEN** a transcript file exceeds the configured maximum safe size
- **THEN** the reader skips that file and continues discovering other sessions

#### Scenario: Invalid transcript line is ignored
- **WHEN** a transcript contains malformed JSON lines
- **THEN** the reader ignores malformed lines and still restores valid entries from the same transcript

### Requirement: Any session can open native JSONL transcript history
The system SHALL allow users to open a transcript history view for either a live app session or a discovered Claude history session, using the local Claude JSONL transcript associated with the native Claude session ID when available.

#### Scenario: Open history session transcript without starting Claude
- **WHEN** a user opens a discovered Claude history session from the session browser
- **THEN** the app displays its local JSONL transcript history in read-only mode
- **AND** the app does not start a Claude process unless the user explicitly resumes the session

#### Scenario: Open live app session transcript by native identity
- **WHEN** a user opens a live app session that has a stored native Claude session ID
- **THEN** the app displays transcript history read from the matching local Claude JSONL file for that native session ID
- **AND** live session updates remain available for new activity

#### Scenario: Live app session identity is not known yet
- **WHEN** a user opens a live app session before its native Claude session ID is known
- **THEN** the app displays the live session stream state
- **AND** the app can switch or offer transcript history once the native Claude session ID is observed

### Requirement: Transcript history loads latest entries first with older-on-scroll pagination
The system SHALL load a bounded latest window of normalized transcript regions by default and load older transcript regions when the user scrolls upward.

#### Scenario: Initial transcript window shows latest context
- **WHEN** a user opens any session with an available local Claude JSONL transcript
- **THEN** the app displays the latest bounded window of normalized user, assistant, tool, and interaction regions in chronological order
- **AND** the response indicates whether older regions are available

#### Scenario: Upward scroll loads older regions
- **WHEN** the user scrolls to the top of a transcript view that has older regions available
- **THEN** the app requests the next older transcript window
- **AND** the returned older regions are prepended without duplicating already visible regions
- **AND** the user's scroll position remains anchored around the previously topmost visible region

#### Scenario: Transcript pagination reaches the beginning
- **WHEN** the user loads older transcript windows until no earlier regions remain
- **THEN** the app stops requesting older pages for that transcript
- **AND** the visible transcript remains ordered from oldest loaded region to newest loaded region

#### Scenario: Unsafe or unavailable transcript is not exposed
- **WHEN** the matching local Claude JSONL transcript is missing, oversized, malformed beyond recoverable entries, or outside the available project path rules
- **THEN** the system returns a safe error or empty transcript state without executing transcript content

