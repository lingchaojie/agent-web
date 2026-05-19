## Context

The app already presents a native Claude Code-like shell with a chat composer, live structured stream rendering, side-rail session controls, and project-scoped Claude history discovery. The composer currently treats every non-empty submission as plain input over `/api/ws`, while `/resume` is only available through the session rail using the existing `/api/sessions/resume` route and history data.

The new behavior should make command discovery available where users type, without replacing the side rail or changing the underlying Claude process protocol. Because the app runs Claude through structured prompt-mode turns, commands that change web app state should be handled by the web app before input reaches Claude, while discoverable prompt/custom/skill entries can be exposed as safe metadata and inserted or submitted through the normal prompt path only when appropriate.

## Goals / Non-Goals

**Goals:**
- Detect leading slash-command queries in the chat composer and show native-style filtered suggestions.
- Provide keyboard, pointer, and mobile-friendly selection for command suggestions.
- Execute `/resume` through the existing app resume/open-session workflow using project-scoped Claude history.
- Expose a safe command catalog for built-in app commands and locally discoverable custom/skill command metadata.
- Keep ordinary prompts, including non-leading slashes, on the existing WebSocket input path.

**Non-Goals:**
- Reimplement every native Claude Code slash command in the first pass.
- Execute arbitrary files or shell commands discovered from Claude configuration.
- Remove the existing side-rail new, continue, resume, or stop controls.
- Add new frontend framework or command-palette dependencies.

## Decisions

1. **Add a composer command layer instead of changing WebSocket input semantics.**
   - The client will parse only the active leading command token before `handleSubmit` sends input. Recognized UI-owned commands, starting with `/resume`, are intercepted and routed through React callbacks. Unrecognized or normal prompt text continues through `sendWs` unchanged.
   - Alternative considered: send slash commands to the running Claude process and let Claude Code handle them. This is unreliable in the current prompt-mode architecture and would blur app-owned workflows such as session selection.

2. **Keep `/resume` project-scoped and backed by existing history/session data.**
   - `App` already owns selected project, filtered history, active sessions, and the resume/open logic. `ChatView` should receive the data and callbacks needed for a resume picker rather than duplicating session state or calling resume APIs independently.
   - Alternative considered: add a dedicated resume WebSocket message. The existing REST route and state updates already solve this, so a new socket operation would add duplicate behavior.

3. **Introduce a bounded command catalog endpoint for metadata only.**
   - The server will expose safe command entries such as built-ins and discoverable local command/skill metadata. Discovery must read only bounded text metadata from expected Claude configuration/project command locations, avoid following unsafe paths, and never execute command content.
   - Alternative considered: hard-code all command entries on the client. That would support `/resume` quickly but would not satisfy custom command and skill discoverability.

4. **Implement matching as shared client utility code with an accessible overlay component.**
   - A focused `SlashCommandPalette`/composer helper can score entries by command name, alias, and description, highlight matched substrings, and manage ArrowUp/ArrowDown/Enter/Tab/Escape selection. This keeps `ChatView` from absorbing all command logic.
   - Alternative considered: inline matching directly in `ChatView`. That would be faster initially but would make the already stateful streaming component harder to test and maintain.

5. **Treat unsupported commands explicitly rather than pretending they ran.**
   - Entries that are discoverable but not executable by the web app should clearly indicate whether selecting them inserts/submits prompt text or is unavailable. The UI must not show success for commands it cannot run.
   - Alternative considered: optimistic pass-through for all slash commands. That risks confusing users when native interactive-only commands are not honored by prompt-mode Claude.

## Risks / Trade-offs

- [Native command parity gaps] → Start with `/resume` as app-owned execution and expose other commands with explicit support status, then expand command handlers deliberately.
- [Command discovery leaks local paths or sensitive content] → Return names, descriptions, scopes, and support status only; bound file reads and avoid exposing full file contents.
- [Composer keyboard shortcuts conflict with textarea editing] → Only capture navigation keys while the command palette is open; otherwise preserve textarea defaults.
- [Mobile overlay crowds the composer] → Anchor the palette above the composer with a max height and scrollable list, reusing existing native shell styling.
- [History list can be large] → Reuse the already loaded project-scoped history list for `/resume` and limit visible matches while preserving search filtering.

## Migration Plan

1. Add shared command types and server command catalog route without changing existing chat submission behavior.
2. Add the composer command parser, palette, and tests while leaving the submit path unchanged for normal prompts.
3. Wire `/resume` to existing App resume/open callbacks and project-scoped history.
4. Add styling and responsive behavior for desktop and mobile.
5. Verify with unit tests, route tests, type checking, full test suite, and a browser smoke test of normal prompt and `/resume` selection.

Rollback is local: removing the new route, props, and palette returns the composer to raw prompt submission while preserving existing session rail controls.

## Open Questions

- Which discovered Claude Code command locations should be considered authoritative for the first implementation beyond built-ins and project/user command files?
- Should selecting supported prompt-backed custom commands submit immediately or insert the command text for review first? The safer first behavior is insertion unless a command is explicitly app-owned like `/resume`.
