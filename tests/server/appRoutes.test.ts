import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type RouteContext } from '../../src/server/app';
import type { ClaudeSession, Project, WsServerMessage } from '../../src/shared/types';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-routes-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('backend routes', () => {
  it('requires bearer auth for API routes and allows auth checks with the right token', async () => {
    const context = fakeContext();
    const app = await createApp(context);

    const unauthorized = await app.inject({ method: 'GET', url: '/api/projects' });
    const authorizedCheck = await app.inject({ method: 'GET', url: '/api/auth/check', headers: authHeaders() });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: 'Unauthorized' });
    expect(authorizedCheck.statusCode).toBe(200);
    expect(authorizedCheck.json()).toEqual({ ok: true });

    await app.close();
  });

  it('requires bearer auth for encoded API routes', async () => {
    const project = fakeProject({ id: 'project-1', path: root });
    const context = fakeContext();
    context.projects.listProjects = vi.fn(() => [project]);
    const app = await createApp(context);

    const encodedApi = await app.inject({ method: 'GET', url: '/%61pi/projects' });
    const encodedSlashApi = await app.inject({ method: 'GET', url: '/%61pi%2Fprojects' });

    expect(encodedApi.statusCode).toBe(401);
    expect(encodedApi.json()).toEqual({ error: 'Unauthorized' });
    expect(encodedSlashApi.statusCode).toBe(401);
    expect(encodedSlashApi.json()).toEqual({ error: 'Unauthorized' });
    expect(context.projects.listProjects).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns JSON 404s for API paths without a frontend build', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const context = fakeContext();
    const app = await createApp(context);

    const rootApi = await app.inject({ method: 'GET', url: '/api', headers: authHeaders() });
    const nestedApi = await app.inject({ method: 'GET', url: '/api/missing', headers: authHeaders() });
    const queryApi = await app.inject({ method: 'GET', url: '/api?x=1', headers: authHeaders() });
    const encodedSlashApi = await app.inject({ method: 'GET', url: '/api%2Fmissing', headers: authHeaders() });

    expect(rootApi.statusCode).toBe(404);
    expect(rootApi.json()).toEqual({ error: 'Not found' });
    expect(nestedApi.statusCode).toBe(404);
    expect(nestedApi.json()).toEqual({ error: 'Not found' });
    expect(queryApi.statusCode).toBe(404);
    expect(queryApi.json()).toEqual({ error: 'Not found' });
    expect(encodedSlashApi.statusCode).toBe(404);
    expect(encodedSlashApi.json()).toEqual({ error: 'Not found' });

    await app.close();
    cwd.mockRestore();
  });

  it('lists and adds projects through the project registry', async () => {
    const project = fakeProject({ id: 'project-1', path: root, favorite: true });
    const context = fakeContext();
    context.projects.listProjects = vi.fn(() => [project]);
    context.projects.addProject = vi.fn(() => project);
    const app = await createApp(context);

    const listed = await app.inject({ method: 'GET', url: '/api/projects', headers: authHeaders() });
    const added = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeaders(),
      payload: { name: 'Demo', path: root, favorite: true },
    });

    expect(listed.json()).toEqual([project]);
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual(project);
    expect(context.projects.addProject).toHaveBeenCalledWith({ name: 'Demo', path: root, favorite: true });

    await app.close();
  });

  it('starts new sessions in available projects', async () => {
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const session = fakeSession({ id: 'session-1', projectId: project.id, title: 'New session' });
    const context = fakeContext();
    context.projects.getProject = vi.fn(() => project);
    context.sessions.createSession = vi.fn(() => session);
    context.sessions.getSession = vi.fn(() => ({ ...session, status: 'running' as const }));
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(),
      payload: { projectId: project.id, mode: 'new' },
    });

    expect(response.statusCode).toBe(200);
    expect(context.sessions.createSession).toHaveBeenCalledWith({
      projectId: project.id,
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });
    expect(context.runner.start).toHaveBeenCalledWith({ sessionId: session.id, cwd: project.path, mode: 'new' });
    expect(context.runner.onData).toHaveBeenCalledWith(session.id, expect.any(Function));
    expect(context.runner.onExit).toHaveBeenCalledWith(session.id, expect.any(Function));
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'running');

    await app.close();
  });

  it('marks new sessions failed when runner startup fails', async () => {
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const session = fakeSession({ id: 'session-1', projectId: project.id, title: 'New session' });
    const context = fakeContext();
    context.projects.getProject = vi.fn(() => project);
    context.sessions.createSession = vi.fn(() => session);
    context.runner.start = vi.fn(() => {
      throw new Error('runner exploded');
    });
    context.sessions.listSessions = vi.fn(() => [{ ...session, status: 'failed' as const }]);
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(),
      payload: { projectId: project.id, mode: 'new' },
    });
    const listed = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sessions`, headers: authHeaders() });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'runner exploded' });
    expect(context.sessions.updateStatus).toHaveBeenCalledWith(session.id, 'failed');
    expect(context.runner.stop).toHaveBeenCalledWith(session.id);
    expect(listed.json()).toEqual([expect.objectContaining({ id: session.id, status: 'failed' })]);

    await app.close();
  });

  it('returns Claude history only for available whitelisted projects', async () => {
    const projectsRoot = join(root, 'projects');
    const allowedProjectRoot = join(projectsRoot, '-tmp-demo');
    const hiddenProjectRoot = join(projectsRoot, '-tmp-hidden');
    const unavailableProject = fakeProject({ id: 'project-2', path: '/tmp/unavailable-project', available: false });
    mkdirSync(allowedProjectRoot, { recursive: true });
    mkdirSync(hiddenProjectRoot, { recursive: true });
    writeFileSync(join(allowedProjectRoot, 'claude-session.jsonl'), historyLine({ summary: 'Demo history', cwd: root }));
    writeFileSync(join(hiddenProjectRoot, 'hidden-session.jsonl'), historyLine({ summary: 'Hidden history', cwd: '/tmp/hidden' }));
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.listProjects = vi.fn(() => [fakeProject({ id: 'project-1', path: root, available: true }), unavailableProject]);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/history', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        projectKey: '-tmp-demo',
        sessionId: 'claude-session',
        title: 'Demo history',
        projectPath: root,
      }),
    ]);

    await app.close();
  });

  it('resumes history sessions only when the history belongs to the selected project', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'claude-session.jsonl'), historyLine({ summary: 'Demo history', cwd: '/tmp/other-project' }));
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.getProject = vi.fn(() => project);
    context.projects.listProjects = vi.fn(() => [project]);
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/resume',
      headers: authHeaders(),
      payload: { projectId: project.id, claudeSessionId: 'claude-session', title: 'Demo history' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'History session not found for project' });
    expect(context.sessions.createSession).not.toHaveBeenCalled();
    expect(context.runner.start).not.toHaveBeenCalled();

    await app.close();
  });

  it('marks resumed sessions failed when runner startup fails', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'claude-session.jsonl'), historyLine({ summary: 'Demo history', cwd: root }));
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const session = fakeSession({ id: 'session-1', projectId: project.id, source: 'claude-history', claudeSessionId: 'claude-session', title: 'Demo history' });
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.getProject = vi.fn(() => project);
    context.projects.listProjects = vi.fn(() => [project]);
    context.sessions.createSession = vi.fn(() => session);
    context.runner.start = vi.fn(() => {
      throw new Error('resume failed');
    });
    context.sessions.listSessions = vi.fn(() => [{ ...session, status: 'failed' as const }]);
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/resume',
      headers: authHeaders(),
      payload: { projectId: project.id, claudeSessionId: 'claude-session', title: 'Demo history' },
    });
    const listed = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sessions`, headers: authHeaders() });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'resume failed' });
    expect(context.sessions.updateStatus).toHaveBeenCalledWith(session.id, 'failed');
    expect(context.runner.stop).toHaveBeenCalledWith(session.id);
    expect(listed.json()).toEqual([expect.objectContaining({ id: session.id, status: 'failed' })]);

    await app.close();
  });

  it('allows websocket connections with a protocol token', async () => {
    const context = fakeContext();
    let wsSend: ((message: WsServerMessage) => void) | null = null;
    context.hub.attach = vi.fn((_sessionId, send) => {
      wsSend = send;
      return vi.fn();
    });
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { host: 'localhost', 'sec-websocket-protocol': `webagent, ${protocolToken()}` } });

    client.send(JSON.stringify({ type: 'attach', sessionId: 'session-1' }));
    await waitUntil(() => wsSend !== null);

    expect(context.hub.attach).toHaveBeenCalledWith('session-1', expect.any(Function));

    client.close();
    await app.close();
  });

  it('rejects encoded websocket API connections without auth', async () => {
    const context = fakeContext();
    const app = await createApp(context);
    await app.ready();

    await expect(app.injectWS('/%61pi/ws', { headers: { host: 'localhost' } })).rejects.toThrow('Unexpected server response: 401');

    await app.close();
  });

  it('rejects websocket connections without auth', async () => {
    const context = fakeContext();
    const app = await createApp(context);
    await app.ready();

    await expect(app.injectWS('/api/ws', { headers: { host: 'localhost' } })).rejects.toThrow('Unexpected server response: 401');

    await app.close();
  });

  it('sends websocket error messages for invalid JSON instead of throwing', async () => {
    const context = fakeContext();
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });
    const messages = collectWsMessages(client);

    client.send('{not-json');
    await waitUntil(() => messages.length > 0);

    expect(messages).toEqual([{ type: 'error', message: 'Invalid JSON' }]);

    client.close();
    await app.close();
  });

  it('sends websocket error messages for unknown actions instead of throwing', async () => {
    const context = fakeContext();
    context.hub.sendAction = vi.fn(() => {
      throw new Error('Action not found');
    });
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });
    const messages = collectWsMessages(client);

    client.send(JSON.stringify({ type: 'action', sessionId: 'session-1', actionId: 'missing-action' }));
    await waitUntil(() => messages.length > 0);

    expect(messages).toEqual([{ type: 'error', message: 'Action not found' }]);

    client.close();
    await app.close();
  });

  it('resolves websocket actions by action id and ignores client-provided input', async () => {
    const context = fakeContext();
    let wsSend: ((message: WsServerMessage) => void) | null = null;
    context.hub.attach = vi.fn((_sessionId, send) => {
      wsSend = send;
      return vi.fn();
    });
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });
    client.send(JSON.stringify({ type: 'attach', sessionId: 'session-1' }));
    await waitUntil(() => wsSend !== null);
    client.send(JSON.stringify({ type: 'action', sessionId: 'session-1', actionId: 'choice-1', input: 'malicious' }));
    await waitUntil(() => vi.mocked(context.hub.sendAction).mock.calls.length > 0);

    expect(context.hub.sendAction).toHaveBeenCalledWith('session-1', 'choice-1');
    expect(context.hub.sendAction).not.toHaveBeenCalledWith('session-1', 'choice-1', 'malicious');

    client.close();
    await app.close();
  });
});

