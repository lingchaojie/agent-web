# Terminal Voice Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add press-and-hold speech dictation to live browser terminal sessions so finalized transcript text is inserted at the current Claude Code terminal cursor without auto-submitting.

**Architecture:** Keep the feature inside `TerminalView`, which already owns xterm focus, terminal input, and WebSocket sending. Reuse `src/client/speechRecognition.ts` directly; do not add backend APIs or reintroduce the old live chat composer.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, xterm.js, Web Speech API wrapper in `src/client/speechRecognition.ts`.

---

## File Structure

- Modify `src/client/components/TerminalView.tsx`: add terminal-local voice state, speech recognition lifecycle, and terminal voice controls.
- Modify `src/client/styles.css`: style terminal voice controls near the shortcut bar without covering xterm.
- Modify `tests/client/TerminalView.test.tsx`: mock speech recognition and cover final insertion, interim preview, cancellation, unsupported browser, and errors.
- No backend files change.
- Do not commit unless the user explicitly asks.

### Task 1: Terminal voice state and final transcript insertion

**Files:**
- Modify: `src/client/components/TerminalView.tsx`
- Test: `tests/client/TerminalView.test.tsx`

- [ ] **Step 1: Add failing tests for terminal voice insertion**

Add speech recognition mocking near the top of `tests/client/TerminalView.test.tsx`, after `FakeWebSocket`:

```ts
class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: ((event: Event) => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  start = vi.fn(() => this.onstart?.(new Event('start')));
  stop = vi.fn(() => this.onend?.(new Event('end')));
  abort = vi.fn(() => this.onend?.(new Event('end')));

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  emitResult(results: Array<{ transcript: string; isFinal: boolean }>) {
    const list: any = { length: results.length };
    for (let index = 0; index < results.length; index += 1) {
      list[index] = { isFinal: results[index].isFinal, length: 1, 0: { transcript: results[index].transcript } };
    }
    this.onresult?.({ resultIndex: 0, results: list });
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: typeof MockSpeechRecognition;
  webkitSpeechRecognition?: typeof MockSpeechRecognition;
};

function enableSpeechRecognition() {
  (window as SpeechWindow).SpeechRecognition = MockSpeechRecognition;
}

function disableSpeechRecognition() {
  delete (window as SpeechWindow).SpeechRecognition;
  delete (window as SpeechWindow).webkitSpeechRecognition;
}
```

Update `beforeEach`:

```ts
MockSpeechRecognition.instances = [];
disableSpeechRecognition();
```

Add this failing test before the resize tests:

```ts
it('inserts final speech transcript into the attached terminal without submitting', async () => {
  enableSpeechRecognition();
  render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

  socket.open();
  socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
  vi.mocked(sendTerminalWs).mockClear();

  fireEvent.pointerDown(screen.getByRole('button', { name: '按住说话' }), { pointerId: 1 });
  MockSpeechRecognition.instances[0].emitResult([{ transcript: '写一个测试', isFinal: true }]);
  fireEvent.pointerUp(screen.getByRole('button', { name: '松开结束' }), { pointerId: 1 });

  await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '写一个测试' }));
  expect(sendTerminalWs).not.toHaveBeenCalledWith(socket, expect.objectContaining({ data: expect.stringContaining('\r') }));
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx -t "inserts final speech transcript"
```

Expected: FAIL because `按住说话` does not exist.

- [ ] **Step 3: Implement terminal voice state and lifecycle**

