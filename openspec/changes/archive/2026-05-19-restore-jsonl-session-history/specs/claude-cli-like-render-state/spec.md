## ADDED Requirements

### Requirement: Web-sent user prompts render as stable regions
The system SHALL render each user prompt sent through the web session composer as a stable user-visible region in the CLI-like render state before assistant, tool, or interaction output produced in response is displayed.

#### Scenario: User prompt appears in active live session surface
- **WHEN** a user sends a prompt through the web composer for a structured live session
- **THEN** the session surface displays that prompt as a final user region in the right-hand conversation view
- **AND** subsequent assistant or tool regions appear after the user region

#### Scenario: User prompt is not duplicated by fallback blocks
- **WHEN** the same user prompt is represented in durable conversation blocks and the CLI-like render state
- **THEN** the client displays one user-visible region for that prompt in the primary session surface

#### Scenario: Prompt remains visible after reconnect
- **WHEN** a client reconnects to the same live session after sending a prompt
- **THEN** the recovered snapshot or deltas include the user prompt in the render state order without requiring the client to reconstruct it from local form state
