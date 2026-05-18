import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { HistorySession } from '../../shared/types';
import type { RouteContext } from '../app';
import { readClaudeHistory } from '../services/claudeHistoryReader';

export function registerHistoryRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/history', async () => {
    return getWhitelistedHistory(context);
  });
}

export function getWhitelistedHistory(context: RouteContext): HistorySession[] {
  const projectsRoot = join(context.config.claudeConfigDir, 'projects');
  const availableProjectPaths = new Set(
    context.projects
      .listProjects()
      .filter((project) => project.available)
      .map((project) => project.path),
  );

  return readClaudeHistory(projectsRoot).filter((session) => session.projectPath !== null && availableProjectPaths.has(session.projectPath));
}