In `src/client/components/TerminalView.tsx`, change imports:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { createSpeechRecognitionSession, isSpeechRecognitionSupported, type SpeechRecognitionFailure, type SpeechRecognitionSession } from '../speechRecognition';
```

Add types below `ShortcutKey`:

```ts
type VoiceState = 'idle' | 'listening' | 'transcribing' | 'error' | 'unavailable';
```

Inside `TerminalView`, after existing refs/state:

```ts
const speechAvailable = useMemo(() => isSpeechRecognitionSupported(), []);
const speechSessionRef = useRef<SpeechRecognitionSession | null>(null);
const activeVoiceHoldRef = useRef(false);
const cancelledVoiceHoldRef = useRef(false);
const failedVoiceHoldRef = useRef(false);
const voiceFinalPartsRef = useRef<string[]>([]);
const [voiceState, setVoiceState] = useState<VoiceState>(() => (isSpeechRecognitionSupported() ? 'idle' : 'unavailable'));
const [voiceMessage, setVoiceMessage] = useState(() => (isSpeechRecognitionSupported() ? '按住说话，文字会进入终端光标处。' : '此浏览器暂不支持语音输入。'));
const [interimTranscript, setInterimTranscript] = useState('');
```

Add cleanup inside the existing `useEffect` return before `terminal.dispose()`:

```ts
speechSessionRef.current?.abort();
speechSessionRef.current = null;
```

Add handlers before `sendInput`:

```ts
function startVoiceHold() {
  if (!attachedRef.current) return;
  if (!speechAvailable) {
    setVoiceState('unavailable');
    setVoiceMessage('此浏览器暂不支持语音输入。');
    return;
  }
  if (activeVoiceHoldRef.current || speechSessionRef.current) return;

  activeVoiceHoldRef.current = true;
  cancelledVoiceHoldRef.current = false;
  failedVoiceHoldRef.current = false;
  voiceFinalPartsRef.current = [];
  setInterimTranscript('');
  setVoiceState('listening');
  setVoiceMessage('正在听，请按住继续说话。');

  const session = createSpeechRecognitionSession({
    onStart: () => {
      setVoiceState('listening');
      setVoiceMessage('正在听，请按住继续说话。');
    },
    onInterimResult: (text) => {
      setInterimTranscript(text);
      setVoiceState('listening');
    },
    onFinalResult: (text) => {
      voiceFinalPartsRef.current.push(text);
      setInterimTranscript('');
      setVoiceState('transcribing');
    },
    onError: handleVoiceError,
    onEnd: handleVoiceEnd,
  });

  if (!session) {
    activeVoiceHoldRef.current = false;
    setVoiceState('unavailable');
    setVoiceMessage('此浏览器暂不支持语音输入。');
    return;
  }

  speechSessionRef.current = session;
  try {
    session.start();
  } catch {
    failedVoiceHoldRef.current = true;
    activeVoiceHoldRef.current = false;
    speechSessionRef.current = null;
    voiceFinalPartsRef.current = [];
    setInterimTranscript('');
    setVoiceState('error');
    setVoiceMessage('语音输入启动失败，请检查麦克风权限后重试。');
  }
}

function finishVoiceHold() {
  if (!activeVoiceHoldRef.current || !speechSessionRef.current || cancelledVoiceHoldRef.current) return;
  setVoiceState('transcribing');
  setVoiceMessage('正在转文字…');
  speechSessionRef.current.stop();
}

function cancelVoiceHold(message = '语音输入已取消。') {
  if (!activeVoiceHoldRef.current && !speechSessionRef.current) return;
  cancelledVoiceHoldRef.current = true;
  activeVoiceHoldRef.current = false;
  voiceFinalPartsRef.current = [];
  setInterimTranscript('');
  setVoiceState('idle');
  setVoiceMessage(message);
  speechSessionRef.current?.abort();
  speechSessionRef.current = null;
}

function handleVoiceError(error: SpeechRecognitionFailure) {
  if (cancelledVoiceHoldRef.current && error.code === 'aborted') return;
  failedVoiceHoldRef.current = true;
  activeVoiceHoldRef.current = false;
  speechSessionRef.current = null;
  voiceFinalPartsRef.current = [];
  setInterimTranscript('');
  setVoiceState('error');
  setVoiceMessage(error.message);
}

