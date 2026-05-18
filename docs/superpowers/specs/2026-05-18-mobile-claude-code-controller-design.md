# Mobile Claude Code Controller Design

## Goal

Build a personal-use mobile web application that controls the real Claude Code CLI running on the user's PC. The mobile experience should feel like a chat interface rather than remote desktop or SSH, while preserving Claude Code's project/session workflow, slash commands, history viewing, and history resume behavior.

The app will be reachable from outside the home network through a private overlay network such as Tailscale or ZeroTier. The PC does not need a public IP address.

## Chosen Approach

Use a local web backend on the PC that wraps the real Claude Code CLI through a PTY. The phone connects to this backend over Tailscale/ZeroTier and interacts through a responsive web UI.

This is preferred over reimplementing Claude Code with the Agent SDK/API because the user's priority is parity with local Claude Code behavior, including slash commands, permissions, and resume. It is also preferred over one-shot non-interactive CLI calls because the app needs long-running interactive sessions.

## Architecture

The system has four layers:

1. **Mobile Web UI**
   - Chat-style interface for selecting projects, selecting sessions, reading output, and sending input.
   - Supports normal messages and `/` commands.
   - Shows common permission prompts as buttons while allowing raw text input for unrecognized interactions.

2. **Local Web Backend**
   - Runs on the user's PC and binds only to localhost and/or the Tailscale/ZeroTier private address.
   - Provides authentication, project/session APIs, WebSocket/SSE streaming, and PTY lifecycle management.
   - Owns the mapping between web-visible sessions and Claude Code CLI sessions.

3. **Claude Code Session Manager**
   - Starts Claude Code in a project directory using a PTY.
   - Supports new sessions and resume/continue for existing Claude Code sessions.
   - Streams PTY output to the web client and writes user input back to the PTY.
   - Tracks process status, recent output cache, current interaction state, and session metadata.

4. **Local Data Layer**
   - Treats Claude Code's native history as the main source for historical conversations.
   - Stores only web app metadata: project whitelist, display aliases, session mappings, runtime state, and recent output cache.
   - Reads Claude Code history without modifying it.

## Core Components

### Auth

The app is personal-use but must still require authentication. The MVP can use a locally generated high-entropy access token. Later versions can add username/password login and secure session cookies.

### Project Registry

The app exposes only explicitly configured project directories. The phone UI cannot submit arbitrary filesystem paths. Each project record stores a display name, absolute path, favorite state, and recent session references.

### Session Registry

The registry unifies web-created sessions and sessions discovered from Claude Code history. It stores the project, source type, Claude session identifier when available, display metadata, last active time, and runtime status.

### PTY Runner

The PTY runner starts `claude` in a selected project directory, resumes historical sessions using Claude Code's native resume/continue mechanism, sends input to the process, and streams output back to the realtime gateway. This is the critical module for preserving local Claude Code behavior.

### Interaction Parser

The parser watches CLI output for common permission prompts, menus, and error states. Recognized interactions are converted into mobile-friendly buttons. Unrecognized output remains visible as raw CLI text, and the user can respond manually through the chat input.

### Realtime Gateway

The gateway uses WebSocket or SSE to stream Claude Code output to the phone and receive user input. It supports reconnect by replaying the recent output cache and current session state.

### History Reader

The reader scans Claude Code's native local history in read-only mode. It extracts available projects, session summaries, message snippets, timestamps, and session identifiers for resume. If the native history format changes, this module can fail independently without breaking new sessions.

## Data Flow

### New Session

1. The user selects a whitelisted project on the phone.
2. The UI requests a new session from the backend.
3. The backend starts `claude` in that project via PTY.
4. PTY output streams to the phone.
5. The user sends normal text or `/` commands through the chat input.
6. The backend writes the input to the PTY.
7. Claude Code performs work, asks for permissions when needed, and emits output.
8. The backend displays plain output, folds tool output where possible, converts known permission prompts to buttons, and falls back to raw text for unknown interactions.
9. The backend stores session metadata and recent output cache, not a full duplicate of Claude Code history.

### Resume Historical Session

