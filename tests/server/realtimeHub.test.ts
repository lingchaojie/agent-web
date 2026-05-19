import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { RealtimeHub } from '../../src/server/services/realtimeHub';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';

describe('RealtimeHub', () => {
  it('sends a snapshot when a client subscribes', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    sessions.appendBlock(session.id, { kind: 'assistant', text: 'hello', status: 'final', source: 'live' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];

    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      sessionId: session.id,
      blocks: [expect.objectContaining({ kind: 'assistant', text: 'hello' })],
    });
  });

  it('stores output and broadcasts parsed interaction blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Do you want to allow this?');

    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'interaction', text: 'Do you want to allow this?', interaction: expect.objectContaining({ kind: 'permission' }) }),
    });
    expect(lastMessage(sent, 'session-changed')).toMatchObject({
      type: 'session-changed',
      sessionId: session.id,
      patch: expect.objectContaining({ lifecycle: 'waiting-for-input', activity: 'idle', pendingInteraction: expect.objectContaining({ kind: 'permission' }) }),
    });
  });

  it('strips terminal control sequences before storing and broadcasting transcript blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, '[38;5;246mAll done[39m]0;title');

    expect(sessions.getSnapshot(session.id).blocks.at(-1)?.text).toBe('All done');
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      block: expect.objectContaining({ kind: 'assistant', text: 'All done' }),
    });
  });

  it('broadcasts transient terminal activity without persisting assistant blocks', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, '[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
    expect(lastMessage(sent, 'block-added')).toBeUndefined();
    expect(lastMessage(sent, 'activity-changed')).toMatchObject({
      type: 'activity-changed',
      sessionId: session.id,
      activity: 'working',
    });
  });

  it('does not replay transient terminal frames after reconnect', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());

    hub.handleOutput(session.id, '[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K');
    hub.handleOutput(session.id, 'Meaningful reply');

    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'snapshot',
      sessionId: session.id,
      blocks: [expect.objectContaining({ kind: 'assistant', text: 'Meaningful reply' })],
    });
  });

  it('forwards text input to the runner and broadcasts the user block', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.sendInput(session.id, '/help');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '/help');
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'user', text: '/help' }),
    });
  });

  it('continues broadcasting when one sender throws and removes the failed sender', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const throwingSender = vi.fn((message) => {
      if (message.type === 'block-added') throw new Error('client closed');
    });
    const received: unknown[] = [];
    const recordingSender = vi.fn((message) => received.push(message));
    hub.subscribe({ sessionId: session.id }, throwingSender);
    hub.subscribe({ sessionId: session.id }, recordingSender);

    expect(() => hub.handleOutput(session.id, 'hello')).not.toThrow();

    expect(lastMessage(received, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ text: 'hello' }),
    });
    expect((hub as any).clients.get(session.id).has(throwingSender)).toBe(false);
    expect((hub as any).clients.get(session.id).has(recordingSender)).toBe(true);
  });

  it('removes a session from clients when the last sender detaches', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());

    const detach = hub.subscribe({ sessionId: session.id }, vi.fn());
    detach();

    expect((hub as any).clients.has(session.id)).toBe(false);
  });

  it('does not persist user input when delivery to the runner fails', () => {
    const runner = fakeRunner();
    runner.sendInput.mockImplementation(() => {
      throw new Error('PTY not running');
    });
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);

    expect(() => hub.sendInput(session.id, '/help')).toThrow('PTY not running');

    expect(sessions.getSnapshot(session.id).blocks).toEqual([]);
  });

  it('resolves action input server-side before forwarding and broadcasting it', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Choose:\n1. Yes\n2. No');
    hub.sendAction(session.id, 'choice-2');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '2');
    expect(sessions.getSnapshot(session.id).blocks.at(-1)).toMatchObject({ kind: 'user', text: '2' });
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      sessionId: session.id,
      block: expect.objectContaining({ kind: 'user', text: '2' }),
    });
  });

  it('rejects unknown action ids without calling the runner', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);

    hub.handleOutput(session.id, 'Choose:\n1. Yes\n2. No');

    expect(() => hub.sendAction(session.id, 'choice-3')).toThrow('Action not found');
    expect(runner.sendInput).not.toHaveBeenCalled();
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
