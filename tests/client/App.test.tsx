/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import type { ClaudeSession, HistorySession, Project, TranscriptWindow } from '../../src/shared/types';

vi.mock('../../src/client/api', () => ({
  checkAuth: vi.fn(),
  continueSession: vi.fn(),
  createSession: vi.fn(),
  listHistory: vi.fn(),
  listProjects: vi.fn(),
  listSessions: vi.fn(),
  loadHistoryTranscript: vi.fn(),
  resumeSession: vi.fn(),
  stopSession: vi.fn(),
}));

const terminalMockState = vi.hoisted(() => ({
  nextInstanceId: 0,
  unmounts: [] as string[],
}));

vi.mock('../../src/client/components/TerminalView', async () => {
  const React = await import('react');
  return {
    default: ({ sessionId, title, onBack }: { sessionId: string; title: string; onBack(): void }) => {
      const instanceId = React.useRef(`${sessionId}-${++terminalMockState.nextInstanceId}`).current;
      React.useEffect(() => () => {
        terminalMockState.unmounts.push(instanceId);
      }, [instanceId]);
      return (
        <section aria-label="Claude Code terminal" data-instance-id={instanceId}>
          <h3>{title}</h3>
          <p>terminal session: {sessionId}</p>
          <button type="button" onClick={onBack}>返回会话</button>
        </section>
      );
    },
  };
});

import {
  checkAuth,
  createSession,
  listHistory,
  listProjects,
  listSessions,
  loadHistoryTranscript,
  resumeSession,
  stopSession,
} from '../../src/client/api';

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