function authHeaders() {
  return { authorization: 'Bearer test-token' };
}

function protocolToken(token = 'test-token') {
  return `token.${Buffer.from(token).toString('base64url')}`;
}

function historyLine(input: { summary: string; cwd: string }) {
  return `${JSON.stringify({ type: 'summary', summary: input.summary, cwd: input.cwd, timestamp: '2026-01-01T00:00:00.000Z' })}\n`;
}

function fakeContext(overrides: Partial<RouteContext['config']> = {}): RouteContext {
  return {
    config: {
      host: '127.0.0.1',
      port: 8787,
      appToken: 'test-token',
      databasePath: ':memory:',
      claudeConfigDir: root,
      claudeBin: 'claude',
      sessionTtlMs: 60000,
      ...overrides,
    },
    projects: {
      listProjects: vi.fn(() => []),
      addProject: vi.fn(),
      getProject: vi.fn(),
    } as unknown as RouteContext['projects'],
    sessions: {
      listSessions: vi.fn(() => []),
      createSession: vi.fn(),
      getSession: vi.fn(),
      getRecentOutput: vi.fn(() => []),
      appendOutput: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as RouteContext['sessions'],
    runner: {
      start: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      sendInput: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn(),
    } as unknown as RouteContext['runner'],
    hub: {
      attach: vi.fn(),
      handleOutput: vi.fn(),
      sendInput: vi.fn(),
      sendAction: vi.fn(),
      broadcastStatus: vi.fn(),
    } as unknown as RouteContext['hub'],
  };
}

function fakeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Demo',
    path: root,
    favorite: false,
    available: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: 'session-1',
    projectId: 'project-1',
    source: 'web-created',
    claudeSessionId: null,
    title: 'New session',
    status: 'stopped',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function collectWsMessages(client: { on(event: 'message', listener: (data: Buffer) => void): void }): WsServerMessage[] {
  const messages: WsServerMessage[] = [];
  client.on('message', (data: Buffer) => {
    messages.push(JSON.parse(data.toString()) as WsServerMessage);
  });
  return messages;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
