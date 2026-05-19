# native-chat-slash-commands Specification

## Purpose
TBD - created by archiving change add-native-chat-slash-commands. Update Purpose after archive.
## Requirements
### Requirement: Slash command suggestions appear in the chat composer
The system SHALL detect leading slash-command queries in the chat composer and present filtered native-style suggestions without sending input to Claude.

#### Scenario: Leading slash opens suggestions
- **WHEN** the user types `/` or starts a command token with `/` at the beginning of the composer text
- **THEN** the composer shows a command suggestion list ordered by match quality and marks the first enabled match as active

#### Scenario: Non-command slash remains prompt text
- **WHEN** the user types a slash that is not part of the leading command token
- **THEN** the composer does not open command suggestions and the text remains eligible for normal prompt submission

#### Scenario: No command matches
- **WHEN** the leading slash query does not match any available command entry
- **THEN** the composer shows an empty suggestion state and does not execute any command on Enter unless the user submits the raw prompt intentionally

### Requirement: Slash command suggestions are selectable accessibly
The system SHALL allow users to inspect and select slash command suggestions with keyboard, pointer, and mobile-friendly controls.

#### Scenario: Keyboard navigation selects a command
- **WHEN** the command suggestion list is open and the user presses ArrowDown, ArrowUp, Tab, Enter, or Escape
- **THEN** the composer updates active selection, accepts the selected command, or closes the list according to native command-picker expectations without breaking normal textarea editing when the list is closed

#### Scenario: Pointer selection accepts a command
- **WHEN** the user clicks or taps an enabled command suggestion
- **THEN** the composer accepts that suggestion and applies the command's defined behavior

#### Scenario: Command match is highlighted
- **WHEN** a suggestion matches the typed query by command name, alias, or description
- **THEN** the visible suggestion identifies the command, support status, scope, and matched text clearly enough to distinguish similar entries

### Requirement: Resume command opens project-scoped resume choices
The system SHALL support `/resume` from the chat composer as an app-owned command that lists resumable sessions for the active project and opens or resumes the selected session.

#### Scenario: Resume command lists current project history
- **WHEN** the user selects or types `/resume` in a chat for an active project
- **THEN** the composer shows resumable Claude history entries for that project, including entries already associated with live app sessions

#### Scenario: Resume existing app session
- **WHEN** the user chooses a `/resume` candidate that already has an app session relationship
- **THEN** the app opens the existing app session instead of creating a duplicate resumed session

#### Scenario: Resume history session
- **WHEN** the user chooses a `/resume` candidate without an app session relationship
- **THEN** the app invokes the existing resume workflow for that native Claude session and selects the resulting live session

#### Scenario: No resumable sessions
- **WHEN** `/resume` is active for a project with no available history entries
- **THEN** the composer shows a non-destructive empty state and leaves the current session unchanged

### Requirement: Command catalog exposes safe command metadata
The system SHALL expose a bounded command catalog for slash-command suggestions without executing discovered command content or exposing sensitive file contents.

#### Scenario: Built-in commands are available
- **WHEN** the client requests command suggestions
- **THEN** the response includes app-supported built-in commands such as `/resume` with labels, descriptions, support status, and execution behavior metadata

#### Scenario: Local command metadata is discovered safely
- **WHEN** local Claude configuration or project command metadata can be read from expected command locations
- **THEN** the response includes command names and short descriptions while excluding full command bodies and unsafe paths

#### Scenario: Command discovery is unavailable
- **WHEN** local command metadata cannot be read safely
- **THEN** the response still includes app-supported built-in commands and reports no discovered commands rather than failing the composer

### Requirement: Supported and unsupported commands have explicit behavior
The system SHALL distinguish app-owned commands, prompt-insertable commands, and unsupported commands before any input is sent to Claude.

#### Scenario: App-owned command is intercepted
- **WHEN** the user accepts an app-owned command such as `/resume`
- **THEN** the app executes the command workflow in the UI and does not send `/resume` as raw session input

#### Scenario: Prompt-insertable command is accepted
- **WHEN** the user accepts a prompt-insertable discovered command
- **THEN** the composer inserts the command text for review without claiming the command has executed

#### Scenario: Unsupported command is selected
- **WHEN** the user selects a command that is known but not supported in the web app
- **THEN** the composer explains that the command is unavailable in this client and does not send or execute it automatically

### Requirement: Existing prompt submission remains unchanged
The system SHALL preserve existing chat submission behavior for ordinary prompts and for sessions without an active command selection.

#### Scenario: Normal prompt submits through WebSocket
- **WHEN** the composer contains non-empty text that is not accepted as an app-owned slash command
- **THEN** the app sends the text through the existing session WebSocket input message and clears the composer after successful send

#### Scenario: Disconnected session disables command execution
- **WHEN** the chat session is not connected or no session is selected
- **THEN** command execution and prompt submission controls remain disabled consistently with the existing composer state