describe('App terminal-first session flow', () => {
  beforeEach(() => {
    localStorage.clear();
    terminalMockState.nextInstanceId = 0;
    terminalMockState.unmounts = [];
    vi.mocked(checkAuth).mockResolvedValue(true);
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(listHistory).mockResolvedValue([]);
    vi.mocked(listSessions).mockResolvedValue([]);
    vi.mocked(loadHistoryTranscript).mockResolvedValue(transcriptWindow());
    vi.mocked(createSession).mockResolvedValue(session);
    vi.mocked(resumeSession).mockResolvedValue({ ...session, id: 'resumed-session', source: 'claude-history', claudeSessionId: 'history-session-1', title: 'Demo history' });
    vi.mocked(stopSession).mockResolvedValue({ ...session, status: 'stopped' });
  });

  it('renders the responsive shell and opens new sessions directly in terminal view', async () => {
    const { container } = render(<App />);

    await screen.findByText('项目');
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    await screen.findByRole('button', { name: /demo/i });
    const shell = container.querySelector('.native-shell');
    expect(shell).toHaveAttribute('data-native-shell', 'app');
    expect(shell).toHaveAttribute('data-mobile-pane', 'projects');

    fireEvent.click(screen.getByRole('button', { name: /demo/i }));
    expect(shell).toHaveAttribute('data-mobile-pane', 'sessions');

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(project.id));
    await waitFor(() => expect(shell).toHaveAttribute('data-mobile-pane', 'chat'));
    expect(await screen.findByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(screen.getByText(`terminal session: ${session.id}`)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入要发送给 Claude Code 的内容...')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开终端模式' })).not.toBeInTheDocument();
  });

  it('opens running sessions directly in terminal view and can return to sessions', async () => {
    vi.mocked(listSessions).mockResolvedValue([session]);
    const { container } = render(<App />);

    await clickProject();
    fireEvent.click(await screen.findByText('New session'));

    expect(await screen.findByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回会话' }));
    expect(container.querySelector('.native-shell')).toHaveAttribute('data-mobile-pane', 'sessions');
  });

  it('keeps a running terminal mounted while navigating away and back', async () => {
    vi.mocked(listSessions).mockResolvedValue([session]);
    vi.mocked(listHistory).mockResolvedValue([historySession()]);
    vi.mocked(loadHistoryTranscript).mockResolvedValue(transcriptWindow({
      title: 'Demo history',
      regions: [{ id: 'history-1', kind: 'user', text: 'Historical prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    }));
    const { container } = render(<App />);

    await clickProject();
    fireEvent.click(await liveSessionButton());
    const terminal = await screen.findByRole('region', { name: 'Claude Code terminal' });
    const instanceId = terminal.getAttribute('data-instance-id');

    fireEvent.click(screen.getByRole('button', { name: '返回会话' }));
    fireEvent.click(screen.getByRole('button', { name: '← 项目' }));
    await clickProject();
    fireEvent.click(await liveSessionButton());
    expect(screen.getByRole('region', { name: 'Claude Code terminal' })).toHaveAttribute('data-instance-id', instanceId);

    fireEvent.click(screen.getByRole('button', { name: '返回会话' }));
    fireEvent.click(await screen.findByRole('button', { name: /Demo history Pick up the prior task/i }));
    expect(await screen.findByText('Historical prompt')).toBeInTheDocument();
    fireEvent.click(await liveSessionButton());

    expect(container.querySelector('.native-shell')).toHaveAttribute('data-mobile-pane', 'chat');
    expect(screen.getByRole('region', { name: 'Claude Code terminal' })).toHaveAttribute('data-instance-id', instanceId);
    expect(terminalMockState.unmounts).toEqual([]);
  });

  it('restores the selected running session into terminal view after refresh', async () => {
    localStorage.setItem('webagent.selectedProjectId', project.id);
    localStorage.setItem('webagent.selectedSessionId', session.id);
    vi.mocked(listSessions).mockResolvedValue([session]);
    const { container } = render(<App />);

    expect(await screen.findByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(screen.getByText(`terminal session: ${session.id}`)).toBeInTheDocument();
    expect(container.querySelector('.native-shell')).toHaveAttribute('data-mobile-pane', 'chat');
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
    expect(screen.queryByText(/external tmux/i)).not.toBeInTheDocument();
  });

  it('clears stale selected sessions instead of opening an empty mobile chat pane', async () => {
    localStorage.setItem('webagent.selectedProjectId', project.id);
    localStorage.setItem('webagent.selectedSessionId', 'missing-session');
    vi.mocked(listSessions).mockResolvedValue([]);
    const { container } = render(<App />);

    await screen.findByRole('button', { name: /demo/i });
    await waitFor(() => expect(container.querySelector('.native-shell')).toHaveAttribute('data-mobile-pane', 'sessions'));
    expect(localStorage.getItem('webagent.selectedSessionId')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Claude Code terminal' })).not.toBeInTheDocument();
  });

  it('clicks a history entry body to view the read-only transcript', async () => {
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
    render(<App />);

    await clickProject();
    fireEvent.click(await screen.findByRole('button', { name: /History session Latest historical response/i }));

    await waitFor(() => expect(loadHistoryTranscript).toHaveBeenCalledWith('history-session', { limit: 50 }));
    expect(await screen.findByRole('heading', { name: 'History session', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Historical prompt')).toBeInTheDocument();
    expect(screen.getByText('Historical response')).toBeInTheDocument();
  });

  it('clicks a history open button to resume into terminal view', async () => {
    const history = historySession();
    const resumed = { ...session, id: 'resumed-session', source: 'claude-history' as const, claudeSessionId: history.sessionId, title: history.title };
    vi.mocked(listHistory).mockResolvedValue([history]);
    vi.mocked(resumeSession).mockResolvedValue(resumed);
    render(<App />);

    await clickProject();
    fireEvent.click(await screen.findByRole('button', { name: '打开' }));

    await waitFor(() => expect(resumeSession).toHaveBeenCalledWith(project.id, history.sessionId, history.title));
    expect(await screen.findByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(screen.getByText('terminal session: resumed-session')).toBeInTheDocument();
    expect(loadHistoryTranscript).not.toHaveBeenCalled();
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

    await clickProject();
    fireEvent.click(await screen.findByRole('button', { name: /History session Latest historical response/i }));
    fireEvent.click(await screen.findByRole('button', { name: '加载更早历史' }));

    await waitFor(() => expect(loadHistoryTranscript).toHaveBeenLastCalledWith('history-session', { limit: 50, before: '1' }));
    expect(await screen.findByText('Older prompt')).toBeInTheDocument();
    expect(screen.getByText('Newer response')).toBeInTheDocument();
  });
});

async function clickProject() {
  const workspace = await screen.findByRole('complementary', { name: '工作区' });
  fireEvent.click(await within(workspace).findByRole('button', { name: /demo/i }));
}

async function liveSessionButton() {
  const sessionRail = await screen.findByRole('complementary', { name: '会话' });
  const buttons = await within(sessionRail).findAllByRole('button', { name: /New session/i });
  return buttons.find((button) => button.className.includes('session-open-button')) ?? buttons[0];
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
