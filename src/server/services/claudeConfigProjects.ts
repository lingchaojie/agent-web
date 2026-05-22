import { existsSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import type { Project } from '../../shared/types';
import { historyProjectId, isAvailableProjectPath } from './projectDiscovery';

type ClaudeConfigShape = {
  projects?: unknown;
};

export function discoverClaudeConfigProjects(claudeConfigDir: string): Project[] {
  const paths = new Set<string>();
  for (const configPath of configPaths(claudeConfigDir)) {
    for (const projectPath of readProjectPaths(configPath)) {
      if (isAvailableProjectPath(projectPath)) paths.add(projectPath);
    }
  }

  const now = new Date().toISOString();
  return [...paths].sort((a, b) => projectName(a).localeCompare(projectName(b))).map((path) => ({
    id: historyProjectId(path),
    name: projectName(path),
    path,
    favorite: false,
    available: true,
    source: 'claude-config',
    createdAt: now,
    updatedAt: now,
  }));
}

function configPaths(claudeConfigDir: string): string[] {
  return [join(claudeConfigDir, '.claude.json'), join(dirname(claudeConfigDir), '.claude.json')];
}

function readProjectPaths(configPath: string): string[] {
  if (!existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as ClaudeConfigShape;
    if (!parsed.projects || typeof parsed.projects !== 'object' || Array.isArray(parsed.projects)) return [];
    return Object.keys(parsed.projects);
  } catch {
    return [];
  }
}

function projectName(path: string): string {
  return basename(path) || path;
}
