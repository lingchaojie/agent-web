import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalClientMessage, TerminalConnectionStatus, TerminalServerMessage } from '../../shared/types';
import { openTerminalSocket, sendTerminalWs } from '../api';

type TerminalViewProps = {
  sessionId: string;
  title: string;
  onBack(): void;
};

type TerminalStatus = TerminalConnectionStatus | 'disconnected';

type ShortcutKey = {
  label: string;
  data: string;
};

const SHORTCUT_KEYS: ShortcutKey[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Enter', data: '\r' },
];

export default function TerminalView({ sessionId, title, onBack }: TerminalViewProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const attachedRef = useRef(false);
  const [status, setStatus] = useState<TerminalStatus>('connecting');
  const [statusMessage, setStatusMessage] = useState('正在连接终端…');

  useEffect(() => {
    const terminalHost = terminalHostRef.current;
    if (!terminalHost) return;

    attachedRef.current = false;
    setStatus('connecting');
    setStatusMessage('正在连接终端…');

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
        setStatus('error');
        setStatusMessage(message.message);
        return;
      }

      attachedRef.current = message.status === 'attached';
      setStatus(message.status);
      setStatusMessage(message.message ?? defaultStatusMessage(message.status));
      if (message.status === 'attached') terminal.focus();
    });

    socket.addEventListener('error', () => {
      if (!isActiveSocket()) return;
      attachedRef.current = false;
      setStatus('error');
      setStatusMessage(defaultStatusMessage('error'));
    });

    socket.addEventListener('close', () => {
      if (!isActiveSocket()) return;
      attachedRef.current = false;
      setStatus('disconnected');
      setStatusMessage(defaultStatusMessage('disconnected'));
    });

    return () => {
      active = false;
      attachedRef.current = false;
      dataSubscription.dispose();
      resizeObserver.disconnect();
      socket.close();
      socketRef.current = null;
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
      fitAddon.dispose();
    };
  }, [sessionId]);

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

      <div className="terminal-container" ref={terminalHostRef} />

      <div className="terminal-shortcut-bar" aria-label="Terminal shortcut keys">
        {SHORTCUT_KEYS.map((key) => (
          <button className="terminal-key" key={key.label} type="button" onClick={() => sendInput(key.data)}>
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
