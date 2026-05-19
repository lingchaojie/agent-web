# Sync local Claude Code CLI sessions to mobile webagent

## Goal

Make the mobile webagent show and control explicitly exposed local Claude Code CLI sessions that are already running in tmux. A phone connected only to this webagent backend should be able to see those sessions, watch live output, send input, and choose permission actions without switching to the host machine.

The same work also fixes the current history display issues: non-direct agent output should be collapsible, running sessions should not appear stopped, live content should refresh, and Claude history titles should match Claude Code's native `/resume` list.

## Scope

In scope:

- Discover and attach only to explicitly exposed tmux panes running Claude Code.
- Stream output from those panes to the existing WebSocket session UI.
- Send mobile input and permission choices back to the exposed tmux pane.
- Align webagent history/session titles with Claude Code `/resume` titles after verifying the native title source.
- Render tools, thinking, skill loads, fetches, and other non-direct agent content as collapsible sections.
- Improve mobile state labels for running and externally attached sessions.

Out of scope:

- Automatically attaching to every terminal or every tmux pane.
- Reliable control of non-tmux or bare-terminal Claude Code processes.
- Killing externally owned tmux sessions from webagent.
- Replacing the existing webagent-created session runner.

## Current behavior

webagent currently distinguishes live sessions it started from Claude JSONL history. Sessions created by webagent use the existing runner, `RealtimeHub`, and WebSocket events. Historical sessions are read from Claude JSONL under the Claude config directory and shown as recoverable history.

The current model has four limitations for this change:

1. It cannot discover or control Claude Code CLI sessions that were started outside webagent.
2. Historical title extraction is not yet proven to match Claude Code's native `/resume` list.
3. Some non-direct agent content is dropped or rendered like ordinary transcript content instead of collapsible detail.
4. Mobile UI state is driven by app session status and can show stopped/disconnected wording for content that is still running externally or not refreshing.

## Design

### 1. External tmux session discovery

Add an external tmux session source alongside existing web-created and history-backed sessions. Discovery scans only panes that are explicitly exposed to webagent.

Supported exposure markers:

- Preferred: `WEBAGENT_EXPOSE=1` in the pane process environment when it can be read safely.
- Fallback: a configured tmux session, window, or pane title/name convention such as a `webagent` marker.

Discovery should not infer control from process name alone. This avoids accidentally sending input to the wrong terminal.

Each exposed pane maps to a stable app session record. The stable identity should be derived from tmux server identity plus session/window/pane identity, not just a display name. Project ownership is inferred from pane current path and only shown if that path maps to a whitelisted project or an available Claude history project.

If the exposed pane disappears, loses its marker, or moves outside an allowed project, the app session becomes disconnected/read-only rather than continuing to accept input.

### 2. Title alignment with Claude Code `/resume`

Do not hard-code JSONL `summary` as the title source. Implementation starts by verifying how Claude Code native `/resume` builds its displayed titles for the same local history.

After verification, webagent should use the same source and fallback order. The requirement is behavioral: for the same Claude session, if Claude Code `/resume` displays a title, webagent displays that same title.

For an external tmux pane whose Claude session id is not yet known, webagent may temporarily display a tmux-derived label or cwd-derived fallback. Once the Claude session id is identified, the title updates to the `/resume`-aligned title.

### 3. Live output synchronization

For each attached tmux pane, run a lightweight watcher that periodically captures pane output with tmux. The watcher compares the current capture against the previous snapshot and emits only new or changed content into the existing realtime stream path.

The emitted events should reuse the existing WebSocket snapshot/event architecture so mobile clients reconnect and catch up the same way they do for webagent-created sessions.

External tmux sessions should have a distinct transcript source label, such as `tmux-capture`, because they are not structured stream-json sessions. When structured boundaries cannot be inferred, output is displayed conservatively as terminal text. Permission and choice prompts should still be parsed into interaction regions when recognizable.

### 4. Mobile input and permission actions

Mobile input for an attached external session is delivered with `tmux send-keys` to the exact pane that is still marked as exposed and still belongs to the same allowed project.

After sending input, webagent appends a local user-message event immediately so the mobile UI gives instant feedback instead of waiting for the next capture poll. Echo suppression should prevent the same input from appearing twice if tmux later captures it from the pane.

