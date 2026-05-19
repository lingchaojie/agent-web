import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Project } from '../../shared/types';
import type { RouteContext } from '../app';
import { getAvailableHistory } from './historyRoutes';
import { isAvailableProjectPath, projectPathFromHistoryId } from '../services/projectDiscovery';

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(['new', 'continue']).default('new'),
});

const resumeSessionSchema = z.object({
  projectId: z.string().min(1),
  claudeSessionId: z.string().min(1),
  title: z.string().min(1).default('Resumed session'),
});

const sessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), sessionId: z.string().min(1), afterSequence: z.number().int().optional() }),
  z.object({ type: z.literal('input'), sessionId: z.string().min(1), text: z.string() }),
  z.object({ type: z.literal('action'), sessionId: z.string().min(1), actionId: z.string().min(1) }),
]);

export function registerSessionRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/projects/:projectId/sessions', async (request) => {
    const params = request.params as { projectId: string };
    return context.sessions.listRunningSessions(params.projectId);
  });

  app.post('/api/sessions', async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const project = resolveProject(context, parsed.data.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const session = context.sessions.createSession({
      projectId: project.id,
      source: 'web-created',
      claudeSessionId: null,
      title: parsed.data.mode === 'continue' ? 'Continued session' : 'New session',
    });

    try {
      context.runner.start({ sessionId: session.id, cwd: project.path, mode: parsed.data.mode });
      context.runner.onData(session.id, (data) => context.hub.handleOutput(session.id, data));
      context.runner.onExit(session.id, (event) => context.hub.broadcastStatus(session.id, event.exitCode === 0 ? 'stopped' : 'failed'));
      context.hub.broadcastStatus(session.id, 'running');
    } catch (error) {
      context.hub.broadcastStatus(session.id, 'failed');
      context.runner.stop(session.id);
      return reply.code(500).send({ error: errorMessage(error) });
    }

    return context.sessions.getSession(session.id);
  });

  app.post('/api/sessions/:sessionId/stop', async (request, reply) => {
    const parsed = sessionParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const session = context.sessions.getSession(parsed.data.sessionId);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    context.hub.broadcastStatus(session.id, 'stopping');
    context.runner.stop(session.id);
    context.hub.broadcastStatus(session.id, 'stopped');
    return context.sessions.getSession(session.id);
  });

  app.post('/api/sessions/resume', async (request, reply) => {
    const parsed = resumeSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const project = resolveProject(context, parsed.data.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const historySession = getAvailableHistory(context).find((session) => session.sessionId === parsed.data.claudeSessionId && session.projectPath === project.path);
    if (!historySession) return reply.code(404).send({ error: 'History session not found for project' });

    const session = context.sessions.createSession({
      projectId: project.id,
      source: 'claude-history',
      claudeSessionId: parsed.data.claudeSessionId,
      title: parsed.data.title,
    });

    try {
      seedHistoryBlocks(context, session.id, historySession);
      context.runner.start({ sessionId: session.id, cwd: project.path, mode: 'resume', claudeSessionId: parsed.data.claudeSessionId });
      context.runner.onData(session.id, (data) => context.hub.handleOutput(session.id, data));
      context.runner.onExit(session.id, (event) => context.hub.broadcastStatus(session.id, event.exitCode === 0 ? 'stopped' : 'failed'));
      context.hub.broadcastStatus(session.id, 'running');
    } catch (error) {
      context.hub.broadcastStatus(session.id, 'failed');
      context.runner.stop(session.id);
      return reply.code(500).send({ error: errorMessage(error) });
    }

    return context.sessions.getSession(session.id);
  });

  app.get('/api/ws', { websocket: true }, (socket) => {
    let detach: (() => void) | null = null;
    const sendError = (message: string, sessionId?: string) => socket.send(JSON.stringify({ type: 'error', sessionId, message }));

    socket.on('message', (raw: Buffer) => {
      try {
        const decoded: unknown = JSON.parse(raw.toString());
        const parsed = wsClientMessageSchema.safeParse(decoded);
        if (!parsed.success) {
          sendError('Invalid websocket message');
          return;
        }

        const message = parsed.data;
        if (message.type === 'subscribe') {
          detach?.();
          detach = context.hub.subscribe({ sessionId: message.sessionId, afterSequence: message.afterSequence }, (serverMessage) => socket.send(JSON.stringify(serverMessage)));
          return;
        }
        if (message.type === 'input') {
          context.hub.sendInput(message.sessionId, message.text);
          return;
        }
        if (message.type === 'action') {
          context.hub.sendAction(message.sessionId, message.actionId);
        }
      } catch (error) {
        sendError(error instanceof SyntaxError ? 'Invalid JSON' : errorMessage(error));
      }
    });

    socket.on('close', () => detach?.());
  });
}

function seedHistoryBlocks(context: RouteContext, sessionId: string, historySession: ReturnType<typeof getAvailableHistory>[number]): void {
  for (const block of historySession.blocks) {
    context.sessions.appendBlock(sessionId, {
      kind: block.kind,
      text: block.text,
      status: block.status,
      source: 'history',
      interaction: block.interaction,
    });
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
