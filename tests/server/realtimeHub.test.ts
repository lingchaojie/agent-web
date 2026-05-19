import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { RealtimeHub } from '../../src/server/services/realtimeHub';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';
import { historyProjectId } from '../../src/server/services/projectDiscovery';
import type { Project, SessionStatuslineState } from '../../src/shared/types';

afterEach(() => {
  vi.useRealTimers();
});

describe('RealtimeHub', () => {
  it('sends a snapshot when a client subscribes', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    sessions.appendBlock(session.id, { kind: 'assistant', text: 'hello', status: 'final', source: 'live' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      sessionId: session.id,
      blocks: [expect.objectContaining({ kind: 'assistant', text: 'hello' })],
    });
  });

  it('stores output and broadcasts parsed interaction blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Do you want to allow this?');

    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'interaction', text: 'Do you want to allow this?', interaction: expect.objectContaining({ kind: 'permission' }) }),
    });
    expect(lastMessage(sent, 'session-changed')).toMatchObject({
      type: 'session-changed',
      sessionId: session.id,
      patch: expect.objectContaining({ lifecycle: 'waiting-for-input', activity: 'idle', pendingInteraction: expect.objectContaining({ kind: 'permission' }) }),
    });
  });

  it('strips terminal control sequences before storing and broadcasting transcript blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, '[38;5;246mAll done[39m]0;title');

    expect(sessions.getSnapshot(session.id).blocks.at(-1)?.text).toBe('All done');
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      block: expect.objectContaining({ kind: 'assistant', text: 'All done' }),
    });
  });

  it('broadcasts transient terminal activity without persisting assistant blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, '[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
    expect(lastMessage(sent, 'block-added')).toBeUndefined();
    expect(lastMessage(sent, 'activity-changed')).toMatchObject({
      type: 'activity-changed',
      sessionId: session.id,
      activity: 'working',
    });
  });

  it('does not replay transient terminal frames after reconnect', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());

    hub.handleOutput(session.id, '[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K');
    hub.handleOutput(session.id, 'Meaningful reply');

    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      sessionId: session.id,
      blocks: [expect.objectContaining({ kind: 'assistant', text: 'Meaningful reply' })],
    });
  });

  it('forwards text input to the runner and broadcasts the user block', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.sendInput(session.id, '/help');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '/help');
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'user', text: '/help' }),
    });
  });

  it('continues broadcasting when one sender throws and removes the failed sender', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const throwingSender = vi.fn((message) => {
      if (message.type === 'block-added') throw new Error('client closed');
    });
    const received: unknown[] = [];
    const recordingSender = vi.fn((message) => received.push(message));
    hub.subscribe({ sessionId: session.id }, throwingSender);
    hub.subscribe({ sessionId: session.id }, recordingSender);

    expect(() => hub.handleOutput(session.id, 'hello')).not.toThrow();

    expect(lastMessage(received, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ text: 'hello' }),
    });
    expect((hub as any).clients.get(session.id).has(throwingSender)).toBe(false);
    expect((hub as any).clients.get(session.id).has(recordingSender)).toBe(true);
  });

  it('removes a session from clients when the last sender detaches', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());

    const detach = hub.subscribe({ sessionId: session.id }, vi.fn());
    detach();

    expect((hub as any).clients.has(session.id)).toBe(false);
  });

  it('does not persist user input when delivery to the runner fails', () => {
    const runner = fakeRunner();
    runner.sendInput.mockImplementation(() => {
      throw new Error('PTY not running');
    });
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);

    expect(() => hub.sendInput(session.id, '/help')).toThrow('PTY not running');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
  });

  it('resolves action input server-side before forwarding and broadcasting it', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Choose:\n1. Yes\n2. No');
    hub.sendAction(session.id, 'choice-2');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '2');
    expect(sessions.getSnapshot(session.id).blocks.at(-1)).toMatchObject({ kind: 'user', text: '2' });
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'user', text: '2' }),
    });
  });

  it('rejects unknown action ids without calling the runner', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);

    hub.handleOutput(session.id, 'Choose:\n1. Yes\n2. No');

    expect(() => hub.sendAction(session.id, 'choice-3')).toThrow('Action not found');
    expect(runner.sendInput).not.toHaveBeenCalled();
  });

  it('includes the latest statusline state in session snapshots', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 10 });
    statuslines.render.mockResolvedValue(statusline({ sessionId: session.id, text: 'first status', sequence: 1 }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects(), statuslines });
    const sent: unknown[] = [];

    await hub.refreshStatusline(session.id);
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      statusline: expect.objectContaining({ sessionId: session.id, text: 'first status' }),
    });
  });

  it('refreshes subscribed statuslines on the configured interval', async () => {
    vi.useFakeTimers();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 2 });
    statuslines.render
      .mockResolvedValueOnce(statusline({ sessionId: session.id, text: 'initial', sequence: 1 }))
      .mockResolvedValueOnce(statusline({ sessionId: session.id, text: 'refreshed', sequence: 2 }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects(), statuslines });
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(statuslines.render).toHaveBeenCalledTimes(2);
    expect(lastMessage(sent, 'statusline-changed')).toMatchObject({
      type: 'statusline-changed',
      sessionId: session.id,
      statusline: expect.objectContaining({ text: 'refreshed' }),
    });
    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
  });

  it('shares one statusline refresh loop across multiple clients for the same session', async () => {
    vi.useFakeTimers();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 5 });
    statuslines.render.mockResolvedValue(statusline({ sessionId: session.id, text: 'shared', sequence: 1 }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects(), statuslines });
    const first: unknown[] = [];
    const second: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => first.push(message));
    hub.subscribe({ sessionId: session.id }, (message) => second.push(message));
    await vi.runOnlyPendingTimersAsync();

    expect(statuslines.render).toHaveBeenCalledTimes(1);
    expect(lastMessage(first, 'statusline-changed')).toMatchObject({ statusline: expect.objectContaining({ text: 'shared' }) });
    expect(lastMessage(second, 'statusline-changed')).toMatchObject({ statusline: expect.objectContaining({ text: 'shared' }) });
  });

  it('keeps statusline updates isolated by session', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const firstSession = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'One' });
    const secondSession = sessions.createSession({ projectId: 'project-2', source: 'web-created', claudeSessionId: null, title: 'Two' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 10 });
    statuslines.render.mockImplementation(async ({ session, sequence }) => statusline({ sessionId: session.id, text: `${session.title} status`, sequence }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects(), statuslines });
    const first: unknown[] = [];
    const second: unknown[] = [];
    hub.subscribe({ sessionId: firstSession.id }, (message) => first.push(message));
    hub.subscribe({ sessionId: secondSession.id }, (message) => second.push(message));

    await hub.refreshStatusline(firstSession.id);
    await hub.refreshStatusline(secondSession.id);

    expect(lastMessage(first, 'statusline-changed')).toMatchObject({ sessionId: firstSession.id, statusline: expect.objectContaining({ text: 'One status' }) });
    expect(lastMessage(second, 'statusline-changed')).toMatchObject({ sessionId: secondSession.id, statusline: expect.objectContaining({ text: 'Two status' }) });
  });

  it('resolves discovered history project ids when refreshing statuslines', async () => {
    const projectPath = process.cwd();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: historyProjectId(projectPath), source: 'web-created', claudeSessionId: null, title: 'History project session' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 10 });
    statuslines.render.mockResolvedValue(statusline({ sessionId: session.id, text: 'history status', sequence: 1 }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects([]), statuslines });
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    await hub.refreshStatusline(session.id);

    expect(statuslines.render).toHaveBeenCalledWith(expect.objectContaining({
      project: expect.objectContaining({ id: historyProjectId(projectPath), path: projectPath, source: 'history' }),
    }));
    expect(lastMessage(sent, 'statusline-changed')).toMatchObject({ statusline: expect.objectContaining({ text: 'history status' }) });
  });

  it('stops the statusline refresh loop after the last client detaches', async () => {
    vi.useFakeTimers();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 1 });
    statuslines.render.mockResolvedValue(statusline({ sessionId: session.id, text: 'status', sequence: 1 }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects(), statuslines });

    const detach = hub.subscribe({ sessionId: session.id }, vi.fn());
    detach();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(statuslines.render).not.toHaveBeenCalled();
    expect((hub as any).statuslineTimers.has(session.id)).toBe(false);
  });

  it('assigns statusline sequences after async rendering so concurrent events are not overwritten', async () => {
    let resolveStatusline: (state: SessionStatuslineState) => void = () => undefined;
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const statuslines = fakeStatuslines({ refreshIntervalSeconds: 10 });
    statuslines.render.mockReturnValue(new Promise((resolve) => { resolveStatusline = resolve; }));
    const hub = new RealtimeHub(sessions, fakeRunner(), { projects: fakeProjects(), statuslines });

    const refresh = hub.refreshStatusline(session.id);
    hub.handleOutput(session.id, 'concurrent assistant message');
    resolveStatusline(statusline({ sessionId: session.id, text: 'late statusline', sequence: 1 }));
    await refresh;

    const replayed = sessions.getEventsAfter(session.id, 0);
    const statuslineEvent = replayed.find((event) => event.type === 'statusline-changed');
    if (!statuslineEvent || statuslineEvent.type !== 'statusline-changed') throw new Error('Missing statusline event');
    expect(replayed.map((event) => event.type)).toContain('block-added');
    expect(statuslineEvent).toMatchObject({
      type: 'statusline-changed',
      statusline: expect.objectContaining({ text: 'late statusline' }),
    });
    const replayedSequences = replayed.flatMap((event) => ('sequence' in event && typeof event.sequence === 'number' ? [event.sequence] : []));
    const otherSequences = replayed.flatMap((event) => (event.type !== 'statusline-changed' && 'sequence' in event && typeof event.sequence === 'number' ? [event.sequence] : []));
    expect(new Set(replayedSequences)).toHaveProperty('size', replayedSequences.length);
    expect(statuslineEvent.sequence).toBe(statuslineEvent.statusline.sequence);
    expect(statuslineEvent.sequence).toBeGreaterThan(Math.max(...otherSequences));
  });

  it('stores tmux capture output with tmux transcript source', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: 'tmux:socket:%1', title: 'tmux', cwd: '/tmp/demo', paneId: '%1' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleTmuxCapture(session.id, 'hello from tmux');

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      session: expect.objectContaining({ transcriptSource: 'tmux-capture' }),
    });
    expect(sessions.getSnapshot(session.id).session.transcriptSource).toBe('tmux-capture');
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ source: 'tmux-capture', text: 'hello from tmux' }),
    });
  });

  it('broadcasts external tmux disconnects to subscribed clients', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: 'tmux:socket:%1', title: 'tmux', cwd: '/tmp/demo', paneId: '%1' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    const disconnected = hub.disconnectExternalSession(session.id);

    expect(disconnected.status).toBe('stopped');
    expect(lastMessage(sent, 'session-changed')).toMatchObject({
      type: 'session-changed',
      sessionId: session.id,
      patch: expect.objectContaining({ lifecycle: 'disconnected', activity: 'stopped', transcriptSource: 'tmux-capture' }),
    });
  });

  it('records external tmux input with tmux source and working activity', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: 'tmux:socket:%1', title: 'tmux', cwd: '/tmp/demo', paneId: '%1' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.sendExternalInput(session.id, 'hello');

    expect(runner.sendInput).not.toHaveBeenCalled();
    expect(sessions.getSnapshot(session.id).blocks.at(-1)).toMatchObject({ kind: 'user', text: 'hello', source: 'tmux-capture' });
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'user', text: 'hello', source: 'tmux-capture' }),
    });
    expect(lastMessage(sent, 'activity-changed')).toMatchObject({
      type: 'activity-changed',
      sessionId: session.id,
      activity: 'working',
    });
  });

  it('resolves action input from latest actions and rejects unknown action ids', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: 'tmux:socket:%1', title: 'tmux', cwd: '/tmp/demo', paneId: '%1' });
    const hub = new RealtimeHub(sessions, fakeRunner());

    hub.handleTmuxCapture(session.id, 'Choose:\n1. Yes\n2. No');

    expect(hub.resolveActionInput(session.id, 'choice-2')).toBe('2');
    expect(() => hub.resolveActionInput(session.id, 'choice-3')).toThrow('Action not found');
  });
});

