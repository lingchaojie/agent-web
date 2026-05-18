import type { PromptAction, WsServerMessage } from '../../shared/types';
import type { SessionRegistry } from './sessionRegistry';
import { parseInteraction } from './interactionParser';

type SendFn = (message: WsServerMessage) => void;

type InputRunner = {
  sendInput(sessionId: string, text: string): void;
};

export class RealtimeHub {
  private readonly clients = new Map<string, Set<SendFn>>();
  private readonly latestActions = new Map<string, Map<string, PromptAction>>();

  constructor(private readonly sessions: SessionRegistry, private readonly runner: InputRunner) {}

  attach(sessionId: string, send: SendFn): () => void {
    const session = this.sessions.getSession(sessionId);
    if (!session) {
      send({ type: 'error', sessionId, message: 'Session not found' });
      return () => undefined;
    }

    const clients = this.clients.get(sessionId) ?? new Set<SendFn>();
    clients.add(send);
    this.clients.set(sessionId, clients);

    send({
      type: 'attached',
      sessionId,
      status: session.status,
      replay: this.sessions.getRecentOutput(sessionId),
    });

    return () => {
      clients.delete(send);
      if (clients.size === 0) this.clients.delete(sessionId);
    };
  }

  handleOutput(sessionId: string, text: string): void {
    const message = this.sessions.appendOutput(sessionId, { role: 'assistant', text });
    const interaction = parseInteraction(text);
    this.latestActions.set(sessionId, new Map(interaction.actions.map((action) => [action.id, action])));
    this.broadcast(sessionId, { type: 'output', sessionId, message, interaction });
  }

  sendInput(sessionId: string, text: string): void {
    this.runner.sendInput(sessionId, text);
    this.broadcastUserMessage(sessionId, text);
  }

  sendAction(sessionId: string, actionId: string): void {
    const action = this.latestActions.get(sessionId)?.get(actionId);
    if (!action) throw new Error('Action not found');

    this.runner.sendInput(sessionId, action.input);
    this.broadcastUserMessage(sessionId, action.input);
  }

  broadcastStatus(sessionId: string, status: 'running' | 'stopped' | 'failed'): void {
    this.sessions.updateStatus(sessionId, status);
    this.broadcast(sessionId, { type: 'status', sessionId, status });
  }

  private broadcastUserMessage(sessionId: string, text: string): void {
    const message = this.sessions.appendOutput(sessionId, { role: 'user', text });
    this.broadcast(sessionId, {
      type: 'output',
      sessionId,
      message,
      interaction: { kind: 'none', actions: [], raw: '' },
    });
  }

  private broadcast(sessionId: string, message: WsServerMessage): void {
    const clients = this.clients.get(sessionId);
    if (!clients) return;

    for (const send of clients) {
      try {
        send(message);
      } catch {
        clients.delete(send);
      }
    }

    if (clients.size === 0) this.clients.delete(sessionId);
  }
}
