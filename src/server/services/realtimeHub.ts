import type { ConversationBlock, PromptAction, SessionActivity, SessionLifecycle, SessionStreamEvent, WsServerMessage } from '../../shared/types';
import type { SessionRegistry } from './sessionRegistry';
import { parseInteraction } from './interactionParser';
import { classifyTerminalStreamFrame } from './terminalText';

type SendFn = (message: WsServerMessage) => void;

type InputRunner = {
  sendInput(sessionId: string, text: string): void;
};

export class RealtimeHub {
  private readonly clients = new Map<string, Set<SendFn>>();
  private readonly latestActions = new Map<string, Map<string, PromptAction>>();
  private readonly activity = new Map<string, SessionActivity>();
  private readonly streamingBlocks = new Map<string, ConversationBlock>();
  private readonly pendingEchoes = new Map<string, string>();

  constructor(private readonly sessions: SessionRegistry, private readonly runner: InputRunner) {}

  subscribe(input: { sessionId: string; afterSequence?: number }, send: SendFn): () => void {
    const session = this.sessions.getSession(input.sessionId);
    if (!session) {
      send({ type: 'error', sessionId: input.sessionId, message: 'Session not found' });
      return () => undefined;
    }

    const detach = this.addClient(input.sessionId, send);
    const afterSequence = input.afterSequence;
    if (typeof afterSequence === 'number' && afterSequence >= 0) {
      const events = this.sessions.getEventsAfter(input.sessionId, afterSequence);
      if (events.length > 0 && events[0].sequence === afterSequence + 1) {
        for (const event of events) send(event);
        return detach;
      }
    }

    const snapshot = this.sessions.getSnapshot(input.sessionId);
    send({
      type: 'snapshot',
      sessionId: input.sessionId,
      sequence: snapshot.latestSequence,
      session: snapshot.session,
      blocks: snapshot.blocks,
    });
    return detach;
  }

  handleOutput(sessionId: string, text: string): void {
    text = this.removePendingEcho(sessionId, text);
    const frame = classifyTerminalStreamFrame(text);
    if (frame.kind === 'empty') return;
    if (frame.kind === 'activity') {
      this.broadcastActivity(sessionId, frame.activity);
      return;
    }

    if (frame.kind === 'block-update') {
      this.updateStreamingBlock(sessionId, frame.text);
      return;
    }

    const finalizedBlock = this.finalizeStreamingBlock(sessionId, frame.text);
    const interaction = frame.interaction ?? parseInteraction(frame.text);
    this.latestActions.set(sessionId, new Map(interaction.actions.map((action) => [action.id, action])));

    if (!finalizedBlock) {
      const block = this.sessions.appendBlock(sessionId, { kind: frame.blockKind, text: frame.text, status: frame.status, source: 'live', interaction });
      this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
    }

    if (interaction.kind === 'none') {
      this.broadcastActivity(sessionId, 'idle');
    } else {
      this.broadcastWaitingForInput(sessionId, interaction);
    }
  }

  sendInput(sessionId: string, text: string): void {
    this.runner.sendInput(sessionId, text);
    this.pendingEchoes.set(sessionId, text);
    this.broadcastUserMessage(sessionId, text);
    this.broadcastActivity(sessionId, 'working');
  }

  sendAction(sessionId: string, actionId: string): void {
    const action = this.latestActions.get(sessionId)?.get(actionId);
    if (!action) throw new Error('Action not found');

    this.runner.sendInput(sessionId, action.input);
    this.pendingEchoes.set(sessionId, action.input);
    this.broadcastUserMessage(sessionId, action.input);
    this.broadcastActivity(sessionId, 'working');
  }

  broadcastStatus(sessionId: string, status: SessionLifecycle): void {
    const session = status === 'running' || status === 'stopped' || status === 'failed'
      ? this.sessions.updateStatus(sessionId, status)
      : this.sessions.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    this.sessions.updateSessionView(sessionId, { lifecycle: status, activity: status === 'running' ? 'idle' : status === 'stopping' ? 'working' : 'stopped' });
    const sequence = this.nextEventSequence(sessionId);
    this.broadcastStreamEvent({
      type: 'session-changed',
      sessionId,
      sequence,
      patch: { lifecycle: status, updatedAt: session.lastActiveAt },
    });
    if (status !== 'running' && status !== 'stopping') this.broadcastActivity(sessionId, 'stopped');
  }

  private broadcastActivity(sessionId: string, activity: SessionActivity): void {
    this.activity.set(sessionId, activity);
    this.broadcastStreamEvent({ type: 'activity-changed', sessionId, sequence: this.nextEventSequence(sessionId), activity });
  }

  private removePendingEcho(sessionId: string, text: string): string {
    const echo = this.pendingEchoes.get(sessionId);
    if (!echo) return text;

    const lines = text.split(/\r?\n/);
    const index = lines.findIndex((line) => line.trim() === echo);
    if (index === -1) return text;

    this.pendingEchoes.delete(sessionId);
    lines.splice(index, 1);
    return lines.join('\n');
  }

  private updateStreamingBlock(sessionId: string, text: string): void {
    let block = this.streamingBlocks.get(sessionId);
    if (!block) {
      block = this.sessions.appendBlock(sessionId, { kind: 'assistant', text, status: 'streaming', source: 'live' });
      this.streamingBlocks.set(sessionId, block);
      this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
      return;
    }

    block = this.sessions.updateBlock(sessionId, block.id, { text });
    this.streamingBlocks.set(sessionId, block);
    this.broadcastStreamEvent({ type: 'block-updated', sessionId, sequence: this.nextEventSequence(sessionId), blockId: block.id, patch: { text: block.text, updatedAt: block.updatedAt } });
  }

  private finalizeStreamingBlock(sessionId: string, text: string): ConversationBlock | null {
    const block = this.streamingBlocks.get(sessionId);
    if (!block) return null;

    const updated = block.text === text ? block : this.sessions.updateBlock(sessionId, block.id, { text });
    const finalized = this.sessions.finalizeBlock(sessionId, updated.id);
    this.streamingBlocks.delete(sessionId);
    this.broadcastStreamEvent({ type: 'block-finalized', sessionId, sequence: this.nextEventSequence(sessionId), blockId: finalized.id });
    return finalized;
  }

  private broadcastWaitingForInput(sessionId: string, interaction: NonNullable<ReturnType<typeof parseInteraction>>): void {
    this.activity.set(sessionId, 'idle');
    this.broadcastStreamEvent({
      type: 'session-changed',
      sessionId,
      sequence: this.nextEventSequence(sessionId),
      patch: { lifecycle: 'waiting-for-input', activity: 'idle', pendingInteraction: interaction },
    });
  }

  private broadcastUserMessage(sessionId: string, text: string): void {
    const block = this.sessions.appendBlock(sessionId, { kind: 'user', text, status: 'final', source: 'live' });
    this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
  }

  private addClient(sessionId: string, send: SendFn): () => void {
    const clients = this.clients.get(sessionId) ?? new Set<SendFn>();
    clients.add(send);
    this.clients.set(sessionId, clients);

    return () => {
      clients.delete(send);
      if (clients.size === 0) this.clients.delete(sessionId);
    };
  }

  private broadcastStreamEvent(event: SessionStreamEvent): void {
    this.sessions.appendStreamEvent(event);
    this.broadcast(event.sessionId ?? '', event);
  }

  private nextEventSequence(sessionId: string): number {
    return this.sessions.getSnapshot(sessionId).latestSequence + 1;
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
