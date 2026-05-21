## 1. Terminal Voice UI

- [x] 1.1 Add terminal voice state to `TerminalView` using the existing `createSpeechRecognitionSession` adapter
- [x] 1.2 Add a compact voice dictation control to the terminal UI that supports press-and-hold start/stop and explicit cancel
- [x] 1.3 Display listening, interim transcript, unavailable, cancelled, and error states without covering the xterm viewport

## 2. Terminal Input Integration

- [x] 2.1 Send finalized transcript text through the existing terminal input path without appending Enter
- [x] 2.2 Ensure interim transcript text is never sent to the terminal WebSocket
- [x] 2.3 Abort or ignore cancelled dictation holds so cancelled text is not inserted

## 3. Styling and Mobile Ergonomics

- [x] 3.1 Style the terminal voice controls for mobile touch use alongside the terminal shortcut bar
- [x] 3.2 Keep normal terminal focus, scrollback controls, and horizontal terminal scrolling usable while voice controls are present
- [x] 3.3 Show unsupported microphone/browser states clearly while leaving keyboard terminal input available

## 4. Tests and Verification

- [x] 4.1 Add `TerminalView` tests for final transcript insertion, interim preview, cancellation, unsupported browser, and recognition errors
- [x] 4.2 Update or reuse speech recognition adapter tests only if terminal integration requires adapter behavior changes
- [x] 4.3 Run focused client tests for `TerminalView`, existing speech recognition tests, and typecheck
- [ ] 4.4 Manually verify on a mobile-width browser that dictation inserts text at the Claude Code terminal prompt without auto-submit
