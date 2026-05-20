/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import type { ClaudeSession, ConversationBlock, HistorySession, Project, SessionViewState, TranscriptWindow } from '../../src/shared/types';

vi.mock('../../src/client/api', () => ({
  checkAuth: vi.fn(),
  continueSession: vi.fn(),
  createSession: vi.fn(),
  listHistory: vi.fn(),
  listProjects: vi.fn(),
  listSessions: vi.fn(),
  listSlashCommands: vi.fn(),
  loadHistoryTranscript: vi.fn(),
  loadSessionTranscript: vi.fn(),
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
  listSlashCommands,
  loadHistoryTranscript,
  loadSessionTranscript,
  openSessionSocket,
  resumeSession,
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

function transcriptWindow(overrides: Partial<TranscriptWindow> = {}): TranscriptWindow {
  return {
    sessionId: 'native-session',
    projectKey: '-tmp-demo',
    projectPath: project.path,
    title: 'Native transcript',
    updatedAt: '2026-01-01T00:00:00.000Z',
    regions: [],
    olderCursor: null,
    hasMoreOlder: false,
    ...overrides,
  };
}

function historySession(overrides: Partial<HistorySession> = {}): HistorySession {
  return {
    projectKey: project.id,
    projectPath: project.path,
    sessionId: 'history-session-1',
    transcriptPath: '/tmp/demo/history-session-1.jsonl',
    title: 'Demo history',
    lastMessage: 'Pick up the prior task',
    updatedAt: '2026-01-01T00:00:00.000Z',
    blocks: [],
    ...overrides,
  };
}

describe('App mobile drilldown', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(checkAuth).mockResolvedValue(true);
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(listHistory).mockResolvedValue([]);
    vi.mocked(listSessions).mockResolvedValue([]);
    vi.mocked(listSlashCommands).mockResolvedValue({ projectId: project.id, commands: [] });
    vi.mocked(loadHistoryTranscript).mockResolvedValue(transcriptWindow());
    vi.mocked(loadSessionTranscript).mockResolvedValue(transcriptWindow());
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

  it('refreshes live sessions for the selected project', async () => {
    const externalSession: ClaudeSession = {
      ...session,
      id: 'external-session-1',
      source: 'external-tmux',
      title: 'webagent-claude',
      externalPaneId: '%0',
    };
    vi.mocked(listSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([externalSession]);
    render(<App />);

    await screen.findByRole('button', { name: /demo/i });
    fireEvent.click(screen.getByRole('button', { name: /demo/i }));
    expect(screen.queryByText('webagent-claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText('webagent-claude')).toBeInTheDocument();
    expect(screen.getByText(/external tmux · %0/i)).toBeInTheDocument();
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

  it('clears stale selected sessions instead of opening an empty mobile chat pane', async () => {
    localStorage.setItem('webagent.selectedProjectId', project.id);
    localStorage.setItem('webagent.selectedSessionId', 'missing-session');
    vi.mocked(listSessions).mockResolvedValue([]);
    const { container } = render(<App />);

    await screen.findByRole('button', { name: /demo/i });
    await waitFor(() => expect(container.querySelector('.native-shell')).toHaveAttribute('data-mobile-pane', 'sessions'));
    expect(localStorage.getItem('webagent.selectedSessionId')).toBeNull();
    expect(screen.queryByText('选择或创建一个会话')).not.toBeInTheDocument();
  });

  it('opens Claude history sessions as read-only JSONL transcript views', async () => {
    vi.mocked(listHistory).mockResolvedValue([
      historySession({
        sessionId: 'history-session',
        transcriptPath: '/tmp/demo/history-session.jsonl',
        title: 'History session',
        lastMessage: 'Latest historical response',
      }),
    ]);
    vi.mocked(loadHistoryTranscript).mockResolvedValue(transcriptWindow({
      sessionId: 'history-session',
      title: 'History session',
      regions: [
        { id: 'history-1', kind: 'user', text: 'Historical prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'history-2', kind: 'assistant', text: 'Historical response', status: 'final', source: 'history', createdAt: '2026-01-01T00:01:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
      ],
    }));
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    fireEvent.click(await screen.findByRole('button', { name: '打开' }));

    await waitFor(() => expect(loadHistoryTranscript).toHaveBeenCalledWith('history-session', { limit: 50 }));
    expect(await screen.findByRole('heading', { name: 'History session', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Historical prompt')).toBeInTheDocument();
    expect(screen.getByText('Historical response')).toBeInTheDocument();
    expect(container.querySelectorAll('.transcript-window .cli-render-surface')).toHaveLength(1);
  });

  it('opens live app sessions with native identity as transcript-capable views', async () => {
    const nativeSession = { ...session, claudeSessionId: 'native-session' };
    vi.mocked(listSessions).mockResolvedValue([nativeSession]);
    vi.mocked(loadSessionTranscript).mockResolvedValue(transcriptWindow({
      sessionId: 'native-session',
      regions: [{ id: 'native-1', kind: 'user', text: 'Native transcript prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    fireEvent.click(await screen.findByText('New session'));

    await waitFor(() => expect(loadSessionTranscript).toHaveBeenCalledWith(nativeSession.id, { limit: 50 }));
    expect(await screen.findByText('Native transcript prompt')).toBeInTheDocument();
  });

  it('prepends older transcript regions when loading more history', async () => {
    vi.mocked(listHistory).mockResolvedValue([
      historySession({
        sessionId: 'history-session',
        transcriptPath: '/tmp/demo/history-session.jsonl',
        title: 'History session',
        lastMessage: 'Latest historical response',
      }),
    ]);
    vi.mocked(loadHistoryTranscript)
      .mockResolvedValueOnce(transcriptWindow({
        sessionId: 'history-session',
        title: 'History session',
        olderCursor: '1',
        hasMoreOlder: true,
        regions: [{ id: 'newer', kind: 'assistant', text: 'Newer response', status: 'final', source: 'history', createdAt: '2026-01-01T00:01:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' }],
      }))
      .mockResolvedValueOnce(transcriptWindow({
        sessionId: 'history-session',
        title: 'History session',
        olderCursor: null,
        hasMoreOlder: false,
        regions: [{ id: 'older', kind: 'user', text: 'Older prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    fireEvent.click(await screen.findByRole('button', { name: '打开' }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更早历史' }));

    await waitFor(() => expect(loadHistoryTranscript).toHaveBeenLastCalledWith('history-session', { limit: 50, before: '1' }));
    expect(await screen.findByText('Older prompt')).toBeInTheDocument();
    expect(screen.getByText('Newer response')).toBeInTheDocument();
  });

  it('loads project-scoped slash commands and resumes history from the chat composer', async () => {
    const history = historySession();
    const resumed = { ...session, id: 'resumed-session', source: 'claude-history' as const, claudeSessionId: history.sessionId, title: history.title };
    vi.mocked(listHistory).mockResolvedValue([history]);
    vi.mocked(listSlashCommands).mockResolvedValue({
      projectId: project.id,
      commands: [{ name: '/resume', title: 'Resume session', description: 'Resume history', scope: 'app', behavior: 'app-owned', support: 'supported', aliases: [] }],
    });
    vi.mocked(createSession).mockResolvedValue(session);
    vi.mocked(resumeSession).mockResolvedValue(resumed);
    vi.mocked(loadSessionTranscript).mockResolvedValue(transcriptWindow({ sessionId: history.sessionId, title: history.title }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /demo/i }));
    await waitFor(() => expect(listSlashCommands).toHaveBeenCalledWith(project.id));
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await screen.findByRole('heading', { name: 'New session' });
    socket.dispatchEvent(new Event('open'));

    const composer = screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...');
    fireEvent.change(composer, { target: { value: '/resume' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: /Demo history/ }));

    await waitFor(() => expect(resumeSession).toHaveBeenCalledWith(project.id, history.sessionId, history.title));
    expect(await screen.findByRole('heading', { name: 'Demo history', level: 2 })).toBeInTheDocument();
  });
});
