# Tmux Browser Terminal MVP Design

## Purpose

Build a first working prototype where a mobile browser can operate a Claude Code session as if it were attached to a real terminal. The MVP prioritizes terminal fidelity over semantic web rendering: Claude Code's native TUI, slash command menu, statusline, prompts, and redraws should be rendered by the terminal stream itself.

## Scope

The MVP only supports sessions started from the web app. When the web app creates a Claude Code session, the backend creates a dedicated tmux session and runs Claude Code inside it. The browser terminal view attaches to that tmux session through a backend PTY and streams raw terminal bytes to xterm.js.

Out of scope for the MVP:

- Attaching to manually-created existing tmux sessions.
- Multiple browser controllers for the same app session.
- Observer-only clients for the same terminal.
- Force takeover between browser clients.
- Full productized resize policy.
- Replacing the existing structured conversation UI.

Different app sessions can be controlled at the same time. The single-controller limit applies only to one app session / tmux session at a time.

## Architecture

### Backend session startup

On web-created session startup, the backend creates a tmux session named from the app session ID, such as `webagent-<sessionId>`, in the selected project directory. The tmux command runs Claude Code with the same mode arguments currently used by the PTY runner: new session, continue, or resume.

The backend records an in-memory mapping from app session ID to tmux session name for the MVP. Stopping an app session kills the tmux session and marks the app session stopped. Browser attach disconnects must not kill tmux or Claude Code.

### Browser terminal attach

The browser terminal endpoint uses the mature web-terminal pattern:

```text
tmux session running Claude Code
        ^
        |
tmux attach-session inside backend PTY
        ^
        |
WebSocket raw terminal byte stream
        ^
        |
xterm.js in browser
```

When a browser opens terminal mode, the server validates the app session, confirms a tmux session exists, and starts a PTY process running `tmux attach-session -t webagent-<sessionId>`. PTY output is sent over WebSocket as terminal output messages. Browser input is written back to that PTY.

The server keeps one active terminal attach per app session. If another browser tries to attach to the same session while an active attach exists, the server rejects it with a clear status message. When the WebSocket closes, the server kills only the attach PTY and releases the active attach slot.

### Frontend terminal view

The frontend adds a terminal mode view backed by xterm.js. The view is mobile-first and separate from the structured conversation renderer.

The layout has:

- A compact header with project/session title, connection state, and a return button.
- A full-height xterm.js terminal area.
- A persistent mobile shortcut key bar.

The shortcut key bar includes:

- `Esc`
- `Tab`
- `Ctrl+C`
- `Ctrl+D`
- `↑`
- `↓`
- `←`
- `→`
- optionally `Enter` if it improves mobile use when the software keyboard is hidden.

Normal typing uses xterm.js input events. Shortcut buttons send explicit terminal control sequences, for example `Ctrl+C` as `\x03`, `Ctrl+D` as `\x04`, and `Esc` as `\x1b`.

## Slash Command Behavior

Slash command behavior must be rendered by Claude Code's native terminal UI, not reconstructed as React components. When the user types `/`, Claude Code's own slash menu, filtering, selection highlight, descriptions, and confirmation behavior appear in xterm.js exactly as terminal output.

The browser does not parse slash command semantics. It only forwards input and renders PTY output. The shortcut key bar must support operating slash command menus with `↑`, `↓`, `Tab`, `Enter`, and `Esc`.

## Protocol

The MVP terminal WebSocket can be a new endpoint such as `/api/terminal/ws` or a namespaced terminal message flow. A dedicated endpoint is preferred for isolation from structured session streaming.

Minimum client-to-server messages:

- `attach`: app session ID.
- `input`: raw input/control sequence string.
- `resize`: optional rows and columns for basic fit behavior.
- `detach`: optional explicit detach.

Minimum server-to-client messages:

- `status`: connecting, attached, detached, stopped, unavailable, rejected.
- `output`: raw terminal data.
- `error`: human-readable failure.

The MVP can keep messages JSON-encoded with string payloads. If binary output becomes necessary for fidelity, it can be added later without changing the architecture.

## Lifecycle and Error States

Creating a web session creates both the app session and the tmux session. Opening terminal mode creates only an attach PTY. Closing the browser closes only the attach PTY. Stopping the session kills the tmux session.

The UI handles these states:

- `unavailable`: no tmux session exists for the app session.
- `rejected`: another browser is already actively attached to the same app session.
- `disconnected`: terminal WebSocket closed unexpectedly.
- `stopped`: the app session or tmux session has ended.
- `error`: attach failed or backend returned an unexpected failure.

Each state offers a non-destructive return path to the normal session view.

## Testing and Verification

Automated tests should cover backend and protocol behavior:

- Creating a web session creates the expected tmux session name.
- Stopping the app session kills the corresponding tmux session.
- Closing a browser terminal attach does not kill the tmux session.
- Attaching to an unavailable session returns an error/status message.
- PTY output is forwarded to the WebSocket.
- Browser input is written to the attach PTY.
- A second active attach to the same app session is rejected.
- Closing the active WebSocket releases the attach slot.
- Existing ordinary session list/create/stop behavior still works.

Manual mobile verification is required before calling the MVP complete:

1. Create a new Claude Code session from the web app.
2. Open terminal mode on a phone browser.
3. Confirm Claude Code's native TUI is visible.
4. Type a normal prompt and receive output.
5. Type `/` and confirm the native slash command menu renders correctly.
6. Operate the slash menu with shortcut buttons for `↑`, `↓`, `Tab`, `Enter`, and `Esc`.
7. Use `Ctrl+C` to interrupt input or running output.
8. Close and reopen the browser terminal view; confirm Claude Code remains alive in tmux.
9. Stop the session and confirm the tmux session exits and the terminal view shows stopped/unavailable state.

## Follow-Up Work

After the MVP proves the terminal experience works, future phases can add:

- Attach to manually-created existing tmux sessions.
- Observer-only clients.
- Force takeover.
- More complete resize policy.
- Better mobile keyboard and selection UX.
- Productized reconnect status and terminal session discovery.
