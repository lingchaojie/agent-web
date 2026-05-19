import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type RouteContext } from '../../src/server/app';
import { historyProjectId } from '../../src/server/services/projectDiscovery';
import { ClaudeResumeIndex } from '../../src/server/services/claudeResumeIndex';
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

  it('returns project-scoped slash command metadata without command bodies', async () => {
    const project = fakeProject({ id: 'project-1', path: root });
    mkdirSync(join(root, '.claude', 'commands', 'opsx'), { recursive: true });
    writeFileSync(join(root, '.claude', 'commands', 'deploy.md'), 'Deploy the selected service\n\nRun internal deploy steps.');
    writeFileSync(join(root, '.claude', 'commands', 'opsx', 'apply.md'), [
      '---',
      'name: "OPSX: Apply"',
      'description: Implement tasks from an OpenSpec change',
      '---',
      'Private nested command body',
      'x'.repeat(5000),
    ].join('\n'));
    mkdirSync(join(root, '.claude', 'skills', 'audit'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'audit', 'SKILL.md'), [
      '---',
      'name: audit',
      'description: Review changed code for risky behavior',
      '---',
      'Private skill body',
    ].join('\n'));
    const context = fakeContext();
    context.projects.getProject = vi.fn(() => project);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/slash-commands`, headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projectId: project.id,
      commands: expect.arrayContaining([
        expect.objectContaining({ name: '/resume', scope: 'app', behavior: 'app-owned', support: 'supported' }),
        expect.objectContaining({ name: '/deploy', scope: 'project', behavior: 'prompt-insert', support: 'supported', description: 'Deploy the selected service' }),
        expect.objectContaining({ name: '/opsx:apply', title: 'OPSX: Apply', scope: 'project', behavior: 'prompt-insert', support: 'supported', description: 'Implement tasks from an OpenSpec change' }),
        expect.objectContaining({ name: '/audit', scope: 'project', behavior: 'prompt-insert', support: 'supported', description: 'Review changed code for risky behavior' }),
      ]),
    });
    expect(JSON.stringify(response.json())).not.toContain('Run internal deploy steps');
    expect(JSON.stringify(response.json())).not.toContain('Private nested command body');
    expect(JSON.stringify(response.json())).not.toContain('/apply"');
    expect(JSON.stringify(response.json())).not.toContain('Private skill body');

    await app.close();
  });

  it('returns built-in slash commands when local discovery is unavailable', async () => {
    const project = fakeProject({ id: 'project-1', path: root });
    const context = fakeContext({ claudeConfigDir: join(root, 'missing-claude-config') });
    context.projects.getProject = vi.fn(() => project);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/slash-commands`, headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projectId: project.id,
      commands: [
        expect.objectContaining({ name: '/resume', scope: 'app', behavior: 'app-owned', support: 'supported' }),
      ],
    });

    await app.close();
  });

  it('returns slash commands for discovered history projects', async () => {
    const discoveredProjectPath = join(root, 'history-demo');
    const historyProjectRoot = join(root, 'projects', '-tmp-history-demo');
    mkdirSync(discoveredProjectPath, { recursive: true });
    mkdirSync(historyProjectRoot, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const projectId = historyProjectId(discoveredProjectPath);
    const context = fakeContext();
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: `/api/projects/${encodeURIComponent(projectId)}/slash-commands`, headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projectId,
      commands: [expect.objectContaining({ name: '/resume', scope: 'app', behavior: 'app-owned', support: 'supported' })],
    });

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
    expect(context.runner.onEvent).toHaveBeenCalledWith(session.id, expect.any(Function));
    expect(context.runner.onFallbackOutput).toHaveBeenCalledWith(session.id, expect.any(Function));
    expect(context.runner.onExit).toHaveBeenCalledWith(session.id, expect.any(Function));
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'running');

    await app.close();
  });

  it('stops running sessions through the session API', async () => {
    const session = fakeSession({ id: 'session-1', status: 'running' });
    const context = fakeContext();
    context.sessions.getSession = vi.fn()
      .mockReturnValueOnce(session)
      .mockReturnValueOnce({ ...session, status: 'stopped' as const });
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/stop`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'stopping');
    expect(context.runner.stop).toHaveBeenCalledWith(session.id);
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'stopped');
    expect(response.json()).toEqual(expect.objectContaining({ id: session.id, status: 'stopped' }));

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
    context.sessions.listRunningSessions = vi.fn(() => []);
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
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'failed');
    expect(context.runner.stop).toHaveBeenCalledWith(session.id);
    expect(context.sessions.listRunningSessions).toHaveBeenCalledWith(project.id);
    expect(listed.json()).toEqual([]);

    await app.close();
  });

  it('marks running sessions failed when the runner exits non-zero', async () => {
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const session = fakeSession({ id: 'session-1', projectId: project.id, title: 'New session' });
    const context = fakeContext();
    context.projects.getProject = vi.fn(() => project);
    context.sessions.createSession = vi.fn(() => session);
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(),
      payload: { projectId: project.id, mode: 'new' },
    });
    const onExit = vi.mocked(context.runner.onExit).mock.calls[0]?.[1];
    onExit?.({ exitCode: 1 });

    expect(response.statusCode).toBe(200);
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'failed');
    expect(context.transcripts.normalizeEntrypoint).not.toHaveBeenCalled();

    await app.close();
  });

  it('keeps sessions running and normalizes native transcripts when a structured print-mode turn exits successfully', async () => {
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const session = fakeSession({ id: 'session-1', projectId: project.id, claudeSessionId: 'native-session-1', title: 'New session' });
    const context = fakeContext();
    context.projects.getProject = vi.fn(() => project);
    context.sessions.createSession = vi.fn(() => session);
    context.sessions.getSession = vi.fn(() => session);
    const app = await createApp(context);

    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(),
      payload: { projectId: project.id, mode: 'new' },
    });
    const onExit = vi.mocked(context.runner.onExit).mock.calls[0]?.[1];
    onExit?.({ exitCode: 0 });

    expect(context.hub.broadcastStatus).not.toHaveBeenCalledWith(session.id, 'stopped');
    expect(context.hub.broadcastStatus).not.toHaveBeenCalledWith(session.id, 'failed');
    expect(context.transcripts.normalizeEntrypoint).toHaveBeenCalledWith({ projectPath: project.path, sessionId: 'native-session-1' });

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

  it('annotates history entries that already have matching app sessions', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'claude-session.jsonl'), historyLine({ summary: 'Demo history', cwd: root }));
    const existing = fakeSession({ id: 'session-existing', projectId: 'project-1', claudeSessionId: 'claude-session', status: 'running' });
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.listProjects = vi.fn(() => [fakeProject({ id: 'project-1', path: root, available: true })]);
    context.sessions.findByClaudeSessionId = vi.fn(() => existing);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/history', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        sessionId: 'claude-session',
        appSessionId: 'session-existing',
        appSession: expect.objectContaining({ id: 'session-existing', claudeSessionId: 'claude-session' }),
      }),
    ]);

    await app.close();
  });

  it('returns restored snapshots for available Claude history sessions', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'claude-session.jsonl'), [
      JSON.stringify({ type: 'summary', summary: 'Demo history', cwd: root, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00.000Z', message: { role: 'user', content: 'Restore this' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:02:00.000Z', message: { role: 'assistant', content: 'Restored response' } }),
      '',
    ].join('\n'));
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.listProjects = vi.fn(() => [fakeProject({ id: 'project-1', path: root, available: true })]);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/history/claude-session/snapshot', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      type: 'snapshot',
      sessionId: 'claude-session',
      sequence: 2,
      session: expect.objectContaining({
        sessionId: 'claude-session',
        projectId: `history:${Buffer.from(root).toString('base64url')}`,
        title: 'Demo history',
        lifecycle: 'stopped',
        activity: 'stopped',
        connection: 'disconnected',
        latestSequence: 2,
        updatedAt: '2026-01-01T00:02:00.000Z',
        pendingInteraction: null,
      }),
      blocks: [
        expect.objectContaining({ kind: 'user', text: 'Restore this', sequence: 1 }),
        expect.objectContaining({ kind: 'assistant', text: 'Restored response', sequence: 2 }),
      ],
      render: expect.objectContaining({
        regions: [
          expect.objectContaining({ kind: 'user', text: 'Restore this', source: 'history' }),
          expect.objectContaining({ kind: 'assistant', text: 'Restored response', source: 'history' }),
        ],
        activeRegion: null,
      }),
    });

    await app.close();
  });

  it('returns the latest transcript window for available Claude history sessions', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'claude-session.jsonl'), [
      JSON.stringify({ type: 'summary', summary: 'Demo history', cwd: root, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00.000Z', message: { role: 'user', content: 'First prompt' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:02:00.000Z', message: { role: 'assistant', content: 'First response' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:03:00.000Z', message: { role: 'user', content: 'Latest prompt' } }),
      '',
    ].join('\n'));
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.listProjects = vi.fn(() => [fakeProject({ id: 'project-1', path: root, available: true })]);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/history/claude-session/transcript?limit=2', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      sessionId: 'claude-session',
      title: 'Demo history',
      olderCursor: '1',
      hasMoreOlder: true,
      regions: [
        expect.objectContaining({ kind: 'assistant', text: 'First response', source: 'history' }),
        expect.objectContaining({ kind: 'user', text: 'Latest prompt', source: 'history' }),
      ],
    }));

    await app.close();
  });

  it('returns transcript windows for app sessions with a native Claude identity', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'native-session.jsonl'), [
      JSON.stringify({ type: 'summary', summary: 'Native history', cwd: root, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00.000Z', message: { role: 'user', content: 'App prompt' } }),
      '',
    ].join('\n'));
    const appSession = fakeSession({ id: 'session-1', projectId: 'project-1', claudeSessionId: 'native-session', status: 'running' });
    const context = fakeContext({ claudeConfigDir: root });
    context.sessions.getSession = vi.fn(() => appSession);
    context.projects.getProject = vi.fn(() => fakeProject({ id: 'project-1', path: root, available: true }));
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/sessions/session-1/transcript?limit=10', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      sessionId: 'native-session',
      regions: [expect.objectContaining({ kind: 'user', text: 'App prompt' })],
      hasMoreOlder: false,
    }));

    await app.close();
  });

  it('returns transcript windows for app sessions in discovered history projects', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(projectRoot, 'native-session.jsonl'), [
      JSON.stringify({ type: 'summary', summary: 'Native history', cwd: discoveredProjectPath, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00.000Z', message: { role: 'user', content: 'History project prompt' } }),
      '',
    ].join('\n'));
    const projectId = `history:${Buffer.from(discoveredProjectPath).toString('base64url')}`;
    const appSession = fakeSession({ id: 'session-1', projectId, claudeSessionId: 'native-session', status: 'running' });
    const context = fakeContext({ claudeConfigDir: root });
    context.sessions.getSession = vi.fn(() => appSession);
    context.projects.getProject = vi.fn(() => null);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/sessions/session-1/transcript?limit=10', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      sessionId: 'native-session',
      regions: [expect.objectContaining({ kind: 'user', text: 'History project prompt' })],
    }));

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
    context.sessions.listRunningSessions = vi.fn(() => []);
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
    expect(context.hub.broadcastStatus).toHaveBeenCalledWith(session.id, 'failed');
    expect(context.runner.stop).toHaveBeenCalledWith(session.id);
    expect(context.sessions.listRunningSessions).toHaveBeenCalledWith(project.id);
    expect(listed.json()).toEqual([]);

    await app.close();
  });

  it('lists available Claude history projects without requiring whitelist entries', async () => {
    const projectsRoot = join(root, 'projects');
    const historyProjectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(historyProjectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.listProjects = vi.fn(() => []);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: '/api/projects', headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^history:/),
        name: 'history-demo',
        path: discoveredProjectPath,
        source: 'history',
        available: true,
      }),
    ]);

    await app.close();
  });

  it('lists live sessions for discovered history projects with long encoded project ids', async () => {
    const projectsRoot = join(root, 'projects');
    const historyProjectRoot = join(projectsRoot, '-tmp-history-demo');
    const longDirectoryName = 'history-project-path-long-enough-to-exceed-fastify-default-param-length';
    const discoveredProjectPath = join(root, longDirectoryName, longDirectoryName, 'workspace');
    mkdirSync(historyProjectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const projectId = `history:${Buffer.from(discoveredProjectPath).toString('base64url')}`;
    expect(projectId.length).toBeGreaterThan(100);
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.listProjects = vi.fn(() => []);
    const liveSession = fakeSession({ id: 'session-1', projectId });
    context.sessions.listRunningSessions = vi.fn(() => [liveSession]);
    const app = await createApp(context);

    const response = await app.inject({ method: 'GET', url: `/api/projects/${encodeURIComponent(projectId)}/sessions`, headers: authHeaders() });

    expect(response.statusCode).toBe(200);
    expect(context.sessions.listRunningSessions).toHaveBeenCalledWith(projectId);
    expect(response.json()).toEqual([expect.objectContaining({ id: liveSession.id, projectId })]);

    await app.close();
  });

  it('starts new sessions in discovered history projects', async () => {
    const projectsRoot = join(root, 'projects');
    const historyProjectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(historyProjectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.getProject = vi.fn(() => null);
    context.projects.listProjects = vi.fn(() => []);
    const session = fakeSession({ id: 'session-1', projectId: `history:${Buffer.from(discoveredProjectPath).toString('base64url')}` });
    context.sessions.createSession = vi.fn(() => session);
    context.sessions.getSession = vi.fn(() => ({ ...session, status: 'running' as const }));
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(),
      payload: { projectId: session.projectId, mode: 'new' },
    });

    expect(response.statusCode).toBe(200);
    expect(context.sessions.createSession).toHaveBeenCalledWith({
      projectId: session.projectId,
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });
    expect(context.runner.start).toHaveBeenCalledWith({ sessionId: session.id, cwd: discoveredProjectPath, mode: 'new' });

    await app.close();
  });

  it('indexes web-created native sessions for Claude resume picker after first input', async () => {
    const projectsRoot = join(root, 'projects');
    const historyProjectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(historyProjectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const projectId = `history:${Buffer.from(discoveredProjectPath).toString('base64url')}`;
    const session = fakeSession({ id: 'session-1', projectId, claudeSessionId: 'native-session-1', status: 'running' });
    const context = fakeContext({ claudeConfigDir: root });
    context.resumeIndex = new ClaudeResumeIndex(root);
    context.projects.getProject = vi.fn(() => null);
    context.projects.listProjects = vi.fn(() => []);
    context.sessions.getSession = vi.fn(() => session);
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });

    client.send(JSON.stringify({ type: 'input', sessionId: session.id, text: '你好\n' }));
    await waitUntil(() => existsSync(join(root, 'history.jsonl')));

    const lines = readFileSync(join(root, 'history.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      expect.objectContaining({
        display: '你好',
        project: discoveredProjectPath,
        sessionId: 'native-session-1',
        pastedContents: {},
      }),
    ]);
    expect(context.hub.sendInput).toHaveBeenCalledWith(session.id, '你好\n');

    client.close();
    await app.close();
  });

  it('indexes pending web prompts when native session identity arrives after input', async () => {
    const project = fakeProject({ id: 'project-1', path: root, available: true });
    const session = fakeSession({ id: 'session-1', projectId: project.id, claudeSessionId: null, status: 'running' });
    const context = fakeContext({ claudeConfigDir: root });
    context.resumeIndex = new ClaudeResumeIndex(root);
    context.projects.getProject = vi.fn(() => project);
    context.sessions.createSession = vi.fn(() => session);
    context.sessions.getSession = vi.fn(() => session);
    const app = await createApp(context);

    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: authHeaders(),
      payload: { projectId: project.id, mode: 'new' },
    });
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });
    const onEvent = vi.mocked(context.runner.onEvent).mock.calls[0]?.[1];

    client.send(JSON.stringify({ type: 'input', sessionId: session.id, text: 'first prompt\n' }));
    await waitUntil(() => vi.mocked(context.hub.sendInput).mock.calls.length > 0);
    expect(existsSync(join(root, 'history.jsonl'))).toBe(false);

    onEvent?.({ type: 'session-identity-observed', sessionId: session.id, claudeSessionId: 'native-session-delayed', order: 1, createdAt: new Date().toISOString() });
    await waitUntil(() => existsSync(join(root, 'history.jsonl')));

    const lines = readFileSync(join(root, 'history.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      expect.objectContaining({
        display: 'first prompt',
        project: project.path,
        sessionId: 'native-session-delayed',
      }),
    ]);
    expect(context.hub.handleClaudeEvent).toHaveBeenCalledWith(session.id, expect.objectContaining({ type: 'session-identity-observed' }));

    client.close();
    await app.close();
  });

  it('seeds restored history blocks before starting a resumed session', async () => {
    const projectsRoot = join(root, 'projects');
    const projectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(projectRoot, 'history-session.jsonl'), [
      JSON.stringify({ type: 'summary', summary: 'History demo', cwd: discoveredProjectPath, timestamp: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:01:00.000Z', message: { role: 'user', content: 'Old prompt' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:02:00.000Z', message: { role: 'assistant', content: 'Old response' } }),
      '',
    ].join('\n'));
    const projectId = `history:${Buffer.from(discoveredProjectPath).toString('base64url')}`;
    const session = fakeSession({ id: 'session-1', projectId, source: 'claude-history', claudeSessionId: 'history-session', title: 'History demo' });
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.getProject = vi.fn(() => null);
    context.projects.listProjects = vi.fn(() => []);
    context.sessions.createSession = vi.fn(() => session);
    context.sessions.getSession = vi.fn(() => ({ ...session, status: 'running' as const }));
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/resume',
      headers: authHeaders(),
      payload: { projectId, claudeSessionId: 'history-session', title: 'History demo' },
    });

    expect(response.statusCode).toBe(200);
    expect(context.sessions.appendBlock).toHaveBeenCalledWith(session.id, expect.objectContaining({ kind: 'user', text: 'Old prompt', source: 'history' }));
    expect(context.sessions.appendBlock).toHaveBeenCalledWith(session.id, expect.objectContaining({ kind: 'assistant', text: 'Old response', source: 'history' }));
    expect(context.runner.start).toHaveBeenCalledWith({
      sessionId: session.id,
      cwd: discoveredProjectPath,
      mode: 'resume',
      claudeSessionId: 'history-session',
    });

    await app.close();
  });

  it('resumes history sessions from discovered projects', async () => {
    const projectsRoot = join(root, 'projects');
    const historyProjectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(historyProjectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const projectId = `history:${Buffer.from(discoveredProjectPath).toString('base64url')}`;
    const session = fakeSession({ id: 'session-1', projectId, source: 'claude-history', claudeSessionId: 'history-session', title: 'History demo' });
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.getProject = vi.fn(() => null);
    context.projects.listProjects = vi.fn(() => []);
    context.sessions.createSession = vi.fn(() => session);
    context.sessions.getSession = vi.fn(() => ({ ...session, status: 'running' as const }));
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/resume',
      headers: authHeaders(),
      payload: { projectId, claudeSessionId: 'history-session', title: 'History demo' },
    });

    expect(response.statusCode).toBe(200);
    expect(context.runner.start).toHaveBeenCalledWith({
      sessionId: session.id,
      cwd: discoveredProjectPath,
      mode: 'resume',
      claudeSessionId: 'history-session',
    });

    await app.close();
  });

  it('returns existing app sessions instead of duplicating matching history resumes', async () => {
    const projectsRoot = join(root, 'projects');
    const historyProjectRoot = join(projectsRoot, '-tmp-history-demo');
    const discoveredProjectPath = join(root, 'history-demo');
    mkdirSync(historyProjectRoot, { recursive: true });
    mkdirSync(discoveredProjectPath, { recursive: true });
    writeFileSync(join(historyProjectRoot, 'history-session.jsonl'), historyLine({ summary: 'History demo', cwd: discoveredProjectPath }));
    const projectId = `history:${Buffer.from(discoveredProjectPath).toString('base64url')}`;
    const existing = fakeSession({ id: 'session-existing', projectId, source: 'web-created', claudeSessionId: 'history-session', title: 'New session', status: 'running' });
    const context = fakeContext({ claudeConfigDir: root });
    context.projects.getProject = vi.fn(() => null);
    context.projects.listProjects = vi.fn(() => []);
    context.sessions.findByClaudeSessionId = vi.fn(() => existing);
    context.sessions.getSession = vi.fn(() => existing);
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/resume',
      headers: authHeaders(),
      payload: { projectId, claudeSessionId: 'history-session', title: 'History demo' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({ id: existing.id, claudeSessionId: 'history-session' }));
    expect(context.sessions.createSession).not.toHaveBeenCalled();
    expect(context.sessions.appendBlock).not.toHaveBeenCalled();
    expect(context.runner.start).not.toHaveBeenCalled();

    await app.close();
  });

  it('allows websocket stream subscriptions with a protocol token', async () => {
    const context = fakeContext();
    let wsSend: ((message: WsServerMessage) => void) | null = null;
    context.hub.subscribe = vi.fn((_input, send) => {
      wsSend = send;
      return vi.fn();
    });
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { host: 'localhost', 'sec-websocket-protocol': `webagent, ${protocolToken()}` } });

    client.send(JSON.stringify({ type: 'subscribe', sessionId: 'session-1' }));
    await waitUntil(() => wsSend !== null);

    expect(context.hub.subscribe).toHaveBeenCalledWith({ sessionId: 'session-1', afterSequence: undefined }, expect.any(Function));

    client.close();
    await app.close();
  });

  it('subscribes websocket clients with optional reconnect sequence', async () => {
    const context = fakeContext();
    let wsSend: ((message: WsServerMessage) => void) | null = null;
    context.hub.subscribe = vi.fn((_input, send) => {
      wsSend = send;
      return vi.fn();
    });
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });

    client.send(JSON.stringify({ type: 'subscribe', sessionId: 'session-1', afterSequence: 7 }));
    await waitUntil(() => wsSend !== null);

    expect(context.hub.subscribe).toHaveBeenCalledWith({ sessionId: 'session-1', afterSequence: 7 }, expect.any(Function));

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

  it('rejects obsolete websocket attach messages', async () => {
    const context = fakeContext();
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });
    const messages = collectWsMessages(client);

    client.send(JSON.stringify({ type: 'attach', sessionId: 'session-1' }));
    await waitUntil(() => messages.length > 0);

    expect(messages).toEqual([{ type: 'error', message: 'Invalid websocket message' }]);
    expect(context.hub.subscribe).not.toHaveBeenCalled();

    client.close();
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
    context.hub.subscribe = vi.fn((_input, send) => {
      wsSend = send;
      return vi.fn();
    });
    const app = await createApp(context);
    await app.ready();
    const client = await app.injectWS('/api/ws', { headers: { ...authHeaders(), host: 'localhost' } });
    client.send(JSON.stringify({ type: 'subscribe', sessionId: 'session-1' }));
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
      listRunningSessions: vi.fn(() => []),
      createSession: vi.fn(),
      getSession: vi.fn(),
      findByClaudeSessionId: vi.fn(() => null),
      appendBlock: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as RouteContext['sessions'],
    runner: {
      start: vi.fn(),
      onEvent: vi.fn(),
      onFallbackOutput: vi.fn(),
      onExit: vi.fn(),
      sendInput: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn(),
    } as unknown as RouteContext['runner'],
    hub: {
      subscribe: vi.fn(),
      handleClaudeEvent: vi.fn(),
      handleOutput: vi.fn(),
      sendInput: vi.fn(),
      sendAction: vi.fn(),
      broadcastStatus: vi.fn(),
    } as unknown as RouteContext['hub'],
    resumeIndex: new ClaudeResumeIndex(root),
    transcripts: {
      normalizeEntrypoint: vi.fn(),
    },
  };
}

function fakeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Demo',
    path: root,
    favorite: false,
    available: true,
    source: 'whitelist',
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
