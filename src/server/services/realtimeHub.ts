import type { ConversationBlock, ConversationBlockSource, PromptAction, SessionActivity, SessionLifecycle, SessionRenderState, SessionStreamEvent, WsServerMessage } from '../../shared/types';
import type { SessionRegistry } from './sessionRegistry';
import type { ClaudeSemanticEvent } from './claudeEventSource';
import { applyClaudeEventToRenderState, emptySessionRenderState } from '../../shared/sessionRender';
import { mapClaudeEventToSemantic } from './claudeSemanticMapper';
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
  private readonly structuredBlocks = new Map<string, Map<string, ConversationBlock>>();
  private readonly pendingEchoes = new Map<string, string>();
  private readonly sendingInput = new Set<string>();
  private readonly queuedEvents = new Map<string, ClaudeSemanticEvent[]>();
  private readonly transcriptSources = new Map<string, ConversationBlockSource>();
  private readonly renderStates = new Map<string, SessionRenderState>();

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
      render: this.renderStates.get(input.sessionId),
    });
    return detach;
  }

  handleOutput(sessionId: string, text: string): void {
    if (this.transcriptSources.get(sessionId) === 'structured') {
      const frame = classifyTerminalStreamFrame(text);
      if (frame.kind === 'activity') this.broadcastActivity(sessionId, frame.activity);
      return;
    }

    this.markTranscriptSource(sessionId, 'pty-fallback');
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
      const block = this.sessions.appendBlock(sessionId, { kind: frame.blockKind, text: frame.text, status: frame.status, source: 'pty-fallback', interaction });
      this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
    }

    if (interaction.kind === 'none') {
      this.broadcastActivity(sessionId, 'idle');
    } else {
      this.broadcastWaitingForInput(sessionId, interaction);
    }
  }

  sendInput(sessionId: string, text: string): void {
    this.deliverInput(sessionId, text);
  }

  sendAction(sessionId: string, actionId: string): void {
    const action = this.latestActions.get(sessionId)?.get(actionId);
    if (!action) throw new Error('Action not found');

    this.deliverInput(sessionId, action.input);
  }

  handleClaudeEvent(sessionId: string, event: ClaudeSemanticEvent): void {
    if (this.sendingInput.has(sessionId)) {
      const queued = this.queuedEvents.get(sessionId) ?? [];
      queued.push(event);
      this.queuedEvents.set(sessionId, queued);
      return;
    }
    this.applyClaudeEvent(sessionId, event);
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

  private broadcastActivity(sessionId: string, activity: SessionActivity, activityLabel?: string): void {
    this.activity.set(sessionId, activity);
    this.sessions.updateSessionView(sessionId, { activity, activityLabel });
    this.broadcastStreamEvent({ type: 'activity-changed', sessionId, sequence: this.nextEventSequence(sessionId), activity, activityLabel });
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
      block = this.sessions.appendBlock(sessionId, { kind: 'assistant', text, status: 'streaming', source: 'pty-fallback' });
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
    const source = this.transcriptSources.get(sessionId) === 'structured' ? 'structured' : 'pty-fallback';
    const block = this.sessions.appendBlock(sessionId, { kind: 'user', text, status: 'final', source });
    this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
  }

  private deliverInput(sessionId: string, text: string): void {
    this.sendingInput.add(sessionId);
    try {
      this.runner.sendInput(sessionId, text);
    } finally {
      this.sendingInput.delete(sessionId);
    }
    this.pendingEchoes.set(sessionId, text);
    this.broadcastUserMessage(sessionId, text);
    this.broadcastActivity(sessionId, 'working');
    this.flushQueuedEvents(sessionId);
  }

  private flushQueuedEvents(sessionId: string): void {
    const queued = this.queuedEvents.get(sessionId);
    if (!queued) return;
    this.queuedEvents.delete(sessionId);
    for (const event of queued) this.applyClaudeEvent(sessionId, event);
  }

  private applyClaudeEvent(sessionId: string, event: ClaudeSemanticEvent): void {
    if (event.type === 'session-identity-observed') {
      this.sessions.updateClaudeSessionId(sessionId, event.claudeSessionId);
      this.broadcastStreamEvent({ type: 'session-changed', sessionId, sequence: this.nextEventSequence(sessionId), patch: { claudeSessionId: event.claudeSessionId, updatedAt: event.createdAt } });
      return;
    }

    this.updateRenderState(sessionId, event);
    this.markTranscriptSource(sessionId, event.type === 'structured-source-unavailable' ? 'pty-fallback' : 'structured');
    const mapped = mapClaudeEventToSemantic(event);
    if (mapped.lifecycle) this.broadcastSessionPatch(sessionId, { lifecycle: mapped.lifecycle });
    if (mapped.activity) this.broadcastActivity(sessionId, mapped.activity.activity, mapped.activity.activityLabel);
    if (!mapped.block) return;

    const key = mapped.block.sourceEventId;
    if (key && mapped.block.status === 'streaming') {
      this.upsertStructuredBlock(sessionId, key, mapped.block);
      return;
    }
    if (key && this.structuredBlocks.get(sessionId)?.has(key)) {
      this.upsertStructuredBlock(sessionId, key, mapped.block);
      if (mapped.block.status === 'final') this.finalizeStructuredBlock(sessionId, key);
      return;
    }

    const block = this.sessions.appendBlock(sessionId, {
      kind: mapped.block.kind,
      text: mapped.block.text,
      status: mapped.block.status,
      source: mapped.block.source,
      interaction: mapped.block.interaction,
    });
    this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
    if (mapped.block.kind === 'interaction' && mapped.block.interaction) {
      this.latestActions.set(sessionId, new Map(mapped.block.interaction.actions.map((action) => [action.id, action])));
    }
  }

  private updateRenderState(sessionId: string, event: ClaudeSemanticEvent): void {
    const current = this.renderStates.get(sessionId) ?? emptySessionRenderState(sessionId);
    const render = applyClaudeEventToRenderState(current, event);
    this.renderStates.set(sessionId, render);
    this.broadcastStreamEvent({ type: 'render-changed', sessionId, sequence: this.nextEventSequence(sessionId), render });
  }

  private upsertStructuredBlock(sessionId: string, key: string, input: NonNullable<ReturnType<typeof mapClaudeEventToSemantic>['block']>): void {
    const blocks = this.structuredBlocks.get(sessionId) ?? new Map<string, ConversationBlock>();
    const existing = blocks.get(key);
    if (!existing) {
      const block = this.sessions.appendBlock(sessionId, { kind: input.kind, text: input.text, status: input.status, source: input.source, interaction: input.interaction });
      blocks.set(key, block);
      this.structuredBlocks.set(sessionId, blocks);
      this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
      return;
    }

    const updated = this.sessions.updateBlock(sessionId, existing.id, { text: input.text, interaction: input.interaction });
    blocks.set(key, updated);
    this.broadcastStreamEvent({ type: 'block-updated', sessionId, sequence: this.nextEventSequence(sessionId), blockId: updated.id, patch: { text: updated.text, interaction: updated.interaction, updatedAt: updated.updatedAt } });
  }

  private finalizeStructuredBlock(sessionId: string, key: string): void {
    const blocks = this.structuredBlocks.get(sessionId);
    const block = blocks?.get(key);
    if (!block) return;
    const finalized = this.sessions.finalizeBlock(sessionId, block.id);
    blocks?.delete(key);
    this.broadcastStreamEvent({ type: 'block-finalized', sessionId, sequence: this.nextEventSequence(sessionId), blockId: finalized.id });
  }

  private markTranscriptSource(sessionId: string, source: ConversationBlockSource): void {
    if (this.transcriptSources.get(sessionId) === source) return;
    this.transcriptSources.set(sessionId, source);
    if (source === 'structured' || source === 'pty-fallback') this.broadcastSessionPatch(sessionId, { transcriptSource: source });
  }

  private broadcastSessionPatch(sessionId: string, patch: Partial<Parameters<SessionRegistry['updateSessionView']>[1]>): void {
    this.sessions.updateSessionView(sessionId, patch);
    this.broadcastStreamEvent({ type: 'session-changed', sessionId, sequence: this.nextEventSequence(sessionId), patch });
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