1. The History Reader scans Claude Code's native history.
2. The UI displays discovered projects and sessions.
3. The user selects a historical session.
4. The backend starts Claude Code with the appropriate native resume/continue mechanism.
5. If resume succeeds, the historical session becomes an interactive web session.
6. Future input/output uses the same PTY runner and realtime gateway as new sessions.

### Reconnect

1. The phone disconnects or goes to the background.
2. The backend keeps the PTY alive for a configured timeout.
3. On reconnect, the client reattaches to the session.
4. The backend replays recent output and current interaction state.
5. If the PTY exited, the session is marked stopped and can be resumed or restarted manually.

## Security Boundaries

- The service must not be exposed directly to the public internet.
- Remote access should use Tailscale or ZeroTier; the PC does not need a public IP address.
- The web backend must still require authentication even on the private overlay network.
- Project directories must be whitelisted.
- The web app must not provide a generic shell feature.
- Claude Code permission prompts must never be auto-approved by the web app.
- Claude Code native history must be read-only from this app.
- Sensitive project files are not copied into the web app database.

## Error Handling

- If `claude` is missing, unauthenticated, or fails to start, show the specific startup error.
- If a project path no longer exists, mark the project unavailable.
- If resume fails, keep the historical session available as read-only and offer to start a new session in the same project.
- If a permission prompt cannot be parsed, show raw CLI output and allow manual text input.
- If the phone disconnects, keep the PTY alive for a configured timeout and replay recent output on reconnect.
- If the PTY exits, mark the session stopped and offer resume/restart actions.
- If Claude Code history parsing fails, degrade only the history view; new sessions should still work.

## MVP Scope

The first version includes:

- Tailscale/ZeroTier private-network access.
- Token-based app login.
- Project whitelist configuration.
- Mobile project list.
- New Claude Code sessions in selected projects.
- Read-only indexing of Claude Code native history.
- Resume/continue of historical Claude Code sessions when supported by the local CLI.
- Chat-style mobile UI with streaming output.
- Support for normal messages and `/` commands.
- Basic tool-output folding.
- Common permission prompts as buttons.
- Raw text fallback for complex interactions.
- Session status: running, stopped, failed.
- Recent-output replay after mobile reconnect.

## Out of Scope for MVP

- Public unauthenticated access.
- Generic browser shell access.
- Reimplementation of Claude Code with the Agent SDK/API.
- Modifying Claude Code native history files.
- Full reproduction of every Claude Code TUI shortcut and visual detail.
- Background push notifications.
- Multi-user support.
- Multi-device collaborative editing.

## Later Enhancements

- PWA install support.
- Mobile push notifications for completed tasks or permission prompts.
- More structured tool-call display.
- Better permission prompt recognition.
- Session search, favorites, and aliases.
- Multi-device reattach to the same session.
- Audit log for web-triggered inputs and permission decisions.
- Optional Cloudflare Tunnel mode with stronger authentication if private-network access is not enough.

## Acceptance Criteria

- A phone connected through Tailscale/ZeroTier can open the app and log in.
- The app shows whitelisted projects.
- The user can create a Claude Code session in a selected project.
- Claude Code output streams to the phone.
- The user can send normal messages and `/` commands.
- The app can list existing Claude Code history discovered from the PC.
- The user can select a historical session and resume it when Claude Code supports doing so.
- Common permission prompts can be answered with buttons.
- Unrecognized interactions remain usable through raw text input.
- Disconnecting and reconnecting the phone restores recent output for an active session.
- Restarting the backend does not destroy Claude Code native history discovery.

## Testing Strategy

### Unit Tests

- Project whitelist path validation.
- Session state transitions.
- History Reader parsing from representative Claude Code history samples.
- Interaction Parser recognition of permission prompts and fallback behavior.

### Integration Tests

- PTY runner starts a process in a selected working directory.
- WebSocket/SSE streams output and accepts input.
- Resume success and failure paths.
- Client reconnect and recent-output replay.

### Manual Tests

- Start a real Claude Code session from the phone in a real project.
- Send a normal development request.
- Send a `/` command.
- Trigger a permission prompt and answer it from the phone.
- Resume a previous Claude Code session.
- Put the phone browser in the background and confirm reconnect behavior.
