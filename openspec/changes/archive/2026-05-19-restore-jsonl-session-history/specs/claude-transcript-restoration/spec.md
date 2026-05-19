## ADDED Requirements

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
