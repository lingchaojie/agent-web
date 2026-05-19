## Why

Typing long prompts on mobile is slow and error-prone, while this app is already optimized for mobile control of Claude Code sessions. Adding press-and-hold speech-to-text in the composer lets users dictate prompts quickly, review the converted text, and decide when to send.

## What Changes

- Add a voice-input mode to the chat composer with a WeChat-style interaction: tap to switch to voice input, then press and hold to record continuously until release/cancel.
- Convert captured speech into text and insert the recognized text into the existing composer field for user review.
- Keep prompt submission explicit: recognized text must not be sent automatically.
- Do not persist voice recordings or expose audio files through chat/session history.
- Evaluate Typeless-like behavior as the experience target, but do not assume Typeless can be reused unless a documented API or authorized integration path is confirmed.
- Prefer a browser-side implementation first so transcription can complete in the frontend when supported; document fallback options only where browser support is insufficient.

## Capabilities

### New Capabilities
- `speech-to-text-composer`: Defines speech dictation mode, press-and-hold recording behavior, transcription insertion, cancellation, privacy, and fallback behavior for the chat composer.

### Modified Capabilities

## Impact

- Affects the React chat composer, mobile/desktop composer controls, input state handling, and related styling.
- May add browser speech-recognition utilities and tests for supported, unsupported, cancelled, and failed recognition flows.
- Should not require server-side audio storage or changes to Claude session input semantics.
- May require an external STT provider only if browser-native transcription cannot meet the target experience; such integration would need user-provided credentials and explicit configuration before implementation.