function handleVoiceEnd() {
  speechSessionRef.current = null;
  activeVoiceHoldRef.current = false;

  if (cancelledVoiceHoldRef.current) {
    cancelledVoiceHoldRef.current = false;
    voiceFinalPartsRef.current = [];
    setInterimTranscript('');
    return;
  }

  if (failedVoiceHoldRef.current) {
    failedVoiceHoldRef.current = false;
    voiceFinalPartsRef.current = [];
    setInterimTranscript('');
    return;
  }

  const finalText = voiceFinalPartsRef.current.join(' ').trim();
  voiceFinalPartsRef.current = [];
  setInterimTranscript('');

  if (!finalText) {
    setVoiceState('idle');
    setVoiceMessage('没有识别到语音，请按住后再说话。');
    return;
  }

  sendInput(finalText);
  setVoiceState('idle');
  setVoiceMessage('已输入到终端，可编辑后按 Enter。');
  terminalRef.current?.focus();
}
```

- [ ] **Step 4: Add terminal voice markup**

In `TerminalView` render, insert this block between `terminal-container` and `terminal-shortcut-bar`:

```tsx
<div className="terminal-voice-panel" data-voice-state={voiceState}>
  <button
    className="terminal-voice-button"
    type="button"
    disabled={!attachedRef.current || voiceState === 'unavailable'}
    aria-label={voiceState === 'listening' ? '松开结束' : '按住说话'}
    onPointerDown={(event) => {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignored
      }
      startVoiceHold();
    }}
    onPointerUp={(event) => {
      event.preventDefault();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignored
      }
      finishVoiceHold();
    }}
    onPointerCancel={(event) => {
      event.preventDefault();
      cancelVoiceHold();
    }}
  >
    {voiceState === 'listening' ? '松开结束' : '按住说话'}
  </button>
  {voiceState === 'listening' || voiceState === 'transcribing' ? (
    <button className="secondary-button compact terminal-voice-cancel" type="button" onClick={() => cancelVoiceHold()}>
      取消
    </button>
  ) : null}
  <p className="terminal-voice-status" role="status">{interimTranscript ? `正在识别：${interimTranscript}` : voiceMessage}</p>
</div>
```

Change `.terminal-view` grid rows in CSS later in Task 3 from 4 rows to 5 rows.

- [ ] **Step 5: Run the focused test again**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx -t "inserts final speech transcript"
```

Expected: PASS.

### Task 2: Cancellation, interim, unsupported, and error behavior

**Files:**
- Modify: `src/client/components/TerminalView.tsx`
- Test: `tests/client/TerminalView.test.tsx`

- [ ] **Step 1: Add tests for non-final and failure paths**

Add tests after the final transcript test:

```ts
it('previews interim speech without sending terminal input', async () => {
  enableSpeechRecognition();
  render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
  socket.open();
  socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
  vi.mocked(sendTerminalWs).mockClear();

  fireEvent.pointerDown(screen.getByRole('button', { name: '按住说话' }), { pointerId: 1 });
  MockSpeechRecognition.instances[0].emitResult([{ transcript: '临时内容', isFinal: false }]);

  expect(await screen.findByText('正在识别：临时内容')).toBeInTheDocument();
  expect(sendTerminalWs).not.toHaveBeenCalled();
});

it('cancels speech recognition without inserting cancelled text', async () => {
  enableSpeechRecognition();
  render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
  socket.open();
  socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
  vi.mocked(sendTerminalWs).mockClear();

  fireEvent.pointerDown(screen.getByRole('button', { name: '按住说话' }), { pointerId: 1 });
  MockSpeechRecognition.instances[0].emitResult([{ transcript: '不要插入', isFinal: true }]);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));

  await waitFor(() => expect(screen.getByText('语音输入已取消。')).toBeInTheDocument());
  expect(MockSpeechRecognition.instances[0].abort).toHaveBeenCalledOnce();
  expect(sendTerminalWs).not.toHaveBeenCalled();
});

it('shows unavailable speech input state without blocking terminal input', async () => {
  render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
  socket.open();
  socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
  vi.mocked(sendTerminalWs).mockClear();

  expect(screen.getByRole('button', { name: '按住说话' })).toBeDisabled();
  expect(screen.getByText('此浏览器暂不支持语音输入。')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Enter' }));
  expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\r' });
});

it('shows speech recognition errors without sending terminal input', async () => {
  enableSpeechRecognition();
  render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
  socket.open();
  socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
  vi.mocked(sendTerminalWs).mockClear();

  fireEvent.pointerDown(screen.getByRole('button', { name: '按住说话' }), { pointerId: 1 });
  MockSpeechRecognition.instances[0].emitError('not-allowed');

  expect(await screen.findByText('麦克风权限被拒绝，无法使用语音输入。')).toBeInTheDocument();
  expect(sendTerminalWs).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx -t "speech|unavailable"
```

Expected: FAIL until Task 1 implementation and cancellation message behavior are complete.

- [ ] **Step 3: Ensure cancellation message persists**

If cancellation test fails because `handleVoiceEnd` clears the message, update the cancelled branch in `handleVoiceEnd` to leave the message as set by `cancelVoiceHold`:

```ts
if (cancelledVoiceHoldRef.current) {
  cancelledVoiceHoldRef.current = false;
  voiceFinalPartsRef.current = [];
  setInterimTranscript('');
  setVoiceState('idle');
  return;
}
```

