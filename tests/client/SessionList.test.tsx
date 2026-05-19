/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HistorySession, Project } from '../../src/shared/types';
import SessionList from '../../src/client/components/SessionList';

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

describe('SessionList', () => {
  it('shows a stop action for running sessions', () => {
    const onStop = vi.fn();
    const session = {
      id: 'session-1',
      projectId: project.id,
      source: 'web-created' as const,
      claudeSessionId: null,
      title: 'Running session',
      status: 'running' as const,
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <SessionList
        project={project}
        sessions={[session]}
        history={[]}
        loading={false}
        selectedSessionId={null}
        onNew={vi.fn()}
        onContinue={vi.fn()}
        onResume={vi.fn()}
        onOpen={vi.fn()}
        onStop={onStop}
        onBackToProjects={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /关闭 Running session/i }));

    expect(onStop).toHaveBeenCalledWith(session);
  });

  it('shows the first 20 history sessions by default and loads 20 more', () => {
    const history = Array.from({ length: 25 }, (_, index) => historySession(index + 1));

    render(
      <SessionList
        project={project}
        sessions={[]}
        history={history}
        loading={false}
        selectedSessionId={null}
        onNew={vi.fn()}
        onContinue={vi.fn()}
        onResume={vi.fn()}
        onOpen={vi.fn()}
        onStop={vi.fn()}
        onBackToProjects={vi.fn()}
      />,
    );

    expect(screen.getByText('History 20')).toBeInTheDocument();
    expect(screen.queryByText('History 21')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /加载 5 条更多/i }));

    expect(screen.getByText('History 21')).toBeInTheDocument();
    expect(screen.getByText('History 25')).toBeInTheDocument();
  });
});

function historySession(index: number): HistorySession {
  return {
    projectKey: '-tmp-demo',
    projectPath: '/tmp/demo',
    sessionId: `session-${index}`,
    transcriptPath: `/tmp/demo/session-${index}.jsonl`,
    title: `History ${index}`,
    lastMessage: `Last message ${index}`,
    updatedAt: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`,
    blocks: [],
  };
}
