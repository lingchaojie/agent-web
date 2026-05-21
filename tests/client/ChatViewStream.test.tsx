/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from '../../src/client/components/ChatView';
import type { ClaudeSession, TranscriptWindow } from '../../src/shared/types';

vi.mock('../../src/client/components/TerminalView', () => ({
  default: ({ sessionId, title, onBack }: { sessionId: string; title: string; onBack(): void }) => (
    <section aria-label="Claude Code terminal">
      <h3>{title}</h3>
      <p>terminal session: {sessionId}</p>
      <button type="button" onClick={onBack}>返回会话</button>
    </section>
  ),
}));

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

describe('ChatView terminal-first rendering', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
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

  it('renders a running live session directly as a terminal', () => {
    render(<ChatView session={session} onBackToSessions={vi.fn()} onStop={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
    expect(screen.getByText(`terminal session: ${session.id}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终端模式' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '对话模式' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开终端模式' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入要发送给 Claude Code 的内容...')).not.toBeInTheDocument();
    expect(screen.queryByText('PTY fallback')).not.toBeInTheDocument();
  });

  it('uses the terminal back action to return to the session list', () => {
    const onBackToSessions = vi.fn();
    render(<ChatView session={session} onBackToSessions={onBackToSessions} onStop={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '返回会话' }));

    expect(onBackToSessions).toHaveBeenCalledTimes(1);
  });

  it('renders read-only history transcripts without terminal controls', () => {
    render(
      <ChatView
        session={{ id: 'history:history-session-1', title: 'Demo history', status: 'stopped', historySessionId: 'history-session-1' }}
        transcript={transcriptWindow({
          regions: [
            { id: 'history-1', kind: 'user', text: 'Historical prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'history-2', kind: 'assistant', text: 'Historical response', status: 'final', source: 'history', createdAt: '2026-01-01T00:01:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
            { id: 'history-3', kind: 'tool', text: 'Tool details', status: 'final', source: 'history', createdAt: '2026-01-01T00:02:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z' },
          ],
        })}
        onBackToSessions={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Demo history', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Historical prompt')).toBeInTheDocument();
    expect(screen.getByText('Historical response')).toBeInTheDocument();
    expect(screen.getByLabelText('Read-only terminal history')).toBeInTheDocument();
    expect(screen.getByText('$ user')).toBeInTheDocument();
    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('[tool]')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
    expect(screen.queryByText('structured')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Claude Code terminal' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入要发送给 Claude Code 的内容...')).not.toBeInTheDocument();
  });

  it('shows a stopped live session as unavailable instead of falling back to chat mode', () => {
    render(<ChatView session={{ ...session, status: 'stopped' }} onBackToSessions={vi.fn()} onStop={vi.fn()} />);

    expect(screen.getByText('会话未运行')).toBeInTheDocument();
    expect(screen.getByText('这个会话已经停止。请从会话列表新建或恢复一个终端会话。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Claude Code terminal' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入要发送给 Claude Code 的内容...')).not.toBeInTheDocument();
  });
});

function transcriptWindow(overrides: Partial<TranscriptWindow> = {}): TranscriptWindow {
  return {
    sessionId: 'history-session-1',
    projectKey: 'project-1',
    projectPath: '/tmp/demo',
    title: 'Demo history',
    updatedAt: '2026-01-01T00:00:00.000Z',
    regions: [
      { id: 'history-1', kind: 'user', text: 'Historical prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    olderCursor: null,
    hasMoreOlder: false,
    ...overrides,
  };
}
