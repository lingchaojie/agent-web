## Why

The chat composer currently sends raw text only, so users must leave the input flow for native Claude Code actions such as resuming a session or invoking slash-command-driven workflows. Users who already know Claude Code expect `/` commands to be discoverable, filterable, and selectable directly from the composer, matching the native client experience.

## What Changes

- Add slash-command awareness to the chat composer when the user types `/` at the start of a command token.
- Show native-style matching suggestions with keyboard and pointer selection, including highlighted matches and clear empty-state feedback.
- Support `/resume` from the chat box by opening an inline picker backed by the existing project-scoped Claude history/session resume data.
- Support discoverable skill/custom-command-style entries as selectable slash commands when the server can enumerate them safely from the local Claude configuration.
- Route recognized UI-owned commands through app workflows instead of sending them as raw prompts; send normal text prompts unchanged.
- Preserve mobile and desktop composer ergonomics while keeping existing side-rail session controls available.

## Capabilities

### New Capabilities
- `native-chat-slash-commands`: Defines command discovery, matching, selection, execution, and composer behavior for native Claude Code-like slash commands in chat.

### Modified Capabilities

## Impact

- Affects the React chat composer, command suggestion UI, keyboard handling, and mobile layout styling.
- Adds server/API support for exposing safe command metadata and resume-picker candidates to the composer.
- Reuses existing project/session/history resume infrastructure for `/resume` execution.
- Does not introduce breaking API changes; existing chat submission and side-rail resume flows remain supported.
