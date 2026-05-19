## MODIFIED Requirements

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
The system SHALL allow a restored Claude history session to be resumed as a live structured session while preserving restored regions as the initial conversation snapshot.

#### Scenario: Resume restored session
- **WHEN** the user resumes a discovered Claude history session
- **THEN** the app starts Claude Code in resume mode and the active conversation first displays restored historical regions before new live deltas arrive

#### Scenario: New live output after resume
- **WHEN** Claude emits new structured output after a restored session is resumed
- **THEN** the new output appends or updates regions after the restored sequence without duplicating restored transcript content

#### Scenario: Resume lacks structured metadata
- **WHEN** the resumed Claude session cannot expose enough structured metadata to deduplicate against restored history
- **THEN** the system enters explicit degraded fallback or pauses implementation rather than appending guessed PTY transcript content as if it were authoritative
