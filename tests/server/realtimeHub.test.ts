import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';
import { RealtimeHub } from '../../src/server/services/realtimeHub';

describe('RealtimeHub', () => {
  it('replays recent output when a client attaches', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    sessions.appendOutput(session.id, { role: 'assistant', text: 'hello' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];

    hub.attach(session.id, (message) => sent.push(message));

    expect(sent[0]).toMatchObject({
      type: 'attached',
      sessionId: session.id,
      replay: [expect.objectContaining({ text: 'hello' })],
    });
  });

  it('stores output and broadcasts parsed interactions', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.attach(session.id, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Do you want to allow this?');

    expect(sent.at(-1)).toMatchObject({
      type: 'output',
      sessionId: session.id,
      message: expect.objectContaining({ text: 'Do you want to allow this?' }),
      interaction: expect.objectContaining({ kind: 'permission' }),
    });
  });

  it('forwards text input to the runner and broadcasts the user message', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.attach(session.id, (message) => sent.push(message));

    hub.sendInput(session.id, '/help');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '/help');
    expect(sent.at(-1)).toMatchObject({
      type: 'output',
      sessionId: session.id,
      message: expect.objectContaining({ role: 'user', text: '/help' }),
      interaction: { kind: 'none', actions: [], raw: '' },
    });
  });

  it('continues broadcasting when one sender throws and removes the failed sender', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const throwingSender = vi.fn((message) => {
      if (message.type === 'output') throw new Error('client closed');
    });
    const received: unknown[] = [];
    const recordingSender = vi.fn((message) => received.push(message));
    hub.attach(session.id, throwingSender);
    hub.attach(session.id, recordingSender);

    expect(() => hub.handleOutput(session.id, 'hello')).not.toThrow();

    expect(received.at(-1)).toMatchObject({
      type: 'output',
      sessionId: session.id,
      message: expect.objectContaining({ text: 'hello' }),
    });
    expect((hub as any).clients.get(session.id).has(throwingSender)).toBe(false);
    expect((hub as any).clients.get(session.id).has(recordingSender)).toBe(true);
  });

  it('removes a session from clients when the last sender detaches', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, fakeRunner());

    const detach = hub.attach(session.id, vi.fn());
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

    expect(sessions.getRecentOutput(session.id)).toEqual([]);
  });

  it('resolves action input server-side before forwarding and broadcasting it', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);
    const sent: unknown[] = [];
    hub.attach(session.id, (message) => sent.push(message));

    hub.handleOutput(session.id, 'Choose:\n1. Yes\n2. No');
    hub.sendAction(session.id, 'choice-2');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '2');
    expect(sessions.getRecentOutput(session.id).at(-1)).toMatchObject({ role: 'user', text: '2' });
    expect(sent.at(-1)).toMatchObject({
      type: 'output',
      sessionId: session.id,
      message: expect.objectContaining({ role: 'user', text: '2' }),
      interaction: { kind: 'none', actions: [], raw: '' },
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

function fakeRunner() {
  return {
    sendInput: vi.fn(),
  };
}
