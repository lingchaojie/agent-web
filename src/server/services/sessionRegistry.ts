import { randomUUID } from 'node:crypto';
import type { ChatMessage, ClaudeSession, SessionSource, SessionStatus } from '../../shared/types';
import type { Db } from '../db';

type SessionRow = {
  id: string;
  project_id: string;
  source: SessionSource;
  claude_session_id: string | null;
  title: string;
  status: SessionStatus;
  last_active_at: string;
  created_at: string;
};

type OutputRow = {
  id: string;
  session_id: string;
  role: ChatMessage['role'];
  text: string;
  created_at: string;
};

export class SessionRegistry {
  constructor(private readonly db: Db, private readonly outputLimit = 200) {}

  createSession(input: {
    projectId: string;
    source: SessionSource;
    claudeSessionId: string | null;
    title: string;
  }): ClaudeSession {
    const now = new Date().toISOString();
    const row: SessionRow = {
      id: randomUUID(),
      project_id: input.projectId,
      source: input.source,
      claude_session_id: input.claudeSessionId,
      title: input.title,
      status: 'stopped',
      last_active_at: now,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO sessions (id, project_id, source, claude_session_id, title, status, last_active_at, created_at)
      VALUES (@id, @project_id, @source, @claude_session_id, @title, @status, @last_active_at, @created_at)
    `).run(row);

    return toSession(row);
  }

  listSessions(projectId: string): ClaudeSession[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions WHERE project_id = ? ORDER BY last_active_at DESC
    `).all(projectId) as SessionRow[];
    return rows.map(toSession);
  }

  getSession(id: string): ClaudeSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  updateStatus(id: string, status: SessionStatus): ClaudeSession {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET status = ?, last_active_at = ? WHERE id = ?').run(status, now, id);
    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    return session;
  }

  appendOutput(sessionId: string, input: { role: ChatMessage['role']; text: string }): ChatMessage {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: input.role,
      text: input.text,
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO recent_output (id, session_id, role, text, created_at)
      VALUES (@id, @sessionId, @role, @text, @createdAt)
    `).run(message);

    const oldRows = this.db.prepare(`
      SELECT id FROM recent_output
      WHERE session_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT -1 OFFSET ?
    `).all(sessionId, this.outputLimit) as { id: string }[];

    for (const row of oldRows) {
      this.db.prepare('DELETE FROM recent_output WHERE id = ?').run(row.id);
    }

    return message;
  }

  getRecentOutput(sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM recent_output WHERE session_id = ? ORDER BY created_at ASC, rowid ASC
    `).all(sessionId) as OutputRow[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      text: row.text,
      createdAt: row.created_at,
    }));
  }
}

function toSession(row: SessionRow): ClaudeSession {
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    claudeSessionId: row.claude_session_id,
    title: row.title,
    status: row.status,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  };
}
