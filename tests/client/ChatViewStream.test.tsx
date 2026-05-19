/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from '../../src/client/components/ChatView';
import type { ClaudeSession, ConversationBlock, SessionViewState } from '../../src/shared/types';

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
});

function serverMessage(message: unknown): MessageEvent {
  return new MessageEvent('message', { data: JSON.stringify(message) });
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
