import type { FastifyInstance } from 'fastify';
import { isAuthorized } from '../auth';
import type { RouteContext } from '../app';

export function registerAuthRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/auth/check', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, context.config.appToken)) {
      return reply.code(401).send({ ok: false });
    }
    return { ok: true };
  });
}
