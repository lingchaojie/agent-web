import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildStatuslineInput, loadStatuslineSettings, runStatuslineCommand, sanitizeStatuslineOutput, StatuslineService } from '../../src/server/services/statuslineService';
import type { ClaudeSession, Project, SessionRenderState, SessionViewState } from '../../src/shared/types';

describe('statusline service', () => {
  it('loads command settings and resolves refresh defaults', () => {
    const root = tempDir();
    try {
      const settingsPath = join(root, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'node statusline.js', padding: 0, refreshInterval: 5 } }));

      expect(loadStatuslineSettings({ settingsPath })).toEqual({ command: 'node statusline.js', padding: 0, refreshIntervalSeconds: 5 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses safe defaults when statusline settings are missing', () => {
    expect(loadStatuslineSettings({ settingsPath: join(tmpdir(), 'missing-statusline-settings.json') })).toEqual({ command: null, padding: 0, refreshIntervalSeconds: 10 });
  });

  it('builds Claude Code-like stdin context for a session', () => {
    const input = buildStatuslineInput({
      session: session({ claudeSessionId: 'native-session-1', title: 'Restore history' }),
      project: project({ path: '/tmp/project' }),
      view: view({ lifecycle: 'waiting-for-input', activity: 'idle' }),
      render: render({ sequence: 7 }),
      settings: { command: 'npx -y ccstatusline@latest', padding: 0, refreshIntervalSeconds: 10 },
      now: new Date('2026-05-19T10:00:00.000Z'),
    });

    expect(input).toMatchObject({
      session_id: 'native-session-1',
      session_name: 'Restore history',
      cwd: '/tmp/project',
      workspace: { current_dir: '/tmp/project', project_dir: '/tmp/project' },
      model: { display_name: 'Claude' },
      agent: { name: 'webagent' },
      webagent: {
        app_session_id: 'app-session-1',
        lifecycle: 'waiting-for-input',
        activity: 'idle',
        render_sequence: 7,
        statusline_refresh_interval: 10,
      },
    });
  });

  it('executes the configured command with JSON stdin and preserves ANSI stdout', async () => {
    const execute = vi.fn(async () => ({ code: 0, stdout: '[36mOpus 4.7[0m\n', stderr: '' }));
    const state = await runStatuslineCommand({
      command: 'node statusline.js',
      input: { session_id: 'native-session-1' },
      sessionId: 'app-session-1',
      sequence: 4,
      execute,
      now: () => new Date('2026-05-19T10:00:00.000Z'),
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'node statusline.js',
      stdin: JSON.stringify({ session_id: 'native-session-1' }),
    }));
    expect(state).toEqual({
      sessionId: 'app-session-1',
      status: 'ready',
      text: '[36mOpus 4.7[0m',
      updatedAt: '2026-05-19T10:00:00.000Z',
      sequence: 4,
    });
  });

  it('returns compact error state for command failures', async () => {
    const state = await runStatuslineCommand({
      command: 'node statusline.js',
      input: { session_id: 'native-session-1' },
      sessionId: 'app-session-1',
      sequence: 2,
      execute: async () => ({ code: 1, stdout: '', stderr: 'No input received' }),
      now: () => new Date('2026-05-19T10:00:00.000Z'),
    });

    expect(state).toMatchObject({ sessionId: 'app-session-1', status: 'error', text: '', error: 'No input received', sequence: 2 });
  });

  it('returns compact error state when command times out', async () => {
    const state = await runStatuslineCommand({
      command: 'node statusline.js',
      input: { session_id: 'native-session-1' },
      sessionId: 'app-session-1',
      sequence: 2,
      execute: async () => { throw new Error('Statusline command timed out'); },
      now: () => new Date('2026-05-19T10:00:00.000Z'),
    });

    expect(state).toMatchObject({ sessionId: 'app-session-1', status: 'error', text: '', error: 'Statusline command timed out', sequence: 2 });
  });

  it('filters native-only shortcut hints from output', () => {
    expect(sanitizeStatuslineOutput('[35m▸▸ bypass permissions on[0m (shift+tab to cycle)\n')).toBe('[35m▸▸ bypass permissions on[0m');
  });

  it('renders statusline state through the service facade', async () => {
    const root = tempDir();
    try {
      const settingsPath = join(root, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'node statusline.js', refreshInterval: 3 } }));
      const execute = vi.fn(async () => ({ code: 0, stdout: 'session status\n', stderr: '' }));
      const service = new StatuslineService({ settingsPath, execute, now: () => new Date('2026-05-19T10:00:00.000Z') });

      const state = await service.render({
        session: session(),
        project: project(),
        view: view(),
        render: render(),
        sequence: 8,
      });

      expect(state).toMatchObject({ sessionId: 'app-session-1', status: 'ready', text: 'session status', sequence: 8 });
      expect(service.settings()).toMatchObject({ command: 'node statusline.js', refreshIntervalSeconds: 3 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'webagent-statusline-'));
}

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: 'app-session-1',
    projectId: 'project-1',
    source: 'web-created',
    claudeSessionId: null,
    title: 'Demo session',
    status: 'running',
    lastActiveAt: '2026-05-19T09:59:00.000Z',
    createdAt: '2026-05-19T09:00:00.000Z',
    ...overrides,
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
    createdAt: '2026-05-19T09:00:00.000Z',
    updatedAt: '2026-05-19T09:00:00.000Z',
    ...overrides,
  };
}

function view(overrides: Partial<SessionViewState> = {}): SessionViewState {
  return {
    sessionId: 'app-session-1',
    projectId: 'project-1',
    title: 'Demo session',
    lifecycle: 'running',
    activity: 'idle',
    connection: 'connected',
    transcriptSource: 'structured',
    claudeSessionId: null,
    latestSequence: 0,
    updatedAt: '2026-05-19T09:59:00.000Z',
    pendingInteraction: null,
    ...overrides,
  };
}

function render(overrides: Partial<SessionRenderState> = {}): SessionRenderState {
  return {
    sessionId: 'app-session-1',
    regions: [],
    activeRegion: null,
    transientStatus: { activity: 'idle' },
    diagnostics: [],
    transcriptSource: 'structured',
    sequence: 0,
    ...overrides,
  };
}
