import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ConversationBlock, HistorySession, RenderRegion, SessionViewState } from '../../shared/types';
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
      transcriptSource: 'structured',
      claudeSessionId: history.sessionId,
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
      render: {
        sessionId: history.sessionId,
        regions: history.blocks.map(historyBlockToRegion),
        activeRegion: null,
        transientStatus: { activity: 'stopped' },
        diagnostics: [],
        transcriptSource: 'structured',
        sequence: latestSequence,
      },
    };
  });
}

export function getAvailableHistory(context: RouteContext): HistorySession[] {
  const projectsRoot = join(context.config.claudeConfigDir, 'projects');
  return readClaudeHistory(projectsRoot)
    .filter((session) => session.projectPath !== null && isAvailableProjectPath(session.projectPath))
    .map((session) => {
      const appSession = context.sessions.findByClaudeSessionId(session.sessionId) ?? undefined;
      return appSession ? { ...session, appSessionId: appSession.id, appSession } : session;
    });
}

function historyBlockToRegion(block: ConversationBlock): RenderRegion {
  return {
    id: block.id,
    kind: block.kind,
    text: block.text,
    status: block.status,
    source: 'history',
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    interaction: block.interaction,
  };
}
