/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalView from '../../src/client/components/TerminalView';
import type { TerminalServerMessage } from '../../src/shared/types';

const stylesPath = resolve(process.cwd(), 'src/client/styles.css');

const xtermMocks = vi.hoisted(() => {
  const terminalInstances: any[] = [];
  const fitAddonInstances: any[] = [];

  class MockTerminal {
    open = vi.fn();
    write = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    scrollPages = vi.fn();
    scrollToBottom = vi.fn();
    dispose = vi.fn();
    private readonly dataCallbacks: Array<(data: string) => void> = [];
    readonly dataDisposables: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];

    constructor() {
      terminalInstances.push(this);
    }

    onData(callback: (data: string) => void) {
      this.dataCallbacks.push(callback);
      const disposable = { dispose: vi.fn() };
      this.dataDisposables.push(disposable);
      return disposable;
    }

    emitData(data: string) {
      for (const callback of this.dataCallbacks) callback(data);
    }
  }

  class MockFitAddon {
    fit = vi.fn();
    dispose = vi.fn();
    dimensions: { cols: number; rows: number } | undefined = { cols: 120, rows: 32 };
    proposeDimensions = vi.fn(() => this.dimensions);

    constructor() {
      fitAddonInstances.push(this);
    }
  }

  return { MockTerminal, MockFitAddon, terminalInstances, fitAddonInstances };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: xtermMocks.MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: xtermMocks.MockFitAddon,
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('../../src/client/api', () => ({
  openTerminalSocket: vi.fn(),
  sendTerminalWs: vi.fn(),
}));

import { openTerminalSocket, sendTerminalWs } from '../../src/client/api';

class FakeWebSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });

  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: TerminalServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  disconnect() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

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
  stop = vi.fn();
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
  isSecureContext?: boolean;
};

function fireTouchEvent(target: Element, type: string, touches: Array<{ identifier: number; clientX: number; clientY: number }>, changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  target.dispatchEvent(event);
  return event;
}

function enableSpeechRecognition() {
  (window as SpeechWindow).SpeechRecognition = MockSpeechRecognition;
}

function disableSpeechRecognition() {
  delete (window as SpeechWindow).SpeechRecognition;
  delete (window as SpeechWindow).webkitSpeechRecognition;
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value,
  });
}

type MockResizeObserver = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger(): void;
};

