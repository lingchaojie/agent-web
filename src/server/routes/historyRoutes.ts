import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { HistorySession, SessionViewState } from '../../shared/types';
import type { RouteContext } from '../app';
import { readClaudeHistory } from '../services/claudeHistoryReader';
import { historyProjectId, isAvailableProjectPath } from '../services/projectDiscovery';

export function registerHistoryRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/history', async () => {
    return getAvailableHistory(context);
  });

  app.get('/api/history/:sessionId/snapshot', async (request, reply) => {
    const params = request.params as { sessionId: string };
    const history = getAvailableHistory(context).find((session) => session.sessionId === params.sessionId);
    if (!history?.projectPath) return reply.code(404).send({ error: 'History session not found' });

    const latestSequence = history.blocks.at(-1)?.sequence ?? 0;
    const session: SessionViewState = {
      sessionId: history.sessionId,
      projectId: historyProjectId(history.projectPath),
      title: history.title,
      lifecycle: 'stopped',
      activity: 'stopped',
      connection: 'disconnected',
      latestSequence,
      updatedAt: history.updatedAt,
      pendingInteraction: null,
    };

    return {
      type: 'snapshot',
      sessionId: history.sessionId,
      sequence: latestSequence,
      session,
      blocks: history.blocks,
    };
  });
}

export function getAvailableHistory(context: RouteContext): HistorySession[] {
  const projectsRoot = join(context.config.claudeConfigDir, 'projects');
  return readClaudeHistory(projectsRoot).filter((session) => session.projectPath !== null && isAvailableProjectPath(session.projectPath));
}
