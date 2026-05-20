/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectList from '../../src/client/components/ProjectList';
import type { Project } from '../../src/shared/types';

describe('ProjectList', () => {
  it('groups active Claude clients separately from scanned .claude workspaces', () => {
    render(
      <ProjectList
        projects={[
          project({ id: 'active-1', name: 'webagent', source: 'active-client' }),
          project({ id: 'history-1', name: 'old-project', source: 'history', path: '/tmp/old-project' }),
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
  });

  it('keeps selecting projects after grouping', () => {
    const onSelect = vi.fn();
    const active = project({ id: 'active-1', name: 'webagent', source: 'active-client' });

    render(<ProjectList projects={[active]} selectedProjectId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /webagent/ }));

    expect(onSelect).toHaveBeenCalledWith(active);
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
