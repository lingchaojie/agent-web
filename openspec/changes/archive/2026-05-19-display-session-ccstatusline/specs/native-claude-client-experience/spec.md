## ADDED Requirements

### Requirement: Active session statusline panel
The system SHALL render a compact native Claude Code-like statusline panel for the active web session.

#### Scenario: Session selected
- **WHEN** a user opens a live app session in the web client
- **THEN** the conversation view displays a fixed statusline panel above the composer
- **AND** the panel renders the latest statusline output for that session

#### Scenario: Statusline uses command output
- **WHEN** the server provides statusline text containing ANSI color sequences and natural line breaks
- **THEN** the client renders that output in a terminal-like monospace panel preserving color and command-provided line breaks
- **AND** the client does not split the output into separate semantic chips or reconstructed fields

#### Scenario: Local-only shortcut hint omitted
- **WHEN** the local statusline output includes native keyboard shortcut hints such as `(shift+tab to cycle)`
- **THEN** the web statusline panel omits those hints
- **AND** the rest of the statusline output remains visible

#### Scenario: No statusline available
- **WHEN** the active session has no statusline output yet or the statusline command is unavailable
- **THEN** the conversation view shows a compact non-transcript statusline placeholder or error state
- **AND** the composer remains usable when the session connection allows input

#### Scenario: Session switch updates panel
- **WHEN** the user switches from one open session to another
- **THEN** the statusline panel updates to the newly selected session's latest statusline output
- **AND** statusline output from the previously selected session is not shown for the new session
