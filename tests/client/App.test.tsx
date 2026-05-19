/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import type { ClaudeSession, ConversationBlock, Project, SessionViewState } from '../../src/shared/types';

vi.mock('../../src/client/api', () => ({
  checkAuth: vi.fn(),
  continueSession: vi.fn(),
  createSession: vi.fn(),
  listHistory: vi.fn(),
  listProjects: vi.fn(),
  listSessions: vi.fn(),
  resumeSession: vi.fn(),
  stopSession: vi.fn(),
  openSessionSocket: vi.fn(),
  sendWs: vi.fn(),
}));

import {
  checkAuth,
  createSession,
  listHistory,
  listProjects,
  listSessions,
  openSessionSocket,
  stopSession,
} from '../../src/client/api';

class FakeWebSocket extends EventTarget {
  readyState = 1;
  close = vi.fn();
}

let socket: FakeWebSocket;

function serverMessage(message: unknown): MessageEvent {
  return new MessageEvent('message', { data: JSON.stringify(message) });
}

const project: Project = {
  id: 'history:L3RtcC9kZW1v',
  name: 'demo',
  path: '/tmp/demo',
  favorite: false,
  available: true,
  source: 'history',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const session: ClaudeSession = {
  id: 'session-1',
  projectId: project.id,
  source: 'web-created',
  claudeSessionId: null,
  title: 'New session',
  status: 'running',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

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

describe('App mobile drilldown', () => {
  beforeEach(() => {
    vi.mocked(checkAuth).mockResolvedValue(true);
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(listHistory).mockResolvedValue([]);
    vi.mocked(listSessions).mockResolvedValue([]);
    vi.mocked(createSession).mockResolvedValue(session);
    vi.mocked(stopSession).mockResolvedValue({ ...session, status: 'stopped' });
    socket = new FakeWebSocket();
    vi.mocked(openSessionSocket).mockReturnValue(socket as unknown as WebSocket);
  });

  it('stops running sessions and removes them from the live list', async () => {
    vi.mocked(listSessions).mockResolvedValue([session]);
    render(<App />);

    await screen.findByRole('button', { name: /demo/i });
    fireEvent.click(screen.getByRole('button', { name: /demo/i }));
    fireEvent.click(await screen.findByRole('button', { name: /关闭 New session/i }));

    await waitFor(() => expect(stopSession).toHaveBeenCalledWith(session.id));
    await waitFor(() => expect(screen.queryByText('New session')).not.toBeInTheDocument());
  });

  it('renders a native Claude shell with sidebar, session rail, conversation canvas, and mobile drawer state', async () => {
    const { container } = render(<App />);

    await screen.findByText('项目');
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    await screen.findByRole('button', { name: /demo/i });
    const shell = container.querySelector('.native-shell');
    expect(shell).toHaveAttribute('data-native-shell', 'app');
    expect(shell).toHaveAttribute('data-mobile-pane', 'projects');
    expect(container.querySelector('.workspace-sidebar')).toBeInTheDocument();
    expect(container.querySelector('.session-rail')).toBeInTheDocument();
    expect(container.querySelector('.conversation-canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /demo/i }));
    expect(shell).toHaveAttribute('data-mobile-pane', 'sessions');

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await waitFor(() => expect(shell).toHaveAttribute('data-mobile-pane', 'chat'));
    expect(await screen.findByRole('heading', { name: 'New session' })).toBeInTheDocument();
  });

  it('shows working, idle, and stop controls for the active chat session', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await screen.findByRole('heading', { name: 'New session' });
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1 }), blocks: [] }));
    await screen.findByText('connected');

    expect(await screen.findByText('等待输入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...'), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(screen.getByText('工作中')).toBeInTheDocument();
    socket.dispatchEvent(serverMessage({ type: 'activity-changed', sessionId: session.id, sequence: 2, activity: 'idle' }));

    expect(await screen.findByText('等待输入')).toBeInTheDocument();
  });

  it('renders repeated transient activity as one stable indicator without assistant bubbles', async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await screen.findByRole('heading', { name: 'New session' });
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({ type: 'snapshot', sessionId: session.id, sequence: 1, session: sessionView({ latestSequence: 1 }), blocks: [] }));
    await screen.findByText('connected');

    socket.dispatchEvent(serverMessage({ type: 'activity-changed', sessionId: session.id, sequence: 2, activity: 'working' }));
    socket.dispatchEvent(serverMessage({ type: 'activity-changed', sessionId: session.id, sequence: 3, activity: 'working' }));

    expect(await screen.findByText('Claude 正在处理…')).toBeInTheDocument();
    expect(container.querySelectorAll('article.message-bubble.assistant')).toHaveLength(0);

    socket.dispatchEvent(serverMessage({ type: 'block-added', sessionId: session.id, sequence: 4, block: block({ id: 'assistant-1', text: '完成', sequence: 4 }) }));
    socket.dispatchEvent(serverMessage({ type: 'activity-changed', sessionId: session.id, sequence: 5, activity: 'idle' }));

    expect(await screen.findByText('等待输入')).toBeInTheDocument();
    expect(screen.queryByText('Claude 正在处理…')).not.toBeInTheDocument();
  });

  it('restores the selected running session after a refresh and replays its snapshot', async () => {
    localStorage.setItem('webagent.selectedProjectId', project.id);
    localStorage.setItem('webagent.selectedSessionId', session.id);
    vi.mocked(listSessions).mockResolvedValue([session]);
    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: 'New session' })).toBeInTheDocument();
    expect(container.querySelector('.native-shell')).toHaveAttribute('data-mobile-pane', 'chat');
    await waitFor(() => expect(openSessionSocket).toHaveBeenCalled());

    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 4,
      session: sessionView({ latestSequence: 4 }),
      blocks: [block({ id: 'restored-after-refresh', text: 'Restored after refresh', sequence: 4 })],
    }));

    expect(await screen.findByText('Restored after refresh')).toBeInTheDocument();
  });
});