Permission choices reuse the existing `PromptActions` flow. The tmux capture path parses prompts into action ids and input strings. Clicking an action sends the corresponding key/text to the pane.

The stop button should not kill external tmux sessions. For external sessions it should mean detach, hide, or disconnect control. webagent-created sessions keep the existing stop behavior.

### 5. Collapsible non-direct transcript content

History parsing should classify non-direct agent content as collapsible regions rather than ordinary assistant text. This includes:

- tool use
- tool results
- thinking
- skill load prompts
- fetch/tool prompts and outputs
- other system or agent metadata that is not a direct user/assistant reply

Direct user messages and assistant prose remain expanded. Collapsible regions should have useful summaries derived from their content, such as tool name, command, fetch target, or system prompt category.

The same rendering component should handle historical collapsible regions and realtime structured/tool regions where possible.

### 6. State labels and refresh behavior

Running external sessions should not show `已停止` when opened. The UI should distinguish:

- running and connected
- working
- waiting for input
- disconnected/read-only
- stopped or failed for app-owned sessions

Opening a running external session should subscribe to live events and keep refreshing while the watcher is active. If refresh stops because the pane is gone or no longer exposed, the UI should show a disconnected/read-only state.

## Components and data flow

### Backend components

- `TmuxPaneDiscovery`: finds explicitly exposed panes, resolves project path, and produces stable attachment candidates.
- `TmuxPaneAdapter`: captures pane output, computes deltas, and sends input/actions with tmux.
- `SessionRegistry` changes: persist external tmux session source, external attachment identity, and transcript source where needed.
- `RealtimeHub` changes: accept tmux-capture output and route it through the existing stream event path.
- `ClaudeResumeTitleReader`: encapsulates the verified `/resume` title source and fallback order.
- `claudeHistoryReader` / semantic mapping changes: preserve collapsible non-direct content instead of dropping it.

### Frontend components

- Session list: show external attached sessions in the live session area with clear source/status text.
- Chat view: keep WebSocket subscriptions active for external sessions; send input/actions through the same UI path.
- Render surface/transcript view: render non-direct content as collapsed detail sections with meaningful summaries.
- Status chips: use external-aware labels instead of treating every non-app-owned transcript as stopped.

### Data flow

1. Discovery finds an exposed tmux pane and resolves its project path.
2. The backend creates or updates an app session record with source `external-tmux`.
3. A watcher captures pane output and emits stream events.
4. Mobile opens the session and receives snapshot plus subsequent events over WebSocket.
5. Mobile sends input or action.
6. Backend revalidates the pane marker and project ownership, then sends keys to tmux.
7. If Claude session identity/title becomes known, backend updates the app session title to match Claude Code `/resume`.

## Error handling and safety

- If `tmux` is unavailable, external session discovery is disabled and existing webagent-created/history flows continue to work.
- If a pane disappears, the session becomes disconnected and input is rejected.
- If a pane no longer has the exposure marker, input is rejected.
- If a pane cwd no longer maps to an allowed project, input is rejected.
- If capture output cannot be diffed cleanly, emit a conservative refresh block rather than guessing a semantic boundary.
- Do not delete or kill user-owned tmux sessions by default.

## Testing

Automated tests should cover:

- Claude `/resume` title source verification and fallback behavior.
- History JSONL mapping for tool use, tool result, thinking, skill/system prompts, and normal user/assistant messages.
- tmux discovery filtering for exposed versus unexposed panes.
- Stable identity generation for tmux panes.
- Capture snapshot diffing and echo suppression.
- Input/action rejection when the pane is gone, unmarked, or outside the allowed project.
- Frontend state labels for running, working, waiting, disconnected, stopped, and failed sessions.

Manual/browser verification should cover:

- Historical non-direct agent content is collapsible.
- Claude history titles match native `/resume` titles.
- An exposed tmux Claude Code session appears on mobile as a live session.
- Output refreshes while the tmux CLI is running.
- Mobile input reaches the tmux pane.
- Permission/choice buttons send the correct selection.
- External detach does not kill the tmux process.

## Rollout

Implement behind explicit tmux exposure requirements rather than a global auto-scan. Existing webagent-created sessions and history restore behavior should remain available throughout the change.
