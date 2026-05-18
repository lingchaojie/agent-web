import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';

describe('SessionRegistry', () => {
  it('creates sessions and updates status', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);

    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    expect(session.status).toBe('stopped');

    const running = registry.updateStatus(session.id, 'running');
    expect(running.status).toBe('running');

    const listed = registry.listSessions('project-1');
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(session.id);
  });

  it('stores and replays recent output with a bounded cache', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db, 2);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    registry.appendOutput(session.id, { role: 'assistant', text: 'one' });
    registry.appendOutput(session.id, { role: 'assistant', text: 'two' });
    registry.appendOutput(session.id, { role: 'assistant', text: 'three' });

    const replay = registry.getRecentOutput(session.id);
    expect(replay.map((message) => message.text)).toEqual(['two', 'three']);
  });

  it('rejects recent output for missing sessions', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);

    expect(() => registry.appendOutput('missing-session', { role: 'assistant', text: 'orphan' })).toThrow('Session not found');
    expect(registry.getRecentOutput('missing-session')).toEqual([]);
  });
});
