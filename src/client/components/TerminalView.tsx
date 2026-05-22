import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalClientMessage, TerminalConnectionStatus, TerminalServerMessage } from '../../shared/types';
import { openTerminalSocket, sendTerminalWs } from '../api';
import { createSpeechRecognitionSession, isSpeechRecognitionSupported, speechRecognitionUnavailableMessage, type SpeechRecognitionFailure, type SpeechRecognitionSession } from '../speechRecognition';

type TerminalViewProps = {
  sessionId: string;
  title: string;
  visible?: boolean;
  onBack(): void;
};

type TerminalStatus = TerminalConnectionStatus | 'disconnected';

type ShortcutKey = {
  label: string;
  data?: string;
  scrollPages?: number;
  scrollToBottom?: boolean;
};

type VoiceState = 'idle' | 'listening' | 'transcribing' | 'error' | 'unavailable';

type TerminalDragState = {
  id: number;
  lastX: number;
  lastY: number;
  accumulatedWheelY: number;
  mode: 'pending' | 'horizontal' | 'vertical';
};

const TERMINAL_TOUCH_WHEEL_PIXELS = 24;

const SHORTCUT_KEYS: ShortcutKey[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'PgUp', scrollPages: -1 },
  { label: 'PgDn', scrollPages: 1 },
  { label: '底部', scrollToBottom: true },
  { label: 'Enter', data: '\r' },
];

