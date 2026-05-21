/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalView from '../../src/client/components/TerminalView';
import type { TerminalServerMessage } from '../../src/shared/types';

const xtermMocks = vi.hoisted(() => {
  const terminalInstances: any[] = [];
  const fitAddonInstances: any[] = [];

  class MockTerminal {
    open = vi.fn();
    write = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
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
    expect(screen.getByRole('button', { name: '← 会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esc' })).toHaveClass('terminal-key');
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
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    socket.open();

    socket.receive({ type: 'status', sessionId: 'session-1', status: 'rejected', message: 'Terminal is already attached in another browser.' });
    expect(await screen.findByRole('status')).toHaveTextContent('Terminal is already attached in another browser.');
    expect(screen.getByRole('status')).toHaveClass('rejected');

    socket.receive({ type: 'status', sessionId: 'session-1', status: 'unavailable' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('终端不可用。'));
    expect(screen.getByRole('status')).toHaveClass('unavailable');

    socket.receive({ type: 'error', sessionId: 'session-1', message: 'terminal exploded' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('terminal exploded'));
    expect(screen.getByRole('status')).toHaveClass('error');

    socket.disconnect();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('终端连接已断开。'));
    expect(screen.getByRole('status')).toHaveClass('disconnected');
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
