## ADDED Requirements

### Requirement: Claude history sessions are discoverable as conversation previews
The system SHALL discover local Claude JSONL history sessions for available projects and expose previews that can be opened in the same session browser as live web-created sessions.

#### Scenario: Available project history is listed
- **WHEN** a Claude history JSONL file belongs to an available local project
- **THEN** the session browser shows a preview with title, project, last meaningful message, and update time

#### Scenario: Unavailable project history is hidden
- **WHEN** a Claude history JSONL file points to an unavailable or unsafe project path
- **THEN** the system does not expose that history session in the selectable project/session UI

### Requirement: JSONL transcript is normalized into conversation blocks
The system SHALL parse supported Claude JSONL transcript entries into the same ordered conversation block model used by live sessions.

#### Scenario: User and assistant messages restore
- **WHEN** a transcript contains user and assistant message entries
- **THEN** the restored snapshot contains ordered user and assistant conversation blocks with stable timestamps and source metadata

#### Scenario: Tool-like entries restore distinctly
- **WHEN** a transcript contains tool use, tool result, command, or system-like entries that can be identified safely
- **THEN** the restored snapshot represents them as distinct non-prose blocks rather than merging them into assistant prose

### Requirement: Restored sessions can become live sessions
The system SHALL allow a restored Claude history session to be resumed as a live session while preserving restored blocks as the initial conversation snapshot.

#### Scenario: Resume restored session
- **WHEN** the user resumes a discovered Claude history session
- **THEN** the app starts Claude Code in resume mode and the active conversation first displays restored historical blocks before new live deltas arrive

#### Scenario: New live output after resume
- **WHEN** Claude emits new output after a restored session is resumed
- **THEN** the new output appends or updates blocks after the restored sequence without duplicating restored transcript content

### Requirement: Transcript restoration is bounded and safe
The system SHALL parse local history files with size limits, symlink protections, invalid-line tolerance, and no execution of transcript content.

#### Scenario: Oversized transcript is skipped
- **WHEN** a transcript file exceeds the configured maximum safe size
- **THEN** the reader skips that file and continues discovering other sessions

#### Scenario: Invalid transcript line is ignored
- **WHEN** a transcript contains malformed JSON lines
- **THEN** the reader ignores malformed lines and still restores valid entries from the same transcript
