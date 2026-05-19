## Context

The current chat input is owned by `ChatComposer`, with `ChatView` holding the composer value and submitting text over the existing WebSocket input path. Slash-command handling already lives in the composer, so speech input should integrate at the same layer and only update the text value that the user can review before sending.

The user wants a WeChat-like press-and-hold interaction and a Typeless-like dictation experience. Typeless' public site describes AI dictation and cleanup behavior but does not publish a browser SDK or API documentation, so it is not a confirmed dependency. Browser-native `SpeechRecognition` can provide frontend dictation with `continuous` and `interimResults`, but support is limited and some implementations may use browser/vendor speech services rather than guaranteed local-only recognition.

## Goals / Non-Goals

**Goals:**
- Add a voice/text mode toggle to the existing chat composer.
- Start speech recognition when the user presses and holds the voice button, keep listening while held, and finalize when released.
- Show clear listening/transcribing/error states without disrupting slash-command suggestions or normal text editing.
- Insert finalized recognized text into the composer input and leave sending under explicit user control.
- Avoid saving voice audio files in app state, session history, local storage, or server storage.
- Use feature detection so unsupported browsers degrade to text input with a clear message.

**Non-Goals:**
- Automatically send transcribed prompts to Claude.
- Store, replay, or upload audio recordings through this app's backend.
- Build full Typeless parity such as AI rewriting, custom vocabulary, cross-app dictation, or voice commands.
- Depend on an undocumented Typeless private API.
- Add server-side STT unless browser-native support proves inadequate and credentials/configuration are explicitly provided.

## Decisions

1. **Use a composer-local speech dictation layer.**
   - `ChatComposer` should own voice-mode UI state and delegate recognition to a small browser adapter while continuing to receive `value` and `onChange` from `ChatView`.
   - Recognized text is appended or inserted into the existing composer value, so `ChatView.handleSubmit` and WebSocket input semantics remain unchanged.
   - Alternative considered: handle speech in `ChatView`. That would couple microphone state to streaming/session lifecycle and make the already stateful component harder to test.

2. **Prefer browser-native Web Speech API for the first implementation.**
   - Feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition`, configure `continuous = true` and `interimResults = true`, and use result events to track interim preview and finalized transcript chunks.
   - On press start, create/start recognition; on release, call `stop()` so final results can be delivered; on cancel, call `abort()` and discard pending interim text.
   - Alternative considered: record audio with `MediaRecorder` and send it to a cloud STT API. That gives broader model choice but violates the preferred frontend-only path, introduces credentials, and requires transmitting audio.

3. **Treat Typeless as an experience reference, not an implementation dependency.**
   - Public Typeless material suggests useful behavior: dictation, filler cleanup, formatting, multilingual support, and privacy claims. None of that confirms an embeddable API.
   - The first pass should implement raw dictation into the composer. AI polish can be a later explicit capability if the user chooses a provider and privacy model.
   - Alternative considered: use the user's Typeless account directly. Without official API documentation or OAuth/API-key flow, that would be fragile and potentially unsafe.

4. **Design the voice button as pointer-first with keyboard/touch fallbacks.**
   - Voice mode shows a hold-to-speak button that handles pointer down/up/cancel/leave for mouse and touch. Keyboard users can use Space/Enter to start and release to stop, with accessible labels and status text.
   - Releasing normally commits finalized speech text. Drag/pointer-cancel or an explicit cancel gesture aborts recognition and leaves the composer unchanged except for any text committed before the current hold.
   - Alternative considered: tap once to start and tap again to stop. That is simpler but does not match the requested WeChat interaction.

5. **Keep privacy boundaries explicit.**
   - The app should not create audio Blob URLs, persist audio, send audio to app APIs, or log transcript events beyond normal UI state and tests.
   - Because browser-native recognition may rely on browser/vendor services, the UI or docs should not promise fully local processing unless `processLocally` is actually available and selected.
   - Alternative considered: claim local-only because no app backend receives audio. That would be misleading for browser implementations that use cloud recognition engines.

6. **Make fallback behavior visible and non-blocking.**
   - If speech recognition is unavailable, microphone permission is denied, or recognition errors, keep the text composer usable and show a concise status/notice.
   - Do not disable normal submit due to speech recognition failures.
   - Alternative considered: hide the voice toggle entirely when unsupported. Showing an unavailable state helps users understand why the requested feature is not present on a browser/device.

## Risks / Trade-offs

- [Browser support is uneven] → Use feature detection, cover unsupported state in tests, and keep text input as the reliable fallback.
- [Native Web Speech may use vendor cloud services] → Avoid app-side audio storage and avoid promising local-only transcription unless the browser reports local processing support.
- [Recognition can stop unexpectedly during long holds] → Handle `end` and `error` events, surface the state, and keep committed finalized text rather than losing prior chunks.
- [Pointer events may conflict with mobile scrolling or selection] → Scope hold behavior to the voice button, prevent default only while holding, and provide an explicit return-to-keyboard control.
- [Interim text may confuse users if inserted too early] → Show interim text as a preview/status and commit only finalized transcript chunks to the composer on result/release.
- [External STT would need credentials and privacy review] → Leave provider integration as an optional follow-up instead of building it into the initial implementation.

## Migration Plan

1. Add a small speech recognition adapter and tests with mocked browser APIs.
2. Extend `ChatComposer` with voice/text mode UI, hold-to-record handling, status messages, and transcript insertion.
3. Add responsive composer styling for the voice toggle, hold button, interim preview, and unavailable/error states.
4. Add component tests for successful dictation, no auto-send, cancel, unsupported browser, denied permission/error, and preservation of normal text/slash command behavior.
5. Verify with `npm run typecheck`, `npm test`, `npm run build`, and browser smoke tests on the dev server at both desktop and mobile widths.

Rollback is local: remove the adapter, voice-mode UI, and related styles/tests; the existing text composer and WebSocket submit path remain intact.

## Open Questions

- Should transcribed text append at the end of the composer or insert at the current cursor position? Default to append unless cursor-position preservation is straightforward.
- Which language should recognition use by default: browser locale, a fixed Chinese locale, or a user-selectable setting? Default to `navigator.language` for the first pass.
- If browser-native recognition is insufficient on the user's target device, which external STT provider and credential model should be used?
