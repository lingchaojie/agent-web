import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';
import { TmuxSessionSync } from '../../src/server/services/tmuxSessionSync';
import { tmuxExternalKey, type TmuxPane } from '../../src/server/services/tmuxPaneDiscovery';

const pane: TmuxPane = {
  paneId: '%12',
  sessionName: 'main',
  windowName: 'webagent-claude',
  paneTitle: 'claude',
  cwd: '/tmp/demo',
  exposedFlag: '1',
  socketPath: '/tmp/tmux-1000/default',
};

describe('TmuxSessionSync', () => {
  it('creates external sessions for exposed panes and publishes capture deltas', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const handleTmuxCapture = vi.fn();
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture },
      listPanes: vi.fn(async () => [pane]),
      capture: vi.fn(async () => 'first screen'),
      resolveProjectId: (cwd) => cwd === '/tmp/demo' ? 'project-1' : null,
      titleForPane: () => 'Claude tmux',
    });

    await sync.refresh();

    const listed = sessions.listRunningSessions('project-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ source: 'external-tmux', title: 'Claude tmux', status: 'running', externalKey: tmuxExternalKey(pane) });
    expect(handleTmuxCapture).toHaveBeenCalledWith(listed[0].id, 'first screen');
  });

  it('publishes only capture deltas after the first refresh', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const handleTmuxCapture = vi.fn();
    const capture = vi.fn()
      .mockResolvedValueOnce('first screen')
      .mockResolvedValueOnce('first screen\nnew line');
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture },
      listPanes: vi.fn(async () => [pane]),
      capture,
      resolveProjectId: () => 'project-1',
      titleForPane: () => 'Claude tmux',
    });

    await sync.refresh();
    await sync.refresh();

    const session = sessions.listRunningSessions('project-1')[0];
    expect(handleTmuxCapture).toHaveBeenNthCalledWith(1, session.id, 'first screen');
    expect(handleTmuxCapture).toHaveBeenNthCalledWith(2, session.id, 'new line');
  });

  it('marks missing external sessions disconnected', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: tmuxExternalKey(pane), title: 'Claude tmux', cwd: '/tmp/demo', paneId: '%12' });
    const disconnectExternalSession = vi.fn((sessionId: string) => sessions.markExternalDisconnected(sessionId));
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn(), disconnectExternalSession },
      listPanes: vi.fn(async () => []),
      capture: vi.fn(),
      resolveProjectId: () => null,
      titleForPane: () => 'unused',
    });

    await sync.refresh();

    expect(disconnectExternalSession).toHaveBeenCalledWith(session.id);
    expect(sessions.getSession(session.id)?.status).toBe('stopped');
    expect(sessions.getSnapshot(session.id).session.lifecycle).toBe('disconnected');
  });

  it('continues reconciling when one pane capture fails', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const stalePane = { ...pane, paneId: '%99' };
    const staleSession = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: tmuxExternalKey(stalePane), title: 'stale', cwd: '/tmp/demo', paneId: '%99' });
    const handleTmuxCapture = vi.fn();
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture, disconnectExternalSession: (sessionId) => sessions.markExternalDisconnected(sessionId) },
      listPanes: vi.fn(async () => [pane]),
      capture: vi.fn(async () => {
        throw new Error('pane disappeared');
      }),
      resolveProjectId: () => 'project-1',
      titleForPane: () => 'Claude tmux',
    });

    await expect(sync.refresh()).resolves.toBeUndefined();

    expect(handleTmuxCapture).not.toHaveBeenCalled();
    expect(sessions.getSession(staleSession.id)?.status).toBe('stopped');
  });

  it('serializes overlapping refresh calls', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const handleTmuxCapture = vi.fn();
    let captureStarted!: () => void;
    const started = new Promise<void>((resolve) => { captureStarted = resolve; });
    let releaseCapture = (): void => undefined;
    const capture = vi.fn(async () => {
      captureStarted();
      await new Promise<void>((release) => { releaseCapture = release; });
      return 'first screen';
    });
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture },
      listPanes: vi.fn(async () => [pane]),
      capture,
      resolveProjectId: () => 'project-1',
      titleForPane: () => 'Claude tmux',
    });

    const firstRefresh = sync.refresh();
    await started;
    const secondRefresh = sync.refresh();
    expect(capture).toHaveBeenCalledTimes(1);
    releaseCapture();
    await Promise.all([firstRefresh, secondRefresh]);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('sends input only when the external pane is still exposed', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const sendInput = vi.fn(async () => undefined);
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn() },
      listPanes: vi.fn(async () => [pane]),
      capture: vi.fn(async () => ''),
      sendInput,
      resolveProjectId: (cwd) => cwd === '/tmp/demo' ? 'project-1' : null,
      titleForPane: () => 'Claude tmux',
    });
    await sync.refresh();
    const session = sessions.listRunningSessions('project-1')[0];

    await sync.sendInput(session.id, 'hello');

    expect(sendInput).toHaveBeenCalledWith(pane, 'hello');
  });

  it('rejects input when the exposed pane is no longer discoverable', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const listPanes = vi.fn(async () => [pane]);
    const disconnectExternalSession = vi.fn((sessionId: string) => sessions.markExternalDisconnected(sessionId));
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn(), disconnectExternalSession },
      listPanes,
      capture: vi.fn(async () => ''),
      sendInput: vi.fn(),
      resolveProjectId: (cwd) => cwd === '/tmp/demo' ? 'project-1' : null,
      titleForPane: () => 'Claude tmux',
    });
    await sync.refresh();
    const session = sessions.listRunningSessions('project-1')[0];
    listPanes.mockResolvedValue([]);

    await expect(sync.sendInput(session.id, 'hello')).rejects.toThrow('External tmux pane is not available');

    expect(disconnectExternalSession).toHaveBeenCalledWith(session.id);
    expect(sessions.getSession(session.id)?.status).toBe('stopped');
    expect(sessions.getSnapshot(session.id).session.lifecycle).toBe('disconnected');
  });

  it('rejects input when the exposed pane now resolves to a different project', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    let resolvedProjectId = 'project-1';
    const sendInput = vi.fn(async () => undefined);
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn() },
      listPanes: vi.fn(async () => [pane]),
      capture: vi.fn(async () => ''),
      sendInput,
      resolveProjectId: () => resolvedProjectId,
      titleForPane: () => 'Claude tmux',
    });
    await sync.refresh();
    const session = sessions.listRunningSessions('project-1')[0];
    resolvedProjectId = 'project-2';

    await expect(sync.sendInput(session.id, 'hello')).rejects.toThrow('External tmux pane is not available');

    expect(sendInput).not.toHaveBeenCalled();
    expect(sessions.getSession(session.id)?.status).toBe('stopped');
    expect(sessions.getSnapshot(session.id).session.lifecycle).toBe('disconnected');
  });
});
