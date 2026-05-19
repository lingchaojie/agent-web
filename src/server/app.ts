import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from './config';
import { isAuthorized, isWebSocketProtocolAuthorized } from './auth';
import type { ProjectRegistry } from './services/projectRegistry';
import type { SessionRegistry } from './services/sessionRegistry';
import type { PtyRunner } from './services/ptyRunner';
import type { RealtimeHub } from './services/realtimeHub';
import { registerAuthRoutes } from './routes/authRoutes';
import { registerProjectRoutes } from './routes/projectRoutes';
import { registerSessionRoutes } from './routes/sessionRoutes';
import { registerHistoryRoutes } from './routes/historyRoutes';

export type RouteContext = {
  config: AppConfig;
  projects: ProjectRegistry;
  sessions: SessionRegistry;
  runner: PtyRunner;
  hub: RealtimeHub;
};

export async function createApp(context: RouteContext) {
  const app = Fastify({ logger: true, routerOptions: { maxParamLength: 2048 } });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const distDir = resolve(process.cwd(), 'dist');
  const hasFrontend = existsSync(resolve(distDir, 'index.html'));
  if (hasFrontend) {
    await app.register(fastifyStatic, { root: distDir });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = getRequestPathname(request.url);
    if (isApiPath(pathname) || !hasFrontend) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  app.addHook('preHandler', async (request, reply) => {
    const pathname = getRequestPathname(request.url);
    if (pathname === '/api/auth/check') return;
    if (!isApiPath(pathname)) return;

    const authorized = pathname === '/api/ws'
      ? isAuthorized(request.headers.authorization, context.config.appToken) || isWebSocketProtocolAuthorized(request.headers['sec-websocket-protocol'], context.config.appToken)
      : isAuthorized(request.headers.authorization, context.config.appToken);

    if (!authorized) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  registerAuthRoutes(app, context);
  registerProjectRoutes(app, context);
  registerSessionRoutes(app, context);
  registerHistoryRoutes(app, context);

  return app;
}

function getRequestPathname(url: string): string {
  const pathname = new URL(url, 'http://localhost').pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}
