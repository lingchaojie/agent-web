# Terminal-First Repair Design

## Goal

Fix three regressions in the terminal-first flow without expanding scope: duplicate live sessions, terminal slash input focus, and the read-only history UI.

## Scope

- Live session list must not duplicate app-created tmux sessions as external tmux sessions.
- Browser terminal must receive normal keyboard input reliably, including `/`, so Claude Code can render its native command list.
- History transcript view must use a read-only terminal-like log layout.
- Do not reintroduce conversation/composer mode for live sessions.
- Do not modify `start-prod.sh`.

## Design

### 1. Prevent duplicate live sessions

`TmuxSessionSync` discovers external tmux panes from `exposedTmuxPanes()`. App-created sessions use `webagent-*` tmux session names and should be attachable through the app session record, not rediscovered as `external-tmux` sessions.

Filter app-owned tmux sessions out of external discovery. Keep manually exposed sessions discoverable through `WEBAGENT_EXPOSE=1` or existing external naming rules when they are not app-owned.

### 2. Keep terminal keyboard focus on xterm

`TerminalView` should focus the xterm instance after opening and after attach status is received. Clicking the terminal panel should also focus xterm. Input remains gated until attached, but once attached, normal typed data including `/` must be sent as terminal input over `/api/terminal/ws`.

### 3. Replace history transcript UI with terminal-like read-only log

`TranscriptView` should stop rendering history through the live `SessionRenderSurface`. It should render a dark read-only log with simple prefixes:

- `user` blocks: prompt-style line.
- `assistant` blocks: response-style line.
- tool/system/other blocks: subdued log sections, collapsed or visually secondary by default.

The history view remains read-only and keeps load-older behavior.

## Testing

- Unit-test tmux discovery so `webagent-*` app-owned sessions are not returned as external panes.
- Unit-test `TerminalView` focus behavior and `/` input forwarding after attach.
- Unit-test `TranscriptView` terminal-like rendering and absence of `structured` implementation labels.
- Run focused tests, typecheck, full test suite, and build.

## Manual verification

On mobile width:

1. Create a new session, go back to project list, re-enter the project. The live session should not duplicate.
2. Open the terminal and type `/`. Claude Code should receive the slash and show its native command list.
3. Open a history item body. It should show a read-only terminal-like log, not the old structured UI.