export default function TerminalView({ sessionId, title, visible = true, onBack }: TerminalViewProps) {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const attachedRef = useRef(false);
  const previousVisibleRef = useRef(visible);
  const speechAvailable = useMemo(() => isSpeechRecognitionSupported(), []);
  const speechSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const voiceButtonRef = useRef<HTMLButtonElement | null>(null);
  const fallbackInputRef = useRef<HTMLTextAreaElement | null>(null);
  const terminalDragRef = useRef<TerminalDragState | null>(null);
  const voiceHoldActiveRef = useRef(false);
  const voiceHoldCancelledRef = useRef(false);
  const voiceHoldFailedRef = useRef(false);
  const voiceFinalPartsRef = useRef<string[]>([]);
  const voiceSessionTokenRef = useRef(0);
  const [status, setStatus] = useState<TerminalStatus>('connecting');
  const [statusMessage, setStatusMessage] = useState('正在连接终端…');
  const [isAttached, setIsAttached] = useState(false);
  const unavailableSpeechMessage = useMemo(() => speechRecognitionUnavailableMessage(), [speechAvailable]);
  const [voiceState, setVoiceState] = useState<VoiceState>(speechAvailable ? 'idle' : 'unavailable');
  const [voiceMessage, setVoiceMessage] = useState(speechAvailable ? '按住按钮后开始语音输入。' : unavailableSpeechMessage);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackValue, setFallbackValue] = useState('');

  useEffect(() => {
    const terminalHost = terminalHostRef.current;
    if (!terminalHost) return;

    attachedRef.current = false;
    setIsAttached(false);
    setStatus('connecting');
    setStatusMessage('正在连接终端…');
    voiceHoldActiveRef.current = false;
    voiceHoldCancelledRef.current = false;
    voiceHoldFailedRef.current = false;
    voiceFinalPartsRef.current = [];
    voiceSessionTokenRef.current += 1;
    setInterimTranscript('');
    setFallbackOpen(false);
    setFallbackValue('');
    setVoiceState(speechAvailable ? 'idle' : 'unavailable');
    setVoiceMessage(speechAvailable ? '按住按钮后开始语音输入。' : unavailableSpeechMessage);

    const terminal = new Terminal();
    const fitAddon = new FitAddon();
    const socket = openTerminalSocket();
    let active = true;

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    socketRef.current = socket;

    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);
    terminal.focus();
    fitTerminal(fitAddon);

    const isActiveSocket = () => active && socketRef.current === socket;

    const dataSubscription = terminal.onData((data) => {
      sendInput(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal(fitAddon);
      if (attachedRef.current) {
        sendResize();
      }
    });
    resizeObserver.observe(terminalHost);

    socket.addEventListener('open', () => {
      if (!isActiveSocket()) return;
      setStatus('connecting');
      setStatusMessage(defaultStatusMessage('connecting'));
      sendTerminalMessage(socket, attachMessage(sessionId, fitAddon), setStatusMessage);
    });

    socket.addEventListener('message', (event) => {
      if (!isActiveSocket()) return;
      const message = parseTerminalServerMessage(event.data);
      if (!message || !messageBelongsToSession(message, sessionId)) return;

      if (message.type === 'output') {
        terminal.write(message.data);
        return;
      }

      if (message.type === 'error') {
        attachedRef.current = false;
        setIsAttached(false);
        setStatus('error');
        setStatusMessage(message.message);
        return;
      }

      attachedRef.current = message.status === 'attached';
      setIsAttached(message.status === 'attached');
      setStatus(message.status);
      setStatusMessage(message.message ?? defaultStatusMessage(message.status));
      if (message.status === 'attached') terminal.focus();
    });

    socket.addEventListener('error', () => {
      if (!isActiveSocket()) return;
      attachedRef.current = false;
      setIsAttached(false);
      setStatus('error');
      setStatusMessage(defaultStatusMessage('error'));
    });

    socket.addEventListener('close', () => {
      if (!isActiveSocket()) return;
      attachedRef.current = false;
      setIsAttached(false);
      setStatus('disconnected');
      setStatusMessage(defaultStatusMessage('disconnected'));
    });

    return () => {
      active = false;
      attachedRef.current = false;
      voiceSessionTokenRef.current += 1;
      setIsAttached(false);
      speechSessionRef.current?.abort();
      speechSessionRef.current = null;
      dataSubscription.dispose();
      resizeObserver.disconnect();
      socket.close();
      socketRef.current = null;
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
      fitAddon.dispose();
    };
  }, [sessionId, speechAvailable]);

  useEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;

    if (!visible) {
      if (speechSessionRef.current || voiceHoldActiveRef.current) cancelVoiceHold();
      setFallbackOpen(false);
      return;
    }

    if (wasVisible) return;
    const frame = requestAnimationFrame(() => {
      const fitAddon = fitAddonRef.current;
      if (!fitAddon) return;
      fitTerminal(fitAddon);
      if (attachedRef.current) sendResize();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    if (!fallbackOpen) return;
    const frame = requestAnimationFrame(() => {
      fallbackInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [fallbackOpen]);

  useEffect(() => {
    if (isAttached) return;
    if (speechSessionRef.current || voiceHoldActiveRef.current) cancelVoiceHold();
    setFallbackOpen(false);
  }, [isAttached]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      const terminal = terminalRef.current;
      if (!terminal || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      startTerminalDrag(touch.identifier, touch.clientX, touch.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const mode = moveTerminalDrag(touch.identifier, touch.clientX, touch.clientY);
      if (mode === 'vertical') {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      for (const touch of event.changedTouches) endTerminalDrag(touch.identifier);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  function startTerminalDrag(id: number, clientX: number, clientY: number) {
    terminalDragRef.current = {
      id,
      lastX: clientX,
      lastY: clientY,
      accumulatedWheelY: 0,
      mode: 'pending',
    };
  }

  function moveTerminalDrag(id: number, clientX: number, clientY: number): 'none' | 'horizontal' | 'vertical' {
    const drag = terminalDragRef.current;
    const container = terminalContainerRef.current;
    if (!drag || drag.id !== id || !container) return 'none';

    const deltaX = clientX - drag.lastX;
    const deltaY = clientY - drag.lastY;
    if (drag.mode === 'pending' && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
      drag.mode = Math.abs(deltaY) > Math.abs(deltaX) ? 'vertical' : 'horizontal';
    }

    if (drag.mode === 'vertical') {
      drag.accumulatedWheelY -= deltaY;
      const steps = Math.trunc(drag.accumulatedWheelY / TERMINAL_TOUCH_WHEEL_PIXELS);
      if (steps !== 0) {
        sendTerminalWheelSteps(steps);
        drag.accumulatedWheelY -= steps * TERMINAL_TOUCH_WHEEL_PIXELS;
      }
    } else if (drag.mode === 'horizontal') {
      container.scrollLeft -= deltaX;
    }

    drag.lastX = clientX;
    drag.lastY = clientY;
    return drag.mode === 'pending' ? 'none' : drag.mode;
  }

  function endTerminalDrag(id: number) {
    if (terminalDragRef.current?.id === id) terminalDragRef.current = null;
  }

  function handleTerminalPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || event.pointerType === 'touch') return;
    startTerminalDrag(event.pointerId, event.clientX, event.clientY);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
  }

  function handleTerminalPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const mode = moveTerminalDrag(event.pointerId, event.clientX, event.clientY);
    if (mode === 'vertical') {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleTerminalPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    endTerminalDrag(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
    }
  }

  function sendTerminalWheelSteps(steps: number) {
    const sequence = steps > 0 ? '\x1b[<64;1;1M' : '\x1b[<65;1;1M';
    sendInput(sequence.repeat(Math.min(Math.abs(steps), 8)));
  }

  function handleShortcut(key: ShortcutKey) {
    const terminal = terminalRef.current;
    if (key.scrollToBottom) {
      terminal?.scrollToBottom();
      terminal?.focus();
      return;
    }
    if (typeof key.scrollPages === 'number') {
      terminal?.scrollPages(key.scrollPages);
      terminal?.focus();
      return;
    }
    if (key.data) sendInput(key.data);
  }

  function handleVoiceError(error: SpeechRecognitionFailure, sessionToken: number) {
    if (sessionToken !== voiceSessionTokenRef.current) return;
    speechSessionRef.current = null;
    voiceHoldFailedRef.current = true;
    voiceHoldActiveRef.current = false;
    setInterimTranscript('');
    setVoiceState('error');
    setVoiceMessage(error.message);
  }

  function handleVoiceEnd(sessionToken: number) {
    if (sessionToken !== voiceSessionTokenRef.current) return;
    speechSessionRef.current = null;

    if (voiceHoldCancelledRef.current) {
      voiceHoldCancelledRef.current = false;
      voiceHoldActiveRef.current = false;
      voiceHoldFailedRef.current = false;
      voiceFinalPartsRef.current = [];
      setInterimTranscript('');
      setVoiceState(speechAvailable ? 'idle' : 'unavailable');
      setVoiceMessage(speechAvailable ? '按住按钮后开始语音输入。' : unavailableSpeechMessage);
      return;
    }

    if (voiceHoldFailedRef.current) {
      voiceHoldFailedRef.current = false;
      voiceHoldActiveRef.current = false;
      voiceFinalPartsRef.current = [];
      return;
    }

    const finalText = voiceFinalPartsRef.current.join(' ').trim();
    voiceFinalPartsRef.current = [];
    voiceHoldActiveRef.current = false;
    setInterimTranscript('');

    if (finalText) {
      sendInput(finalText);
      terminalRef.current?.focus();
      setVoiceState(speechAvailable ? 'idle' : 'unavailable');
      setVoiceMessage('语音内容已插入终端。');
      return;
    }

    setVoiceState(speechAvailable ? 'idle' : 'unavailable');
    setVoiceMessage('没有可插入的语音内容。');
  }

  function setVoicePointerCapture(pointerId: number | undefined) {
    if (typeof pointerId !== 'number') return;
    const button = voiceButtonRef.current;
    if (!button || typeof button.setPointerCapture !== 'function') return;
    try {
      button.setPointerCapture(pointerId);
    } catch {
    }
  }

  function releaseVoicePointerCapture(pointerId: number | undefined) {
    if (typeof pointerId !== 'number') return;
    const button = voiceButtonRef.current;
    if (!button || typeof button.releasePointerCapture !== 'function') return;
    try {
      button.releasePointerCapture(pointerId);
    } catch {
    }
  }

  function startVoiceHold(pointerId?: number) {
    if (!speechAvailable || !attachedRef.current || voiceHoldActiveRef.current) return;

    voiceSessionTokenRef.current += 1;
    const sessionToken = voiceSessionTokenRef.current;
    voiceHoldActiveRef.current = true;
    voiceHoldCancelledRef.current = false;
    voiceHoldFailedRef.current = false;
    voiceFinalPartsRef.current = [];
    setVoicePointerCapture(pointerId);
    setInterimTranscript('');
    setVoiceState('transcribing');
    setVoiceMessage('正在启动语音识别…');

    const session = createSpeechRecognitionSession({
      onStart: () => {
        if (sessionToken !== voiceSessionTokenRef.current) return;
        setVoiceState('listening');
        setVoiceMessage('请开始说话，松开后结束。');
      },
      onInterimResult: (text) => {
        if (sessionToken !== voiceSessionTokenRef.current) return;
        setVoiceState('transcribing');
        setInterimTranscript(text);
        setVoiceMessage('正在识别语音…');
      },
      onFinalResult: (text) => {
        if (sessionToken !== voiceSessionTokenRef.current || !text) return;
        voiceFinalPartsRef.current.push(text);
        setInterimTranscript('');
        setVoiceState('transcribing');
        setVoiceMessage('已捕获语音内容，松开后插入终端。');
      },
      onError: (error) => handleVoiceError(error, sessionToken),
      onEnd: () => handleVoiceEnd(sessionToken),
    });

    if (!session) {
      if (sessionToken === voiceSessionTokenRef.current) {
        voiceHoldActiveRef.current = false;
        setVoiceState('unavailable');
        setVoiceMessage(unavailableSpeechMessage);
      }
      releaseVoicePointerCapture(pointerId);
      return;
    }

    speechSessionRef.current = session;
    session.start();
  }

  function finishVoiceHold(pointerId?: number) {
    releaseVoicePointerCapture(pointerId);
    if (!voiceHoldActiveRef.current) return;
    setVoiceState('transcribing');
    setVoiceMessage('正在整理语音内容…');
    speechSessionRef.current?.stop();
  }

  function cancelVoiceHold(pointerId?: number) {
    releaseVoicePointerCapture(pointerId);
    if (!voiceHoldActiveRef.current && !speechSessionRef.current) return;
    const session = speechSessionRef.current;
    voiceSessionTokenRef.current += 1;
    voiceHoldCancelledRef.current = true;
    voiceHoldActiveRef.current = false;
    voiceHoldFailedRef.current = false;
    speechSessionRef.current = null;
    setVoiceState(speechAvailable ? 'idle' : 'unavailable');
    setVoiceMessage('语音输入已取消。');
    setInterimTranscript('');
    voiceFinalPartsRef.current = [];
    session?.abort();
  }

  function openFallbackInput() {
    if (!attachedRef.current) return;
    setFallbackOpen(true);
  }

  function closeFallbackInput() {
    setFallbackOpen(false);
    setFallbackValue('');
    terminalRef.current?.focus();
  }

  function insertFallbackInput() {
    const text = fallbackValue.trim();
    if (!text) return;
    const socket = socketRef.current;
    if (!attachedRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    sendInput(text);
    setVoiceMessage('文本已插入终端。');
    closeFallbackInput();
  }

  function sendInput(data: string) {
    const socket = socketRef.current;
    if (!attachedRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    sendTerminalMessage(socket, { type: 'input', sessionId, data }, setStatusMessage);
  }

  function sendResize() {
    const socket = socketRef.current;
    const fitAddon = fitAddonRef.current;
    if (!socket || !fitAddon || socket.readyState !== WebSocket.OPEN) return;
    const dimensions = validDimensions(fitAddon.proposeDimensions());
    if (!dimensions) return;
    sendTerminalMessage(socket, { type: 'resize', sessionId, cols: dimensions.cols, rows: dimensions.rows }, setStatusMessage);
  }

  return (
    <section className="panel terminal-panel terminal-view" aria-label="Claude Code terminal" onClick={() => terminalRef.current?.focus()}>
      <div className="mobile-panel-nav">
        <button className="secondary-button compact" type="button" onClick={onBack}>
          ← 会话
        </button>
      </div>

      <header className="terminal-header">
        <div>
          <p className="eyebrow">浏览器终端</p>
          <h2>{title}</h2>
        </div>
        {statusMessage ? <div className={`terminal-status ${status}`} role="status">{statusMessage}</div> : null}
      </header>

      <div
        className="terminal-container"
        onPointerCancel={handleTerminalPointerEnd}
        onPointerDown={handleTerminalPointerDown}
        onPointerMove={handleTerminalPointerMove}
        onPointerUp={handleTerminalPointerEnd}
        ref={terminalContainerRef}
      >
        <div className="terminal-xterm-host" ref={terminalHostRef} />
      </div>

      <div className="terminal-voice-panel" data-voice-state={voiceState} data-fallback-open={fallbackOpen ? 'true' : 'false'}>
        {speechAvailable ? (
          <>
            <button
              aria-label={voiceState === 'listening' ? '松开结束' : '按住说话'}
              className="terminal-voice-button"
              disabled={!isAttached || voiceState === 'unavailable'}
              onPointerCancel={(event) => cancelVoiceHold(event.pointerId)}
              onPointerDown={(event) => startVoiceHold(event.pointerId)}
              onPointerLeave={(event) => cancelVoiceHold(event.pointerId)}
              onPointerUp={(event) => finishVoiceHold(event.pointerId)}
              ref={voiceButtonRef}
              type="button"
            >
              {voiceState === 'listening' ? '松开结束' : '按住说话'}
            </button>
            {(voiceState === 'listening' || voiceState === 'transcribing') ? (
              <button className="terminal-key terminal-voice-cancel" type="button" onClick={() => cancelVoiceHold()}>
                取消
              </button>
            ) : (
              <button className="terminal-key terminal-text-input-button" disabled={!isAttached} type="button" onClick={openFallbackInput}>
                粘贴/输入
              </button>
            )}
            <p className="terminal-voice-status" role="status">{interimTranscript ? `正在识别：${interimTranscript}` : voiceMessage}</p>
          </>
        ) : (
          <>
            <button
              aria-label="系统语音输入"
              className="terminal-voice-button"
              disabled={!isAttached}
              onClick={openFallbackInput}
              type="button"
            >
              系统语音输入
            </button>
            <p className="terminal-voice-status" role="status">{voiceMessage}</p>
          </>
        )}
        {fallbackOpen ? (
          <div className="terminal-voice-fallback-panel">
            <textarea
              aria-label="终端文本输入"
              className="terminal-voice-fallback-input"
              onChange={(event) => setFallbackValue(event.target.value)}
              placeholder="点这里粘贴手机复制的文字，或用系统键盘麦克风输入"
              ref={fallbackInputRef}
              rows={2}
              value={fallbackValue}
            />
            <div className="terminal-voice-fallback-actions">
              <button className="terminal-key" type="button" onClick={insertFallbackInput}>
                插入终端
              </button>
              <button className="terminal-key" type="button" onClick={closeFallbackInput}>
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="terminal-shortcut-bar" aria-label="Terminal shortcut keys">
        {SHORTCUT_KEYS.map((key) => (
          <button className="terminal-key" key={key.label} type="button" onClick={() => handleShortcut(key)}>
            {key.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function attachMessage(sessionId: string, fitAddon: FitAddon): TerminalClientMessage {
  const dimensions = validDimensions(fitAddon.proposeDimensions());
  if (!dimensions) return { type: 'attach', sessionId };
  return { type: 'attach', sessionId, cols: dimensions.cols, rows: dimensions.rows };
}

function validDimensions(dimensions: { cols: number; rows: number } | undefined): { cols: number; rows: number } | null {
  if (!dimensions || !Number.isInteger(dimensions.cols) || !Number.isInteger(dimensions.rows) || dimensions.cols <= 0 || dimensions.rows <= 0) return null;
  return dimensions;
}

function fitTerminal(fitAddon: FitAddon): void {
  try {
    fitAddon.fit();
  } catch {
    // xterm can throw before layout metrics are available; the next resize will retry.
  }
}

function sendTerminalMessage(socket: WebSocket, message: TerminalClientMessage, setStatusMessage: (message: string) => void): void {
  try {
    sendTerminalWs(socket, message);
  } catch (error) {
    setStatusMessage(error instanceof Error ? error.message : '终端消息发送失败。');
  }
}

function parseTerminalServerMessage(raw: unknown): TerminalServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as TerminalServerMessage;
  } catch {
    return null;
  }
}

function messageBelongsToSession(message: TerminalServerMessage, sessionId: string): boolean {
  return !('sessionId' in message) || !message.sessionId || message.sessionId === sessionId;
}

function defaultStatusMessage(status: TerminalStatus): string {
  switch (status) {
    case 'connecting':
      return '正在连接终端…';
    case 'attached':
      return '终端已连接。';
    case 'detached':
      return '终端已分离。';
    case 'stopped':
      return '终端会话已停止。';
    case 'unavailable':
      return '终端不可用。';
    case 'rejected':
      return '终端已在其他浏览器中打开。';
    case 'error':
      return '终端连接异常。';
    case 'disconnected':
      return '终端连接已断开。';
  }
}
