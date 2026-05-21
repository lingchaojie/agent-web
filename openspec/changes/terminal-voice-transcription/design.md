## Context

The app's live interaction surface is now the tmux-backed browser terminal. The previous speech-to-text work added browser speech recognition to the old chat composer, but that composer is no longer exposed for live sessions. The reusable browser adapter already exists in `src/client/speechRecognition.ts`; terminal input already flows through `TerminalView` into `/api/terminal/ws` as raw input bytes.

Mobile users need dictation inside the terminal without changing the terminal-first model. The correct behavior is equivalent to typing recognized text at the current Claude Code prompt: text appears after the terminal cursor, remains editable by Claude Code's line editor, and is not submitted until the user explicitly sends Enter.

## Goals / Non-Goals

**Goals:**
- Reuse the existing browser speech recognition adapter for terminal dictation.
- Add a compact terminal voice control that works well on mobile and desktop.
- Insert finalized transcript text through the same terminal input path as typed xterm input.
- Show interim, listening, unavailable, cancelled, and error states without disrupting the terminal session.
- Keep voice audio entirely client-side and unpersisted.

**Non-Goals:**
- Do not bring back the old chat composer for live sessions.
- Do not send audio to the server.
- Do not auto-submit recognized text with Enter.
- Do not attempt semantic insertion into Claude Code internals; terminal input remains raw keystream input.
- Do not support simultaneous speech sessions across multiple hidden terminals.

## Decisions

1. **Implement terminal voice input inside `TerminalView`.**
   - Rationale: `TerminalView` owns the active xterm instance and raw input sender, so it can insert final transcript text at the real terminal cursor by calling the existing input path.
   - Alternative considered: handle voice at `ChatView` or `App` and pass text down. That would add state plumbing and still need `TerminalView` to perform the actual input.

2. **Reuse `createSpeechRecognitionSession` directly, with a small terminal-specific UI state machine.**
   - Rationale: the adapter already normalizes browser recognition events, errors, interim text, and final text. Terminal needs different rendering but not a different recognition backend.
   - Alternative considered: extract the whole composer voice UI into a shared component. That would couple terminal UI to old composer behavior and increase churn.

3. **Insert final transcript text as raw terminal input, without appending newline.**
   - Rationale: this exactly matches user intent: text appears at the Claude Code prompt where the cursor is, and the user decides whether to edit or press Enter.
   - Alternative considered: paste through xterm's paste API or send bracketed paste. Raw input is simpler and aligns with existing terminal shortcuts; paste-mode can be revisited if multiline dictation becomes important.

4. **Use press-and-hold dictation first.**
   - Rationale: the current composer contract is hold-to-speak, and it maps naturally to mobile accidental-input prevention. Reusing the same gesture keeps behavior predictable.
   - Alternative considered: toggle-to-record. It is easier for long dictation but easier to leave recording accidentally; not needed for the first terminal integration.

5. **Keep terminal scroll/input controls separate from voice controls.**
   - Rationale: terminal shortcut buttons send keystrokes or scroll xterm; voice state is richer and needs its own status/error copy.

## Risks / Trade-offs

- **Browser speech recognition support varies** → Show an unavailable state and keep normal terminal input usable.
- **Speech recognition may produce final text after the user cancels** → Track active/cancelled holds and ignore cancelled final results.
- **Raw insertion can interact with full-screen terminal applications** → This is expected terminal behavior; final transcript is equivalent to typing text into the active TTY.
- **Recognized punctuation/spacing may not match user intent** → Insert text without auto-submit so the user can edit before pressing Enter.
- **Microphone permission errors may be confusing in mobile browsers** → Surface the existing localized error messages near the voice control.

## Migration Plan

- Add terminal voice UI and tests behind normal feature detection; no backend migration is required.
- Existing live terminal sessions continue to work because the raw terminal WebSocket protocol is unchanged.
- If issues appear, the control can be hidden by removing the UI without changing terminal session behavior.