describe('TerminalView', () => {
  let socket: FakeWebSocket;
  let resizeObservers: MockResizeObserver[];

  beforeEach(() => {
    xtermMocks.terminalInstances.length = 0;
    xtermMocks.fitAddonInstances.length = 0;
    MockSpeechRecognition.instances = [];
    disableSpeechRecognition();
    setSecureContext(true);
    resizeObservers = [];

    class FakeResizeObserver implements ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(private readonly callback: ResizeObserverCallback) {
        resizeObservers.push(this);
      }

      trigger() {
        this.callback([], this);
      }
    }

    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.mocked(openTerminalSocket).mockReset();
    vi.mocked(sendTerminalWs).mockReset();
    vi.mocked(sendTerminalWs).mockImplementation(() => undefined);
    socket = new FakeWebSocket();
    vi.mocked(openTerminalSocket).mockReturnValue(socket as unknown as WebSocket);
  });

  it('renders mobile terminal layout and shortcut bar classes', () => {
    const { container } = render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);

    expect(container.querySelector('.terminal-view')).toBeInTheDocument();
    expect(container.querySelector('.terminal-container')).toBeInTheDocument();
    expect(container.querySelector('.terminal-shortcut-bar')).toBeInTheDocument();
    expect(container.querySelector('.terminal-voice-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← 会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esc' })).toHaveClass('terminal-key');
    expect(screen.getByRole('button', { name: '系统语音输入' })).toHaveClass('terminal-voice-button');
  });

  it('opens xterm and sends attach with proposed dimensions when the socket opens', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(xtermMocks.terminalInstances).toHaveLength(1);
    expect(xtermMocks.fitAddonInstances).toHaveLength(1);

    const terminal = xtermMocks.terminalInstances[0];
    const fitAddon = xtermMocks.fitAddonInstances[0];
    expect(terminal.loadAddon).toHaveBeenCalledWith(fitAddon);
    expect(terminal.open).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    expect(resizeObservers).toHaveLength(1);
    expect(resizeObservers[0].observe).toHaveBeenCalledWith(expect.any(HTMLDivElement));

    socket.open();

    await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'attach', sessionId: 'session-1', cols: 120, rows: 32 }));
  });

  it('focuses xterm after opening, after attach, and when the panel is clicked', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];

    expect(terminal.focus).toHaveBeenCalledTimes(1);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    await waitFor(() => expect(terminal.focus).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('region', { name: 'Claude Code terminal' }));

    expect(terminal.focus).toHaveBeenCalledTimes(3);
  });

  it('writes output messages for the active session into xterm', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];

    socket.open();
    socket.receive({ type: 'output', sessionId: 'other-session', data: 'ignored' });
    socket.receive({ type: 'output', sessionId: 'session-1', data: 'hello\r\n' });

    await waitFor(() => expect(terminal.write).toHaveBeenCalledWith('hello\r\n'));
    expect(terminal.write).not.toHaveBeenCalledWith('ignored');
  });

  it('sends xterm data and mobile shortcut input only after attach is confirmed', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];

    for (const label of ['Esc', 'Tab', 'Ctrl+C', 'Ctrl+D', '↑', '↓', '←', '→', 'PgUp', 'PgDn', '底部', 'Enter']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    terminal.emitData('before-open');
    fireEvent.click(screen.getByRole('button', { name: 'Esc' }));
    expect(sendTerminalWs).not.toHaveBeenCalled();

    socket.open();
    await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'attach', sessionId: 'session-1', cols: 120, rows: 32 }));
    vi.mocked(sendTerminalWs).mockClear();

    terminal.emitData('before-attached');
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }));
    expect(sendTerminalWs).not.toHaveBeenCalled();

    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    terminal.emitData('ls\r');
    terminal.emitData('/');
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: 'ls\r' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '/' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\x03' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\r' });
  });

  it('scrolls terminal history from mobile shortcut buttons without sending input', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();
    vi.mocked(terminal.focus).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'PgUp' }));
    fireEvent.click(screen.getByRole('button', { name: 'PgDn' }));
    fireEvent.click(screen.getByRole('button', { name: '底部' }));

    await waitFor(() => expect(terminal.scrollPages).toHaveBeenCalledWith(-1));
    expect(terminal.scrollPages).toHaveBeenCalledWith(1);
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(terminal.focus.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('turns native vertical touch drags into terminal mouse-wheel input', async () => {
    const { container } = render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];
    const terminalContainer = container.querySelector('.terminal-container') as HTMLDivElement;
    const terminalHost = container.querySelector('.terminal-xterm-host') as HTMLDivElement;
    const helperTextarea = document.createElement('textarea');
    helperTextarea.className = 'xterm-helper-textarea';
    terminalHost.appendChild(helperTextarea);
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(terminalContainer, 'setPointerCapture', { configurable: true, value: setPointerCapture });
    Object.defineProperty(terminalContainer, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    await act(async () => {
      fireTouchEvent(terminalContainer, 'touchstart', [{ identifier: 12, clientX: 100, clientY: 300 }]);
      fireTouchEvent(terminalContainer, 'touchmove', [{ identifier: 12, clientX: 102, clientY: 250 }]);
      fireTouchEvent(terminalContainer, 'touchmove', [{ identifier: 12, clientX: 103, clientY: 200 }]);
      fireTouchEvent(terminalContainer, 'touchend', [], [{ identifier: 12, clientX: 103, clientY: 200 }]);
    });

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(releasePointerCapture).not.toHaveBeenCalled();
    expect(terminal.scrollLines).not.toHaveBeenCalled();
    expect(sendTerminalWs).toHaveBeenCalledTimes(2);
    expect(sendTerminalWs).toHaveBeenNthCalledWith(1, socket, { type: 'input', sessionId: 'session-1', data: '\x1b[<64;1;1M\x1b[<64;1;1M' });
    expect(sendTerminalWs).toHaveBeenNthCalledWith(2, socket, { type: 'input', sessionId: 'session-1', data: '\x1b[<64;1;1M\x1b[<64;1;1M' });
  });

  it('keeps horizontal native touch drags as terminal-container sideways scrolling', async () => {
    const { container } = render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];
    const terminalContainer = container.querySelector('.terminal-container') as HTMLDivElement;
    terminalContainer.scrollLeft = 80;

    await act(async () => {
      fireTouchEvent(terminalContainer, 'touchstart', [{ identifier: 13, clientX: 150, clientY: 300 }]);
      fireTouchEvent(terminalContainer, 'touchmove', [{ identifier: 13, clientX: 120, clientY: 302 }]);
    });

    expect(terminalContainer.scrollLeft).toBe(110);
    expect(terminal.scrollLines).not.toHaveBeenCalled();
  });

  it('inserts final speech transcript into the attached terminal without submitting', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 1 });
    });
    await act(async () => {
      MockSpeechRecognition.instances[0].emitResult([{ transcript: '写一个测试', isFinal: true }]);
    });
    await act(async () => {
      fireEvent.pointerUp(voiceButton, { pointerId: 1 });
    });
    await act(async () => {
      MockSpeechRecognition.instances[0].onend?.(new Event('end'));
    });

    await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '写一个测试' }));
    expect(sendTerminalWs).not.toHaveBeenCalledWith(socket, expect.objectContaining({ data: expect.stringContaining('\r') }));
  });

  it('previews interim speech without sending terminal input', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 1 });
    });
    await act(async () => {
      MockSpeechRecognition.instances[0].emitResult([{ transcript: '临时内容', isFinal: false }]);
    });

    expect(await screen.findByText('正在识别：临时内容')).toBeInTheDocument();
    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('cancels speech recognition without inserting cancelled text', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 1 });
    });
    await act(async () => {
      MockSpeechRecognition.instances[0].emitResult([{ transcript: '不要插入', isFinal: true }]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    await waitFor(() => expect(screen.getByText('语音输入已取消。')).toBeInTheDocument());
    expect(MockSpeechRecognition.instances[0].abort).toHaveBeenCalledOnce();
    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('shows the HTTP-specific fallback button without blocking terminal input', async () => {
    setSecureContext(false);
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    expect(screen.getByRole('button', { name: '系统语音输入' })).toBeEnabled();
    expect(screen.getByText('语音输入需要 HTTPS。也可以点“系统语音输入”，用手机键盘麦克风输入后插入终端。')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enter' }));
    });

    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\r' });
  });

  it('opens and focuses the fallback textarea when system voice input is clicked', async () => {
    setSecureContext(false);
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '系统语音输入' }));
    });

    const textarea = screen.getByRole('textbox', { name: '终端文本输入' });
    expect(textarea).toBeInTheDocument();
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(screen.getByRole('button', { name: '插入终端' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('inserts trimmed fallback text into the terminal without submitting and then closes and clears the panel', async () => {
    setSecureContext(false);
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '系统语音输入' }));
    });

    const textarea = screen.getByRole('textbox', { name: '终端文本输入' });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '  你好 Claude  ' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '插入终端' }));
    });

    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '你好 Claude' });
    expect(sendTerminalWs).not.toHaveBeenCalledWith(socket, expect.objectContaining({ data: expect.stringContaining('\r') }));
    expect(screen.queryByRole('textbox', { name: '终端文本输入' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '系统语音输入' }));
    });

    expect(screen.getByRole('textbox', { name: '终端文本输入' })).toHaveValue('');
  });

  it('opens the same terminal text box for paste/input when speech recognition is available', async () => {
    enableSpeechRecognition();
    const readText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    expect(screen.getByRole('button', { name: '按住说话' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '粘贴/输入' }));
    });

    const textarea = screen.getByRole('textbox', { name: '终端文本输入' });
    await waitFor(() => expect(textarea).toHaveFocus());
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'printf "hello"\nls -la' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '插入终端' }));
    });

    expect(readText).not.toHaveBeenCalled();
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: 'printf "hello"\nls -la' });
    expect(sendTerminalWs).not.toHaveBeenCalledWith(socket, expect.objectContaining({ data: expect.stringContaining('\r') }));
    expect(screen.queryByRole('textbox', { name: '终端文本输入' })).not.toBeInTheDocument();
  });

  it('does not send empty fallback text', async () => {
    setSecureContext(false);
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '系统语音输入' }));
    });

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: '终端文本输入' }), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: '插入终端' }));
    });

    expect(sendTerminalWs).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '终端文本输入' })).toBeInTheDocument();
  });

  it('closes the fallback panel without sending when cancelled', async () => {
    setSecureContext(false);
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '系统语音输入' }));
    });

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: '终端文本输入' }), { target: { value: '不要发送' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    expect(sendTerminalWs).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '终端文本输入' })).not.toBeInTheDocument();
  });

  it('closes the fallback panel without claiming success when the terminal detaches', async () => {
    setSecureContext(false);
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '系统语音输入' }));
    });

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: '终端文本输入' }), { target: { value: '断开前的文本' } });
    });

    vi.mocked(sendTerminalWs).mockClear();

    await act(async () => {
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'rejected' });
    });

    expect(screen.queryByRole('textbox', { name: '终端文本输入' })).not.toBeInTheDocument();
    expect(screen.getByText('终端已在其他浏览器中打开。')).toBeInTheDocument();
    expect(screen.queryByText('语音内容已插入终端。')).not.toBeInTheDocument();
    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('streams direct phone keyboard text through the terminal input layer', async () => {
    const { container } = render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const keyboard = screen.getByRole('textbox', { name: '手机终端键盘输入' }) as HTMLTextAreaElement;

    await act(async () => {
      socket.open();
      socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    });
    vi.mocked(sendTerminalWs).mockClear();

    fireEvent.click(container.querySelector('.terminal-container') as HTMLDivElement);
    expect(keyboard).toHaveFocus();

    await act(async () => {
      fireEvent.input(keyboard, { target: { value: '/help' } });
    });
    await act(async () => {
      fireEvent.keyDown(keyboard, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.keyDown(keyboard, { key: 'Backspace' });
    });

    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '/help' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\r' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\x7f' });
    expect(keyboard).toHaveValue('');
  });

  it('keeps the phone keyboard input layer anchored inside the terminal on mobile', () => {
    const styles = readFileSync(stylesPath, 'utf8');

    expect(styles).toMatch(/\.terminal-container\s*\{[^}]*position:\s*relative\s*;[^}]*touch-action:\s*pan-x\s*;/s);
    expect(styles).toMatch(/\.terminal-keyboard-input\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*2;[^}]*opacity:\s*0\.01;/s);
    expect(styles).toMatch(/\.terminal-xterm-host \.xterm \.xterm-helper-textarea,[\s\S]*?\.terminal-keyboard-input\s*\{[^}]*left:\s*0\s*!important;[^}]*top:\s*0\s*!important;[^}]*width:\s*1px\s*!important;[^}]*height:\s*1px\s*!important;[^}]*min-height:\s*1px\s*!important;[^}]*padding:\s*0\s*!important;[^}]*box-shadow:\s*none\s*!important;/s);
  });

  it('keeps voice status in the shrinkable final track when the fallback panel is closed', () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    const status = screen.getByText('此浏览器暂不支持语音输入。');
    const styles = readFileSync(stylesPath, 'utf8');

    expect(status).toHaveClass('terminal-voice-status');
    expect(styles).toMatch(/\.terminal-voice-status\s*\{[^}]*grid-column:\s*3\s*;/s);
  });

  it('cancels active speech recognition when the terminal becomes hidden and ignores late final results', async () => {
    enableSpeechRecognition();
    const { rerender } = render(<TerminalView sessionId="session-1" title="Claude shell" visible={true} onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 5 });
    });
    const recognition = MockSpeechRecognition.instances[0];

    await act(async () => {
      rerender(<TerminalView sessionId="session-1" title="Claude shell" visible={false} onBack={vi.fn()} />);
    });

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(screen.getByText('语音输入已取消。')).toBeInTheDocument();

    await act(async () => {
      recognition.emitResult([{ transcript: '隐藏后到达的最终结果', isFinal: true }]);
      recognition.onend?.(new Event('end'));
    });

    expect(sendTerminalWs).not.toHaveBeenCalled();
    expect(screen.getByText('语音输入已取消。')).toBeInTheDocument();
  });

  it('shows speech recognition errors without sending terminal input', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 1 });
    });
    await act(async () => {
      MockSpeechRecognition.instances[0].emitError('not-allowed');
    });

    expect(await screen.findByText('麦克风权限被拒绝，无法使用语音输入。')).toBeInTheDocument();
    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('releases pointer capture when speech input finishes after pressing the button', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(voiceButton, 'setPointerCapture', { configurable: true, value: setPointerCapture });
    Object.defineProperty(voiceButton, 'releasePointerCapture', { configurable: true, value: releasePointerCapture });

    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 7 });
    });
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    await act(async () => {
      fireEvent.pointerUp(voiceButton, { pointerId: 7 });
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('cancels active speech recognition when the pointer leaves the button before release', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 8 });
    });
    const recognition = MockSpeechRecognition.instances[0];

    await act(async () => {
      recognition.emitResult([{ transcript: '拖出按钮后松开', isFinal: true }]);
    });

    await act(async () => {
      fireEvent.pointerLeave(voiceButton, { pointerId: 8 });
    });

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(screen.getByText('语音输入已取消。')).toBeInTheDocument();

    await act(async () => {
      recognition.onend?.(new Event('end'));
    });

    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('ignores stale speech callbacks after cancellation', async () => {
    enableSpeechRecognition();
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    const voiceButton = screen.getByRole('button', { name: '按住说话' });
    await act(async () => {
      fireEvent.pointerDown(voiceButton, { pointerId: 3 });
    });
    const recognition = MockSpeechRecognition.instances[0];

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    await act(async () => {
      recognition.onstart?.(new Event('start'));
      recognition.emitResult([{ transcript: '过期结果', isFinal: false }]);
      recognition.emitResult([{ transcript: '过期最终结果', isFinal: true }]);
      recognition.emitError('network');
      recognition.onend?.(new Event('end'));
    });

    expect(screen.getByRole('button', { name: '按住说话' })).toBeInTheDocument();
    expect(screen.getByText('语音输入已取消。')).toBeInTheDocument();
    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('fits on resize and sends resized dimensions after the terminal is attached', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const fitAddon = xtermMocks.fitAddonInstances[0];

    socket.open();
    await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'attach', sessionId: 'session-1', cols: 120, rows: 32 }));
    vi.mocked(sendTerminalWs).mockClear();

    resizeObservers[0].trigger();
    expect(sendTerminalWs).not.toHaveBeenCalled();

    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    fitAddon.dimensions = { cols: 140, rows: 40 };
    resizeObservers[0].trigger();

    await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'resize', sessionId: 'session-1', cols: 140, rows: 40 }));
  });

  it('does not send invalid resize dimensions while the terminal is hidden', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const fitAddon = xtermMocks.fitAddonInstances[0];

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();

    fitAddon.dimensions = { cols: 0, rows: 0 };
    resizeObservers[0].trigger();
    fitAddon.dimensions = { cols: Number.NaN, rows: Number.NaN };
    resizeObservers[0].trigger();
    fitAddon.dimensions = { cols: 80.5, rows: 24.2 };
    resizeObservers[0].trigger();

    expect(sendTerminalWs).not.toHaveBeenCalled();
  });

  it('refits and resizes when a hidden terminal becomes visible again', async () => {
    const { rerender } = render(<TerminalView sessionId="session-1" title="Claude shell" visible={true} onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];
    const fitAddon = xtermMocks.fitAddonInstances[0];

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    vi.mocked(sendTerminalWs).mockClear();
    vi.mocked(fitAddon.fit).mockClear();
    vi.mocked(terminal.focus).mockClear();

    rerender(<TerminalView sessionId="session-1" title="Claude shell" visible={false} onBack={vi.fn()} />);
    fitAddon.dimensions = { cols: 92, rows: 28 };
    rerender(<TerminalView sessionId="session-1" title="Claude shell" visible={true} onBack={vi.fn()} />);

    await waitFor(() => expect(fitAddon.fit).toHaveBeenCalledTimes(1));
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'resize', sessionId: 'session-1', cols: 92, rows: 28 });
    expect(terminal.focus).toHaveBeenCalledTimes(1);
  });

  it('renders status, error, and disconnected messages', async () => {
    const { container } = render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminalStatus = () => container.querySelector('.terminal-status');
    socket.open();

    socket.receive({ type: 'status', sessionId: 'session-1', status: 'rejected', message: 'Terminal is already attached in another browser.' });
    await waitFor(() => expect(terminalStatus()).toHaveTextContent('Terminal is already attached in another browser.'));
    expect(terminalStatus()).toHaveClass('rejected');

    socket.receive({ type: 'status', sessionId: 'session-1', status: 'unavailable' });
    await waitFor(() => expect(terminalStatus()).toHaveTextContent('终端不可用。'));
    expect(terminalStatus()).toHaveClass('unavailable');

    socket.receive({ type: 'error', sessionId: 'session-1', message: 'terminal exploded' });
    await waitFor(() => expect(terminalStatus()).toHaveTextContent('terminal exploded'));
    expect(terminalStatus()).toHaveClass('error');

    socket.disconnect();
    await waitFor(() => expect(terminalStatus()).toHaveTextContent('终端连接已断开。'));
    expect(terminalStatus()).toHaveClass('disconnected');
  });

  it('cleans up xterm, resize observer, and websocket resources on unmount', () => {
    const { unmount } = render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];
    const fitAddon = xtermMocks.fitAddonInstances[0];
    const subscription = terminal.dataDisposables[0];

    unmount();

    expect(subscription.dispose).toHaveBeenCalledTimes(1);
    expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
    expect(fitAddon.dispose).toHaveBeenCalledTimes(1);
  });
});
