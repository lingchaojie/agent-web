## Why

Live sessions now happen through the browser terminal, but the existing speech-to-text feature is still tied to the old composer flow. Mobile users need the same voice input convenience inside the terminal-first Claude Code experience, with transcribed text inserted at the active terminal cursor.

## What Changes

- Add a terminal voice input control to live browser terminal sessions.
- Reuse the existing browser speech recognition implementation where available.
- Insert final transcribed text into the active xterm session as terminal input, without submitting it automatically.
- Preserve normal terminal behavior: users can edit, add more text, or press Enter themselves.
- Show clear unavailable/listening/error states on mobile and desktop.
- Do not reintroduce the old chat composer or structured live interaction mode.

## Capabilities

### New Capabilities
- `terminal-voice-input`: Voice transcription inside live terminal sessions, inserting text at the current Claude Code terminal cursor.

### Modified Capabilities
- `speech-to-text-composer`: Speech recognition should be reusable outside the old composer so terminal input can share the same browser transcription behavior.

## Impact

- Client terminal UI: `TerminalView` and related styles/tests.
- Speech recognition utility: existing client speech recognition module may need a small reusable hook or adapter.
- Terminal WebSocket input path: final transcript text should use the same terminal input send path as typed xterm data.
- No backend API change is expected unless tests reveal the terminal input path needs explicit metadata.
