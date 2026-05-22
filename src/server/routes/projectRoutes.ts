import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteContext } from '../app';
import { getAvailableHistory } from './historyRoutes';
import { discoverClaudeConfigProjects } from '../services/claudeConfigProjects';
import { mergeDiscoveredProjects } from '../services/projectDiscovery';

const addProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  favorite: z.boolean().default(false),
});

export function registerProjectRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/projects', async () => {
    try {
      await context.tmuxSync?.refresh();
    } catch {
      // Existing sessions still identify active client workspaces if tmux refresh is temporarily unavailable.
    }
    return mergeDiscoveredProjects(
      context.projects.listProjects(),
      getAvailableHistory(context),
      context.sessions.listExternalSessions(),
      discoverClaudeConfigProjects(context.config.claudeConfigDir),
    );
  });

  app.post('/api/projects', async (request, reply) => {
    const parsed = addProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return context.projects.addProject(parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to add project' });
    }
  });
}
