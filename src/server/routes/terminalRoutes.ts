import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TerminalAttach } from '../services/terminalAttachService';
import type { RouteContext } from '../app';
import type { TerminalClientMessage, TerminalServerMessage } from '../../shared/types';

const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('attach'),
    sessionId: z.string().min(1),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('input'),
    sessionId: z.string().min(1),
    data: z.string(),
    source: z.enum(['terminal', 'mobile-keyboard']).optional(),
    resetMode: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('resize'),
    sessionId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('detach'),
    sessionId: z.string().min(1),
  }),
]);

export function registerTerminalRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/terminal/ws', { websocket: true }, (socket) => {
    let activeAttach: TerminalAttach | null = null;
    let attachedSessionId: string | null = null;

    const send = (message: TerminalServerMessage) => {
      socket.send(JSON.stringify(message));
    };

    const clearAttach = () => {
      activeAttach = null;
      attachedSessionId = null;
    };

    const detachCurrent = () => {
      activeAttach?.detach();
      clearAttach();
    };

    socket.on('message', (raw: Buffer) => {
      try {
        const decoded: unknown = JSON.parse(raw.toString());
        const parsed = terminalClientMessageSchema.safeParse(decoded);
        if (!parsed.success) {
          send({ type: 'error', message: 'Invalid websocket message' });
          return;
        }

        const message = parsed.data as TerminalClientMessage;

        if (message.type === 'attach') {
          detachCurrent();
          const session = context.sessions.getSession(message.sessionId);
          if (!session) {
            send({ type: 'status', sessionId: message.sessionId, status: 'unavailable', message: 'Session not found.' });
            return;
          }
          if (session.status !== 'running') {
            send({ type: 'status', sessionId: message.sessionId, status: 'stopped', message: 'Session is not running.' });
            return;
          }

          const attach = context.terminals.attach({ sessionId: message.sessionId, cols: message.cols, rows: message.rows }, send);
          if (attach) {
            activeAttach = attach;
            attachedSessionId = message.sessionId;
          }
          return;
        }

        if (!activeAttach || attachedSessionId !== message.sessionId) {
          send({ type: 'status', sessionId: message.sessionId, status: 'unavailable', message: 'Terminal is not attached.' });
          return;
        }

        if (message.type === 'input') {
          if (message.source || message.resetMode) activeAttach.sendInput(message.data, { source: message.source, resetMode: message.resetMode });
          else activeAttach.sendInput(message.data);
          return;
        }

        if (message.type === 'resize') {
          activeAttach.resize(message.cols, message.rows);
          return;
        }

        activeAttach.detach();
        clearAttach();
        send({ type: 'status', sessionId: message.sessionId, status: 'detached' });
      } catch (error) {
        send({ type: 'error', message: error instanceof SyntaxError ? 'Invalid JSON' : errorMessage(error) });
      }
    });

    socket.on('close', () => {
      detachCurrent();
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
