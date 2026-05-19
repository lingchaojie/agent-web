import type { FastifyInstance } from 'fastify';
import type { Project } from '../../shared/types';
import type { RouteContext } from '../app';
import { buildSlashCommandCatalog } from '../services/slashCommandCatalog';
import { isAvailableProjectPath, projectPathFromHistoryId } from '../services/projectDiscovery';
import { getAvailableHistory } from './historyRoutes';

export function registerSlashCommandRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/projects/:projectId/slash-commands', async (request, reply) => {
    const params = request.params as { projectId: string };
    const project = resolveProject(context, params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    return buildSlashCommandCatalog({ project, claudeConfigDir: context.config.claudeConfigDir });
  });
}

function resolveProject(context: RouteContext, projectId: string): Project | null {
  const whitelisted = context.projects.getProject(projectId);
  if (whitelisted?.available) return whitelisted;

  const historyPath = projectPathFromHistoryId(projectId);
  if (!historyPath || !isAvailableProjectPath(historyPath)) return null;

  const hasHistory = getAvailableHistory(context).some((session) => session.projectPath === historyPath);
  if (!hasHistory) return null;

  const now = new Date().toISOString();
  return {
    id: projectId,
    name: historyPath.split('/').filter(Boolean).at(-1) ?? historyPath,
    path: historyPath,
    favorite: false,
    available: true,
    source: 'history',
    createdAt: now,
    updatedAt: now,
  };
}
