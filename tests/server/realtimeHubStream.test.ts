import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';
import { RealtimeHub } from '../../src/server/services/realtimeHub';

describe('RealtimeHub stream protocol', () => {
  it('sends a complete snapshot when a client subscribes', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    sessions.appendBlock(session.id, { kind: 'assistant', text: 'hello', status: 'final', source: 'live' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      sessionId: session.id,
      session: expect.objectContaining({ sessionId: session.id, lifecycle: 'stopped' }),
      blocks: [expect.objectContaining({ kind: 'assistant', text: 'hello' })],
    });
  });

  it('replays missing deltas for a recoverable reconnect sequence', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    hub.handleOutput(session.id, 'first');
    const firstSequence = sessions.getSnapshot(session.id).latestSequence;
    hub.handleOutput(session.id, 'second');
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id, afterSequence: firstSequence }, (message) => sent.push(message));

    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'snapshot' }));
    expect(sent.map((message) => (message as { type: string }).type)).toEqual(['block-added', 'activity-changed']);
    expect(sent[0]).toMatchObject({ type: 'block-added', sequence: firstSequence + 1, block: expect.objectContaining({ text: 'second' }) });
  });

  it('falls back to a fresh snapshot when reconnect sequence is stale', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    hub.handleOutput(session.id, 'latest');
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id, afterSequence: -1 }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      sessionId: session.id,
      blocks: [expect.objectContaining({ text: 'latest' })],
    });
  });

  it('broadcasts lifecycle deltas when status changes', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.broadcastStatus(session.id, 'running');
    hub.broadcastStatus(session.id, 'stopped');

    expect(lastMessage(sent, 'session-changed')).toMatchObject({
      type: 'session-changed',
      sessionId: session.id,
      patch: expect.objectContaining({ lifecycle: 'stopped' }),
    });
  });

  it('streams transient terminal activity without persisting transcript blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, '[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
    expect(lastMessage(sent, 'activity-changed')).toMatchObject({
      type: 'activity-changed',
      sessionId: session.id,
      activity: 'working',
    });
    expect(lastMessage(sent, 'block-added')).toBeUndefined();
  });

  it('emits structured interaction blocks and waiting-for-input session state', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Claude wants to run Bash\n1. Allow once\n2. Deny');

    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      block: expect.objectContaining({
        kind: 'interaction',
        interaction: expect.objectContaining({
          kind: 'choice',
          actions: [
            expect.objectContaining({ id: 'choice-1', input: '1', variant: 'allow' }),
            expect.objectContaining({ id: 'choice-2', input: '2', variant: 'deny' }),
          ],
        }),
      }),
    });
    expect(lastMessage(sent, 'session-changed')).toMatchObject({
      type: 'session-changed',
      sessionId: session.id,
      patch: expect.objectContaining({
        lifecycle: 'waiting-for-input',
        activity: 'idle',
        pendingInteraction: expect.objectContaining({ kind: 'choice' }),
      }),
    });
  });

  it('updates and finalizes a single streaming assistant block from redraw frames', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, '\rHel');
    hub.handleOutput(session.id, '\rHello');
    hub.handleOutput(session.id, 'Hello');

    expect(sent.filter((message) => (message as { type: string }).type === 'block-added')).toHaveLength(1);
    expect(lastMessage(sent, 'block-updated')).toMatchObject({
      type: 'block-updated',
      patch: { text: 'Hello' },
    });
    expect(lastMessage(sent, 'block-finalized')).toMatchObject({ type: 'block-finalized' });
    expect(sessions.getSnapshot(session.id).blocks).toEqual([expect.objectContaining({ text: 'Hello', status: 'final' })]);
  });

  it('keeps terminal echo and CRLF assistant output as separate durable blocks in PTY fallback mode', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    hub.subscribe({ sessionId: session.id }, () => undefined);

    hub.handleOutput(session.id, 'Fake Claude ready\r\n');
    hub.sendInput(session.id, 'hello');
    hub.handleOutput(session.id, 'hello\r\nEcho: hello\r\n');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([
      expect.objectContaining({ kind: 'assistant', text: 'Fake Claude ready', status: 'final', source: 'pty-fallback' }),
      expect.objectContaining({ kind: 'user', text: 'hello', status: 'final', source: 'pty-fallback' }),
      expect.objectContaining({ kind: 'assistant', text: 'Echo: hello', status: 'final', source: 'pty-fallback' }),
    ]);
  });

  it('streams structured assistant deltas through one durable block', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-started', messageId: 'msg-1', text: '' }));
    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hel' }));
    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hello' }));
    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'Hello' }));

    expect(sent.filter((message) => (message as { type: string }).type === 'block-added')).toHaveLength(1);
    expect(lastMessage(sent, 'block-updated')).toMatchObject({ type: 'block-updated', patch: { text: 'Hello' } });
    expect(lastMessage(sent, 'block-finalized')).toMatchObject({ type: 'block-finalized' });
    expect(sessions.getSnapshot(session.id).blocks).toEqual([expect.objectContaining({ kind: 'assistant', text: 'Hello', source: 'structured', status: 'final' })]);
  });

  it('does not turn PTY chrome into transcript blocks while structured events are active', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    hub.subscribe({ sessionId: session.id }, () => undefined);

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'Structured answer' }));
    hub.handleOutput(session.id, 'Opus 4.7 xhigh [░░░░░░░░░░░░░░░░] 0k/1000k (0%)');
    hub.handleOutput(session.id, 'This PTY text should not be durable');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([
      expect.objectContaining({ kind: 'assistant', text: 'Structured answer', source: 'structured' }),
    ]);
  });

  it('orders synchronous structured output after accepted user input', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    let hub: RealtimeHub;
    const runner = { sendInput: vi.fn((sessionId: string) => hub.handleClaudeEvent(sessionId, structuredEvent({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'sync reply' }))) };
    hub = new RealtimeHub(sessions, runner);
    hub.subscribe({ sessionId: session.id }, () => undefined);
    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'session-started' }));

    hub.sendInput(session.id, 'hello');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([
      expect.objectContaining({ kind: 'user', text: 'hello', source: 'structured' }),
      expect.objectContaining({ kind: 'assistant', text: 'sync reply', source: 'structured' }),
    ]);
  });

  it('keeps structured sessions accepting input after successful print-mode turn completion', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.broadcastStatus(session.id, 'running');
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'done' }));
    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'session-stopped', lifecycle: 'stopped' }));

    expect(sessions.getSession(session.id)?.status).toBe('running');
    expect(sessions.getSnapshot(session.id).session).toMatchObject({ lifecycle: 'idle', activity: 'idle', transcriptSource: 'structured' });
    expect(lastMessage(sent, 'session-changed')).toMatchObject({ patch: expect.objectContaining({ lifecycle: 'idle' }) });
  });

  it('includes CLI-like render state in snapshots for structured sessions', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hel' }));
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      render: expect.objectContaining({
        activeRegion: expect.objectContaining({ id: 'msg-1', kind: 'assistant', text: 'Hel', status: 'streaming' }),
        regions: [],
      }),
    });
  });

  it('broadcasts source metadata when structured source becomes active', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'done' }));

    expect(lastMessage(sent, 'session-changed')).toMatchObject({ patch: expect.objectContaining({ transcriptSource: 'structured' }) });
  });

  it('persists observed native identity and streams it without adding transcript blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'session-identity-observed', claudeSessionId: 'native-session-1' }));

    expect(sessions.getSession(session.id)?.claudeSessionId).toBe('native-session-1');
    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
    expect(lastMessage(sent, 'session-changed')).toMatchObject({
      type: 'session-changed',
      patch: expect.objectContaining({ claudeSessionId: 'native-session-1' }),
    });
  });

  it('includes known native identity in snapshots', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: 'native-session-1', title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      session: expect.objectContaining({ claudeSessionId: 'native-session-1' }),
    });
  });

  it('marks unavailable structured sources in render state before PTY fallback content', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'structured-source-unavailable', message: 'stream-json unavailable' }));

    expect(lastMessage(sent, 'render-changed')).toMatchObject({
      render: expect.objectContaining({
        transcriptSource: 'pty-fallback',
        transientStatus: expect.objectContaining({ label: 'stream-json unavailable' }),
      }),
    });
    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
  });

  it('marks unavailable structured sources as degraded fallback before PTY blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleClaudeEvent(session.id, structuredEvent({ type: 'structured-source-unavailable', message: 'stream-json unavailable' }));
    hub.handleOutput(session.id, 'fallback answer');

    expect(lastMessage(sent, 'session-changed')).toMatchObject({ patch: expect.objectContaining({ lifecycle: 'degraded-fallback' }) });
    expect(sessions.getSnapshot(session.id).session.transcriptSource).toBe('pty-fallback');
    expect(sessions.getSnapshot(session.id).blocks).toEqual([expect.objectContaining({ text: 'fallback answer', source: 'pty-fallback' })]);
  });
});

function lastMessage(messages: unknown[], type: string) {
  return [...messages].reverse().find((message): message is { type: string } => typeof message === 'object' && message !== null && 'type' in message && message.type === type);
}

function fakeRunner() {
  return {
    sendInput: vi.fn(),
  };
}

function structuredEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'assistant-message-completed',
    sessionId: 'session-1',
    messageId: 'msg-1',
    text: 'hello',
    source: 'structured',
    order: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as any;
}
