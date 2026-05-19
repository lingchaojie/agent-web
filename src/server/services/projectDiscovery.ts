import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { HistorySession, Project } from '../../shared/types';

export const HISTORY_PROJECT_ID_PREFIX = 'history:';

export function historyProjectId(path: string): string {
  return `${HISTORY_PROJECT_ID_PREFIX}${Buffer.from(path).toString('base64url')}`;
}

export function projectPathFromHistoryId(id: string): string | null {
  if (!id.startsWith(HISTORY_PROJECT_ID_PREFIX)) return null;
  try {
    const encoded = id.slice(HISTORY_PROJECT_ID_PREFIX.length);
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function mergeDiscoveredProjects(whitelistProjects: Project[], history: HistorySession[]): Project[] {
  const byPath = new Map<string, Project>();

  for (const project of whitelistProjects) {
    byPath.set(project.path, project);
  }

  for (const session of history) {
    if (!session.projectPath || byPath.has(session.projectPath) || !isAvailableProjectPath(session.projectPath)) continue;
    const now = session.updatedAt;
    byPath.set(session.projectPath, {
      id: historyProjectId(session.projectPath),
      name: projectName(session.projectPath),
      path: session.projectPath,
      favorite: false,
      available: true,
      source: 'history',
      createdAt: now,
      updatedAt: now,
    });
  }

  return [...byPath.values()].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function isAvailableProjectPath(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory() && realpathSync(path) === path;
  } catch {
    return false;
  }
}

function projectName(path: string): string {
  return basename(path) || path;
}
