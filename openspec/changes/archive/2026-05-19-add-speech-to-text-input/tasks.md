## 1. Speech Recognition Foundation

- [x] 1.1 Add a client-side speech recognition adapter that feature-detects `SpeechRecognition`/`webkitSpeechRecognition` and exposes start, stop, abort, interim result, final result, end, and error callbacks.
- [x] 1.2 Configure recognition for continuous dictation, interim results, and a default language from `navigator.language` with no audio blob creation or persistence.
- [x] 1.3 Add unit tests for supported API detection, unsupported browsers, final/interim result handling, stop, abort, and recognition errors using mocked browser APIs.

## 2. Composer Voice Mode UI

- [x] 2.1 Extend `ChatComposer` with a text/voice mode toggle that preserves the existing composer value across mode switches.
- [x] 2.2 Add the hold-to-speak control with pointer and keyboard press/release handling that starts recognition on hold and stops on release.
- [x] 2.3 Add cancellation handling for pointer cancel, drag-away or explicit cancel so uncommitted interim text from the active hold is discarded.
- [x] 2.4 Show listening, transcribing, interim preview, unavailable, permission-denied, and recognition-error states without disabling normal text input.
- [x] 2.5 Insert finalized speech text into the existing composer value without auto-submitting and without deleting pre-existing text.

## 3. Styling and Mobile Behavior

- [x] 3.1 Add responsive composer styles for the voice toggle, hold-to-speak button, status text, interim preview, and disabled/error states.
- [x] 3.2 Ensure voice controls remain usable on mobile widths and do not interfere with existing slash-command popovers or the send button.
- [x] 3.3 Ensure the disabled composer state consistently disables voice input controls when the session is not connected.

## 4. Component Tests

- [x] 4.1 Add `ChatComposer` tests for switching voice/text modes while preserving typed text.
- [x] 4.2 Add tests for hold-to-speak start/release inserting finalized text into the composer.
- [x] 4.3 Add tests proving speech transcription does not call submit until the user explicitly sends.
- [x] 4.4 Add tests for cancelling a hold, unsupported speech recognition, denied microphone/error states, and retrying after failure.
- [x] 4.5 Add regression tests that normal typing, send, and slash-command suggestions still work after voice controls are present.

## 5. Verification

- [x] 5.1 Run `npm run typecheck`.
- [x] 5.2 Run `npm test`.
- [x] 5.3 Run `npm run build`.
- [x] 5.4 Start the dev server with `./start-dev.sh` or `npm run dev` and browser-test text input, voice mode toggle, successful dictation insertion, no auto-send, cancellation/error state, and slash-command behavior on desktop and mobile widths.
- [x] 5.5 Run `openspec validate add-speech-to-text-input --strict` or the repository's equivalent OpenSpec validation command.