- [ ] **Step 4: Run tests again**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx -t "speech|unavailable"
```

Expected: PASS.

### Task 3: Terminal voice styling

**Files:**
- Modify: `src/client/styles.css`
- Test: `tests/client/TerminalView.test.tsx`

- [ ] **Step 1: Add layout class assertions**

Update `renders mobile terminal layout and shortcut bar classes` in `tests/client/TerminalView.test.tsx`:

```ts
expect(container.querySelector('.terminal-voice-panel')).toBeInTheDocument();
expect(screen.getByRole('button', { name: '按住说话' })).toHaveClass('terminal-voice-button');
```

- [ ] **Step 2: Run the layout test and see it fail before CSS/markup is present**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx -t "renders mobile terminal layout"
```

Expected: FAIL until Task 1 markup exists.

- [ ] **Step 3: Add CSS for the voice panel**

In `src/client/styles.css`, change `.terminal-view`:

```css
.terminal-view {
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto max-content;
  gap: 0.75rem;
  height: calc(100vh - 6rem);
  min-height: 32rem;
  padding: 0.85rem;
  overflow: hidden;
}
```

Add after `.terminal-key:active`:

```css
.terminal-voice-panel {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  border: 1px solid rgba(217, 119, 87, 0.22);
  border-radius: 0.85rem;
  padding: 0.45rem;
  background: rgba(255, 253, 248, 0.88);
}

.terminal-voice-button {
  min-height: 2.6rem;
  border: 1px solid var(--border-strong);
  border-radius: 0.78rem;
  padding: 0.42rem 0.75rem;
  color: var(--text);
  background: var(--accent-soft);
  font-weight: 900;
  touch-action: none;
}

.terminal-voice-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.terminal-voice-panel[data-voice-state='listening'] .terminal-voice-button {
  border-color: rgba(50, 115, 95, 0.32);
  color: var(--success);
  background: var(--success-bg);
}

.terminal-voice-panel[data-voice-state='error'] .terminal-voice-button,
.terminal-voice-panel[data-voice-state='unavailable'] .terminal-voice-button {
  border-color: rgba(166, 64, 60, 0.24);
  color: var(--danger);
  background: var(--danger-bg);
}

.terminal-voice-cancel {
  min-height: 2.6rem;
}

.terminal-voice-status {
  margin: 0;
  min-width: 0;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

In the mobile media query, add:

```css
.terminal-voice-panel {
  grid-template-columns: auto auto minmax(0, 1fr);
  padding: 0.38rem;
}

.terminal-voice-status {
  font-size: 0.74rem;
}
```

- [ ] **Step 4: Run layout and full TerminalView tests**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx
```

Expected: PASS.

### Task 4: Verification

**Files:**
- Modify: `openspec/changes/terminal-voice-transcription/tasks.md`

- [ ] **Step 1: Run focused verification**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx tests/client/speechRecognition.test.tsx && npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Build the app**

Run:

```bash
npm run build
```

Expected: PASS. Vite chunk-size warning is acceptable if build succeeds.

- [ ] **Step 3: Manual mobile verification**

Start or use existing dev server on port 8787:

```bash
npm run dev
```

In a 390x844 browser viewport:
1. Open `http://127.0.0.1:8787`.
2. Select `test_claude`.
3. Open or create a live session.
4. Confirm the terminal shows `按住说话` near the terminal controls.
5. Hold the button, speak a short phrase, release.
6. Confirm the phrase appears at the Claude Code terminal prompt and is not submitted until Enter is pressed.
7. Confirm keyboard typing, shortcut keys, horizontal terminal scrolling, PgUp/PgDn, and `底部` still work.

- [ ] **Step 4: Mark OpenSpec tasks complete**

After implementation and verification, update `openspec/changes/terminal-voice-transcription/tasks.md` checkboxes from `[ ]` to `[x]` for completed items.

- [ ] **Step 5: Do not commit automatically**

Leave changes uncommitted. Report the commands run and their results. Only commit or push if the user explicitly asks.

## Self-Review

- Spec coverage: terminal control, final insertion, interim preview, cancellation, unsupported/error states, no audio persistence, and no backend changes are covered by Tasks 1-4.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain.
- Type consistency: `VoiceState`, `SpeechRecognitionSession`, `SpeechRecognitionFailure`, `sendInput`, and CSS class names are consistent across plan steps.
