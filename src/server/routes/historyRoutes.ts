import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ConversationBlock, HistorySession, RenderRegion, SessionViewState } from '../../shared/types';
import type { RouteContext } from '../app';
import { readClaudeHistory, readClaudeTranscriptWindow } from '../services/claudeHistoryReader';
import { historyProjectId, isAvailableProjectPath, projectPathFromHistoryId } from '../services/projectDiscovery';

export function registerHistoryRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/history', async () => {
    return getAvailableHistory(context);
  });

  app.get('/api/history/:sessionId/transcript', async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = request.query as { limit?: string; before?: string };
    const history = getAvailableHistory(context).find((session) => session.sessionId === params.sessionId);
    if (!history?.projectPath) return reply.code(404).send({ error: 'History session not found' });

    const window = readClaudeTranscriptWindow(projectsRoot(context), {
      sessionId: params.sessionId,
      limit: parseLimit(query.limit),
      before: query.before,
      claudeConfigDir: context.config.claudeConfigDir,
    });
    if (!window) return reply.code(404).send({ error: 'Transcript not found' });
    return window;
  });

  app.get('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const params = request.params as { sessionId: string };
    const query = request.query as { limit?: string; before?: string };
    const session = context.sessions.getSession(params.sessionId);
    if (!session?.claudeSessionId) return reply.code(404).send({ error: 'Transcript not found' });

    const window = readClaudeTranscriptWindow(projectsRoot(context), {
      sessionId: session.claudeSessionId,
      limit: parseLimit(query.limit),
      before: query.before,
      claudeConfigDir: context.config.claudeConfigDir,
    });
    if (!window?.projectPath || window.projectPath !== resolveSessionProjectPath(context, session.projectId)) return reply.code(404).send({ error: 'Transcript not found' });
    return window;
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
  return readClaudeHistory(projectsRoot(context), { claudeConfigDir: context.config.claudeConfigDir })
    .filter((session) => session.projectPath !== null && isAvailableProjectPath(session.projectPath))
    .map((session) => {
      const appSession = context.sessions.findByClaudeSessionId(session.sessionId) ?? undefined;
      if (appSession?.status === 'running' && appSession.projectId === historyProjectId(session.projectPath!)) {
        return { ...session, appSessionId: appSession.id, appSession };
      }
      return session;
    });
}

function projectsRoot(context: RouteContext): string {
  return join(context.config.claudeConfigDir, 'projects');
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveSessionProjectPath(context: RouteContext, projectId: string): string | null {
  const project = context.projects.getProject(projectId);
  if (project?.available) return project.path;
  const historyPath = projectPathFromHistoryId(projectId);
  return historyPath && isAvailableProjectPath(historyPath) ? historyPath : null;
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
