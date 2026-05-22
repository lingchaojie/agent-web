/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectList from '../../src/client/components/ProjectList';
import type { ClaudeSession, Project } from '../../src/shared/types';

describe('ProjectList', () => {
  it('groups active Claude clients separately from scanned .claude workspaces', () => {
    render(
      <ProjectList
        projects={[
          project({ id: 'active-1', name: 'webagent', source: 'active-client' }),
          project({ id: 'history-1', name: 'old-project', source: 'history', path: '/tmp/old-project' }),
          project({ id: 'config-1', name: 'trusted-project', source: 'claude-config', path: '/tmp/trusted-project' }),
        ]}
        selectedProjectId={null}
        onSelect={vi.fn()}
      />,
    );

    const activeGroup = screen.getByRole('group', { name: '当前打开的 Claude Code 客户端' });
    const historyGroup = screen.getByRole('group', { name: '扫描 .claude 的工作区' });

    expect(within(activeGroup).getByText('webagent')).toBeInTheDocument();
    expect(within(activeGroup).getByText(/当前客户端/)).toBeInTheDocument();
    expect(within(historyGroup).getByText('old-project')).toBeInTheDocument();
    expect(within(historyGroup).getByText(/历史扫描/)).toBeInTheDocument();
    expect(within(historyGroup).getByText('trusted-project')).toBeInTheDocument();
    expect(within(historyGroup).getByText(/Claude 项目/)).toBeInTheDocument();
  });

  it('keeps selecting projects after grouping', () => {
    const onSelect = vi.fn();
    const active = project({ id: 'active-1', name: 'webagent', source: 'active-client' });

    render(<ProjectList projects={[active]} selectedProjectId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /webagent/ }));

    expect(onSelect).toHaveBeenCalledWith(active);
  });

  it('shows kept running sessions above project groups and opens them', () => {
    const onOpenSession = vi.fn();
    const keptSession = session({ id: 'session-1', title: 'Kept terminal' });

    render(
      <ProjectList
        projects={[project({ id: 'project-1', name: 'demo' })]}
        selectedProjectId={null}
        runningSessions={[keptSession]}
        selectedSessionId="session-1"
        onSelect={vi.fn()}
        onOpenSession={onOpenSession}
        onStopSession={vi.fn()}
      />,
    );

    const sessionGroup = screen.getByRole('group', { name: '当前保持的会话' });
    expect(within(sessionGroup).getByText('Kept terminal')).toBeInTheDocument();
    expect(within(sessionGroup).getByText(/running/i)).toBeInTheDocument();

    fireEvent.click(within(sessionGroup).getByRole('button', { name: /^Kept terminal/i }));

    expect(onOpenSession).toHaveBeenCalledWith(keptSession);
  });

  it('closes kept running sessions without opening them', () => {
    const onOpenSession = vi.fn();
    const onStopSession = vi.fn();
    const keptSession = session({ id: 'session-1', title: 'Kept terminal' });

    render(
      <ProjectList
        projects={[project({ id: 'project-1', name: 'demo' })]}
        selectedProjectId={null}
        runningSessions={[keptSession]}
        onSelect={vi.fn()}
        onOpenSession={onOpenSession}
        onStopSession={onStopSession}
      />,
    );

    const sessionGroup = screen.getByRole('group', { name: '当前保持的会话' });
    fireEvent.click(within(sessionGroup).getByRole('button', { name: '关闭 Kept terminal' }));

    expect(onStopSession).toHaveBeenCalledWith(keptSession);
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'demo',
    path: '/tmp/demo',
    favorite: false,
    available: true,
    source: 'history',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    source: 'web-created',
    claudeSessionId: null,
    title: 'Running session',
    status: 'running',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