function lastMessage(messages: unknown[], type: string) {
  return [...messages].reverse().find((message): message is { type: string } => typeof message === 'object' && message !== null && 'type' in message && message.type === type);
}

function fakeRunner() {
  return {
    sendInput: vi.fn(),
  };
}

function fakeProjects(projects: Project[] = []) {
  const defaults = [project({ id: 'project-1', name: 'One', path: '/tmp/project-one' }), project({ id: 'project-2', name: 'Two', path: '/tmp/project-two' })];
  const all = projects.length ? projects : defaults;
  return {
    getProject: vi.fn((id: string) => all.find((item) => item.id === id) ?? null),
  };
}

function fakeStatuslines(settings: { refreshIntervalSeconds: number }) {
  return {
    settings: vi.fn(() => ({ command: 'node statusline.js', padding: 0, refreshIntervalSeconds: settings.refreshIntervalSeconds })),
    render: vi.fn(),
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project',
    path: '/tmp/project',
    favorite: false,
    available: true,
    source: 'whitelist',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function statusline(overrides: Partial<SessionStatuslineState> = {}): SessionStatuslineState {
  return {
    sessionId: 'session-1',
    status: 'ready',
    text: 'status',
    updatedAt: '2026-05-19T10:00:00.000Z',
    sequence: 1,
    ...overrides,
  };
}
