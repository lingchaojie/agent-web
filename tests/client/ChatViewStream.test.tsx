/** @vitest-environment jsdom */
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from '../../src/client/components/ChatView';
import type { ClaudeSession, ConversationBlock, HistorySession, SessionStatuslineState, SessionViewState, SlashCommandEntry } from '../../src/shared/types';

vi.mock('../../src/client/api', () => ({
  openSessionSocket: vi.fn(),
  sendWs: vi.fn(),
}));

import { openSessionSocket, sendWs } from '../../src/client/api';

class FakeWebSocket extends EventTarget {
  readyState = 1;
  close = vi.fn();
}

const session: ClaudeSession = {
  id: 'session-1',
  projectId: 'project-1',
  source: 'web-created',
  claudeSessionId: null,
  title: 'Native session',
  status: 'running',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const appSession: ClaudeSession = {
  ...session,
  id: 'app-session-1',
  claudeSessionId: 'history-session-1',
  title: 'Existing app session',
};

describe('ChatView stream protocol rendering', () => {
  let socket: FakeWebSocket;

  beforeEach(() => {
    vi.mocked(openSessionSocket).mockReset();
    vi.mocked(sendWs).mockReset();
    socket = new FakeWebSocket();
    vi.mocked(openSessionSocket).mockReturnValue(socket as unknown as WebSocket);
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('subscribes with the resumable stream protocol when connected', async () => {
    render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);

    socket.dispatchEvent(new Event('open'));

    await waitFor(() => expect(sendWs).toHaveBeenCalledWith(socket, { type: 'subscribe', sessionId: session.id }));
  });

  it('uses the latest applied sequence when reconnecting after a disconnect', async () => {
    const firstSocket = socket;
    const secondSocket = new FakeWebSocket();
    vi.mocked(openSessionSocket).mockReturnValueOnce(firstSocket as unknown as WebSocket).mockReturnValueOnce(secondSocket as unknown as WebSocket);
    render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);

    firstSocket.dispatchEvent(new Event('open'));
    firstSocket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 4, session: sessionView({ latestSequence: 4 }), blocks: [block({ sequence: 4, text: 'Restored' })] }));
    firstSocket.dispatchEvent(new Event('close'));
    secondSocket.dispatchEvent(new Event('open'));

    await waitFor(() => expect(sendWs).toHaveBeenCalledWith(secondSocket, { type: 'subscribe', sessionId: session.id, afterSequence: 4 }));
    expect(await screen.findByText('Restored')).toBeInTheDocument();
  });

  it('marks the native shell layout and reduced-motion status transitions', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));

    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1, activity: 'working' }), blocks: [] }));

    expect(container.querySelector('[data-native-shell="chat"]')).toBeInTheDocument();
    expect(container.querySelector('[data-reduced-motion="true"]')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[data-status-transition="reduced"]')).toHaveTextContent('工作中'));
  });

  it('renders snapshot render state as a CLI-like surface instead of chat bubbles', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));

    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 2,
      session: sessionView({ latestSequence: 2 }),
      blocks: [],
      render: {
        sessionId: session.id,
        regions: [{ id: 'user-1', kind: 'user', text: '你好', status: 'final', source: 'structured', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
        activeRegion: { id: 'assistant-1', kind: 'assistant', text: '正在输出', status: 'streaming', source: 'structured', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        transientStatus: { activity: 'working', label: 'requesting' },
        diagnostics: [],
        transcriptSource: 'structured',
        sequence: 2,
      },
    }));

    expect(await screen.findByText('你好')).toBeInTheDocument();
    expect(screen.getByText('正在输出')).toBeInTheDocument();
    expect(screen.getByText('requesting')).toBeInTheDocument();
    expect(container.querySelector('.cli-render-surface')).toBeInTheDocument();
    expect(container.querySelectorAll('article.message-bubble')).toHaveLength(0);
  });

  it('renders snapshot blocks as typed native conversation blocks', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));

    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 2,
      session: sessionView({ latestSequence: 2 }),
      blocks: [
        block({ id: 'user-1', kind: 'user', text: '你好', sequence: 1 }),
        block({ id: 'assistant-1', kind: 'assistant', text: '完成', sequence: 2 }),
      ],
    }));

    expect(await screen.findByText('你好')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-block-kind]')).toHaveLength(2);
    expect(container.querySelector('[data-block-kind="assistant"]')).toHaveTextContent('完成');
  });

  it('updates one streaming assistant block when block update deltas arrive', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1 }), blocks: [] }));

    socket.dispatchEvent(serverMessage({ type: 'block-added', sessionId: session.id, sequence: 2, block: block({ id: 'assistant-1', text: 'Hel', sequence: 2, status: 'streaming' }) }));
    socket.dispatchEvent(serverMessage({ type: 'block-updated', sessionId: session.id, sequence: 3, blockId: 'assistant-1', patch: { text: 'Hello' } }));
    socket.dispatchEvent(serverMessage({ type: 'block-finalized', sessionId: session.id, sequence: 4, blockId: 'assistant-1' }));

    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-block-kind="assistant"]')).toHaveLength(1);
    expect(container.querySelector('[data-block-status="final"]')).toHaveTextContent('Hello');
  });

  it('renders interaction blocks as actionable prompt controls', async () => {
    render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1 }), blocks: [] }));
    socket.dispatchEvent(serverMessage({
      type: 'block-added',
      sessionId: session.id,
      sequence: 2,
      block: block({
        id: 'interaction-1',
        kind: 'interaction',
        text: 'Allow Bash?',
        sequence: 2,
        interaction: { kind: 'permission', raw: 'Allow Bash?', actions: [{ id: 'allow', label: 'Allow', input: '1', variant: 'allow' }] },
      }),
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));

    expect(sendWs).toHaveBeenCalledWith(socket, { type: 'action', sessionId: session.id, actionId: 'allow', input: '' });
  });

  it('shows degraded fallback source state without adding transcript blocks', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1, lifecycle: 'degraded-fallback', transcriptSource: 'pty-fallback' }), blocks: [] }));

    expect(await screen.findByText('降级模式')).toBeInTheDocument();
    expect(screen.getByText('PTY fallback')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-block-kind]')).toHaveLength(0);
  });

  it('opens slash suggestions, supports keyboard selection, and preserves normal prompt submission', async () => {
    render(<ChatView session={session} commandEntries={slashCommands()} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    await waitFor(() => expect(sendWs).toHaveBeenCalledWith(socket, { type: 'subscribe', sessionId: session.id }));
    vi.mocked(sendWs).mockClear();

    const composer = screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...');
    fireEvent.change(composer, { target: { value: '/d' } });

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Deploy/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(composer).toHaveValue('/deploy ');
    expect(sendWs).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: 'hello /tmp' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(sendWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: session.id, text: 'hello /tmp' });
  });

  it('shows unsupported command feedback without sending raw input', async () => {
    render(<ChatView session={session} commandEntries={unsupportedCommands()} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    await waitFor(() => expect(sendWs).toHaveBeenCalledWith(socket, { type: 'subscribe', sessionId: session.id }));
    vi.mocked(sendWs).mockClear();

    const composer = screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...');
    fireEvent.change(composer, { target: { value: '/doctor' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(await screen.findByText('此命令当前不能在 Web 客户端执行。')).toBeInTheDocument();
    expect(sendWs).not.toHaveBeenCalled();
  });

  it('opens existing app sessions from the resume command without sending raw input', async () => {
    const onOpenHistorySession = vi.fn();
    render(
      <ChatView
        session={session}
        commandEntries={slashCommands()}
        resumeCandidates={[historySession({ appSession })]}
        onOpenHistorySession={onOpenHistorySession}
        onStatusChange={vi.fn()}
        onBackToSessions={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    socket.dispatchEvent(new Event('open'));
    await waitFor(() => expect(sendWs).toHaveBeenCalledWith(socket, { type: 'subscribe', sessionId: session.id }));
    vi.mocked(sendWs).mockClear();

    const composer = screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...');
    fireEvent.change(composer, { target: { value: '/resume' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: /Demo history/ }));

    expect(onOpenHistorySession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'history-session-1' }));
    expect(sendWs).not.toHaveBeenCalled();
  });

  it('shows an empty resume state when the active project has no history', async () => {
    render(<ChatView session={session} commandEntries={slashCommands()} resumeCandidates={[]} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));

    const composer = screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...');
    fireEvent.change(composer, { target: { value: '/resume' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(await screen.findByText('当前项目没有可恢复的历史会话。')).toBeInTheDocument();
  });

  it('shows a non-destructive disconnected state without clearing blocks', async () => {
    render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [block({ text: 'Still visible' })],
    }));

    socket.dispatchEvent(new Event('close'));

    expect(await screen.findByText('Still visible')).toBeInTheDocument();
    expect(screen.getByText('实时会话已断开。')).toBeInTheDocument();
  });

  it('shows tmux capture source and disconnected lifecycle with readable labels', async () => {
    const externalSession = { ...session, source: 'external-tmux' as const };

    function ControlledChatView() {
      const [currentSession, setCurrentSession] = useState(externalSession);
      return (
        <ChatView
          session={currentSession}
          onStatusChange={(_sessionId, status) => setCurrentSession((current) => ({ ...current, status }))}
          onBackToSessions={vi.fn()}
          onStop={vi.fn()}
        />
      );
    }

    render(<ControlledChatView />);
    act(() => {
      socket.dispatchEvent(new Event('open'));
      socket.dispatchEvent(serverMessage({
        type: 'snapshot',
        sessionId: session.id,
        sequence: 1,
        session: sessionView({ latestSequence: 1, lifecycle: 'disconnected', activity: 'stopped', transcriptSource: 'tmux-capture' }),
        blocks: [],
      }));
    });

    expect(await screen.findByText('已断开')).toBeInTheDocument();
    expect(screen.getByText('tmux capture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '断开' })).toBeDisabled();
  });

  it('renders the active session statusline above the composer with ANSI colors preserved', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
      statusline: statusline({ text: '[36mOpus 4.7[0m  [35mxhigh[0m\n[33mdisplay-session-ccstatusline[0m (shift+tab to cycle)' }),
    }));

    const panel = await screen.findByRole('status', { name: 'Claude Code statusline' });
    expect(panel).toHaveTextContent('Opus 4.7 xhigh');
    expect(panel).toHaveTextContent('display-session-ccstatusline');
    expect(panel).not.toHaveTextContent('shift+tab');
    expect(container.querySelector('.session-statusline')).toBeInTheDocument();
    expect(container.querySelector('.ansi-fg-cyan')).toHaveTextContent('Opus 4.7');
    expect(container.querySelector('.ansi-fg-magenta')).toHaveTextContent('xhigh');
    expect(container.querySelector('.session-statusline')?.compareDocumentPosition(screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders 256-color statusline ANSI without treating palette indexes as basic colors', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
      statusline: statusline({ text: '[38;5;30mClaude[39m [38;5;96mxhigh[39m' }),
    }));

    await screen.findByText('Claude');
    expect(container.querySelector('.ansi-fg-black')).not.toBeInTheDocument();
    expect(container.querySelector('[style*="rgb(0, 135, 135)"]')).toHaveTextContent('Claude');
    expect(container.querySelector('[style*="rgb(135, 95, 135)"]')).toHaveTextContent('xhigh');
  });

  it('updates statusline from live stream events without adding transcript blocks', async () => {
    const { container } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1 }), blocks: [] }));
    socket.dispatchEvent(serverMessage({ type: 'statusline-changed', sessionId: session.id, sequence: 2, statusline: statusline({ text: '[32mGPT Usage[0m', sequence: 2 }) }));

    expect(await screen.findByText('GPT Usage')).toBeInTheDocument();
    expect(container.querySelector('.ansi-fg-green')).toHaveTextContent('GPT Usage');
    expect(container.querySelectorAll('[data-block-kind]')).toHaveLength(0);
  });

  it('shows a compact statusline error state when command output is unavailable', async () => {
    render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
      statusline: statusline({ status: 'error', text: '', error: 'Statusline command is not configured' }),
    }));

    expect(await screen.findByText('Statusline command is not configured')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...')).toBeEnabled();
  });

  it('clears stale statusline output when switching selected sessions', async () => {
    const secondSession = { ...session, id: 'session-2', title: 'Second session' };
    const { rerender } = render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
      statusline: statusline({ text: 'session one status' }),
    }));
    expect(await screen.findByText('session one status')).toBeInTheDocument();

    const secondSocket = new FakeWebSocket();
    vi.mocked(openSessionSocket).mockReturnValue(secondSocket as unknown as WebSocket);
    rerender(<ChatView session={secondSession} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);

    expect(screen.queryByText('session one status')).not.toBeInTheDocument();
    expect(screen.getByText('Statusline unavailable')).toBeInTheDocument();
  });
});

