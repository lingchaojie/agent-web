import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistorySession, Project } from '../../src/shared/types';
import {
  historyProjectId,
  mergeDiscoveredProjects,
  projectPathFromHistoryId,
} from '../../src/server/services/projectDiscovery';

let root: string;
let projectPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-discovery-'));
  projectPath = join(root, 'demo-project');
  mkdirSync(projectPath);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('projectDiscovery', () => {
  it('round trips stable history project ids', () => {
    const id = historyProjectId('/home/alvin/demo');

    expect(id.startsWith('history:')).toBe(true);
    expect(projectPathFromHistoryId(id)).toBe('/home/alvin/demo');
    expect(projectPathFromHistoryId('project-1')).toBeNull();
  });

  it('discovers available projects from Claude history', () => {
    const projects = mergeDiscoveredProjects([], [historySession({ projectPath, title: 'Build UI' })]);

    expect(projects).toEqual([
      expect.objectContaining({
        id: historyProjectId(projectPath),
        name: 'demo-project',
        path: projectPath,
        favorite: false,
        available: true,
        source: 'history',
      }),
    ]);
  });

  it('filters missing history project paths', () => {
    const projects = mergeDiscoveredProjects([], [historySession({ projectPath: join(root, 'missing') })]);

    expect(projects).toEqual([]);
  });

  it('keeps whitelisted projects when history has the same path', () => {
    const whitelistProject: Project = {
      id: 'project-1',
      name: 'Pinned Demo',
      path: projectPath,
      favorite: true,
      available: true,
      source: 'whitelist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const projects = mergeDiscoveredProjects([whitelistProject], [historySession({ projectPath })]);

    expect(projects).toEqual([whitelistProject]);
  });

  it('does not discover history projects that contain a project-local .claude directory', () => {
    mkdirSync(join(projectPath, '.claude'));

    const projects = mergeDiscoveredProjects([], [historySession({ projectPath, title: 'Local project history' })]);

    expect(projects).toEqual([]);
  });

  it('still keeps whitelisted projects that contain a project-local .claude directory', () => {
    mkdirSync(join(projectPath, '.claude'));
    const whitelistProject: Project = {
      id: 'project-1',
      name: 'Pinned Demo',
      path: projectPath,
      favorite: true,
      available: true,
      source: 'whitelist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const projects = mergeDiscoveredProjects([whitelistProject], [historySession({ projectPath })]);

    expect(projects).toEqual([whitelistProject]);
  });

  it('keeps Claude config projects that contain a project-local .claude directory', () => {
    mkdirSync(join(projectPath, '.claude'));
    const configProject: Project = {
      id: historyProjectId(projectPath),
      name: 'Config Demo',
      path: projectPath,
      favorite: false,
      available: true,
      source: 'claude-config',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const projects = mergeDiscoveredProjects([], [historySession({ projectPath })], [], [configProject]);

    expect(projects).toEqual([configProject]);
  });
});

function historySession(overrides: Partial<HistorySession> = {}): HistorySession {
  return {
    projectKey: '-tmp-demo',
    projectPath,
    sessionId: 'session-1',
    transcriptPath: join(root, 'session-1.jsonl'),
    title: 'History session',
    lastMessage: 'Last message',
    updatedAt: '2026-01-02T00:00:00.000Z',
    blocks: [],
    ...overrides,
  };
}
