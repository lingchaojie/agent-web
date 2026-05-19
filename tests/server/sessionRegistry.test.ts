import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('stops running sessions left behind by a previous server process', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    registry.updateStatus(session.id, 'running');
    registry.stopRunningSessions();

    expect(registry.getSession(session.id)?.status).toBe('stopped');
  });

  it('persists native Claude session ids after app session creation', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    const updated = registry.updateClaudeSessionId(session.id, 'native-session-1');

    expect(updated).toMatchObject({ id: session.id, claudeSessionId: 'native-session-1' });
    expect(new SessionRegistry(db).getSession(session.id)?.claudeSessionId).toBe('native-session-1');
  });

  it('finds sessions by native Claude session id', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: 'native-session-1',
      title: 'New session',
    });

    expect(registry.findByClaudeSessionId('native-session-1')?.id).toBe(session.id);
    expect(registry.findByClaudeSessionId('missing')).toBeNull();
  });

  it('stores ordered conversation blocks for snapshots', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    registry.appendBlock(session.id, { kind: 'assistant', text: 'one', status: 'final', source: 'live' });
    registry.appendBlock(session.id, { kind: 'assistant', text: 'two', status: 'final', source: 'live' });
    registry.appendBlock(session.id, { kind: 'assistant', text: 'three', status: 'final', source: 'live' });

    expect(registry.getSnapshot(session.id).blocks.map((block) => block.text)).toEqual(['one', 'two', 'three']);
  });

  it('rejects conversation blocks for missing sessions', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);

    expect(() => registry.appendBlock('missing-session', { kind: 'assistant', text: 'orphan', status: 'final', source: 'live' })).toThrow('Session not found');
  });

  it('persists session view state in snapshots across registry instances', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    registry.updateSessionView(session.id, {
      lifecycle: 'waiting-for-input',
      activity: 'idle',
      pendingInteraction: { kind: 'choice', raw: 'Choose\n1. Yes', actions: [{ id: 'choice-1', label: 'Yes', input: '1', variant: 'allow' }] },
    });

    expect(new SessionRegistry(db).getSnapshot(session.id).session).toMatchObject({
      lifecycle: 'waiting-for-input',
      activity: 'idle',
      pendingInteraction: expect.objectContaining({ kind: 'choice' }),
    });
  });

  it('keeps existing local database data when opening with newer stream schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'webagent-db-'));
    const path = join(root, 'webagent.db');
    try {
      const first = createDatabase(path);
      first.prepare(`
        INSERT INTO projects (id, name, path, favorite, created_at, updated_at)
        VALUES ('project-1', 'Existing project', '/tmp/existing', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `).run();
      first.close();

      const reopened = createDatabase(path);
      expect(reopened.prepare('SELECT name FROM projects WHERE id = ?').get('project-1')).toEqual({ name: 'Existing project' });
      expect(reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_blocks'").get()).toEqual({ name: 'conversation_blocks' });
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds retained stream events per session', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db, 2);
    const session = registry.createSession({
      projectId: 'project-1',
      source: 'web-created',
      claudeSessionId: null,
      title: 'New session',
    });

    registry.appendStreamEvent({ type: 'activity-changed', sessionId: session.id, sequence: 1, activity: 'working' });
    registry.appendStreamEvent({ type: 'activity-changed', sessionId: session.id, sequence: 2, activity: 'idle' });
    registry.appendStreamEvent({ type: 'activity-changed', sessionId: session.id, sequence: 3, activity: 'working' });

    expect(registry.getEventsAfter(session.id, 0).map((event) => event.sequence)).toEqual([2, 3]);
  });
});