function serverMessage(message: unknown): MessageEvent {
  return new MessageEvent('message', { data: JSON.stringify(message) });
}

function slashCommands(): SlashCommandEntry[] {
  return [
    { name: '/resume', title: 'Resume session', description: 'Resume a Claude Code history session', scope: 'app', behavior: 'app-owned', support: 'supported', aliases: [] },
    { name: '/deploy', title: 'Deploy', description: 'Ship the selected service', scope: 'project', behavior: 'prompt-insert', support: 'supported', aliases: [] },
  ];
}

function unsupportedCommands(): SlashCommandEntry[] {
  return [
    { name: '/doctor', title: 'Doctor', description: 'Check installation health', scope: 'user', behavior: 'unsupported', support: 'unsupported', aliases: [] },
  ];
}

function historySession(overrides: Partial<HistorySession> = {}): HistorySession {
  return {
    projectKey: 'project-1',
    projectPath: '/tmp/demo',
    sessionId: 'history-session-1',
    transcriptPath: '/tmp/demo/history-session-1.jsonl',
    title: 'Demo history',
    lastMessage: 'Continue this work',
    updatedAt: '2026-01-01T00:00:00.000Z',
    blocks: [],
    ...overrides,
  };
}

function sessionView(overrides: Partial<SessionViewState> = {}): SessionViewState {
  return {
    sessionId: session.id,
    projectId: session.projectId,
    title: session.title,
    lifecycle: 'running',
    activity: 'idle',
    connection: 'connected',
    transcriptSource: 'structured',
    claudeSessionId: null,
    latestSequence: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingInteraction: null,
    ...overrides,
  };
}

function block(overrides: Partial<ConversationBlock> = {}): ConversationBlock {
  return {
    id: 'block-1',
    sessionId: session.id,
    kind: 'assistant',
    text: '',
    sequence: 1,
    status: 'final',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'live',
    ...overrides,
  };
}

function statusline(overrides: Partial<SessionStatuslineState> = {}): SessionStatuslineState {
  return {
    sessionId: session.id,
    status: 'ready',
    text: 'status',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sequence: 1,
    ...overrides,
  };
}
