/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listSlashCommands, setToken } from '../../src/client/api';

describe('client API helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fetches project-scoped slash commands with auth headers', async () => {
    setToken('test-token');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ projectId: 'project-1', commands: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const catalog = await listSlashCommands('project/1');

    expect(catalog).toEqual({ projectId: 'project-1', commands: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project%2F1/slash-commands', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });
});
