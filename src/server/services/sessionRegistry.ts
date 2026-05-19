import { randomUUID } from 'node:crypto';
import type {
  ClaudeSession,
  ConversationBlock,
  ConversationBlockKind,
  ConversationBlockSource,
  ConversationBlockStatus,
  ParsedInteraction,
  SessionActivity,
  SessionLifecycle,
  SessionSource,
  SessionStatus,
  SessionStreamEvent,
  SessionViewState,
} from '../../shared/types';
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

type BlockRow = {
  id: string;
  session_id: string;
  kind: ConversationBlockKind;
  text: string;
  sequence: number;
  status: ConversationBlockStatus;
  source: ConversationBlockSource;
  interaction_json: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  event_json: string;
};

type SessionViewRow = {
  lifecycle: SessionLifecycle;
  activity: SessionActivity;
  activity_label: string | null;
  pending_interaction_json: string | null;
  updated_at: string;
};

type AppendBlockInput = {
  kind: ConversationBlockKind;
  text: string;
  status: ConversationBlockStatus;
  source: ConversationBlockSource;
  interaction?: ParsedInteraction;
};

export class SessionRegistry {
  constructor(private readonly db: Db, private readonly eventLimit = 200) {}

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

  listRunningSessions(projectId: string): ClaudeSession[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions WHERE project_id = ? AND status = 'running' ORDER BY last_active_at DESC
    `).all(projectId) as SessionRow[];
    return rows.map(toSession);
  }

  stopRunningSessions(): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE sessions SET status = 'stopped', last_active_at = ? WHERE status = 'running'").run(now);
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
    this.updateSessionView(id, { lifecycle: status, activity: status === 'running' ? 'idle' : 'stopped' });
    return session;
  }

  updateSessionView(sessionId: string, patch: Partial<Pick<SessionViewState, 'lifecycle' | 'activity' | 'activityLabel' | 'pendingInteraction'>>): SessionViewState {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const current = this.getSessionViewRow(sessionId);
    const now = new Date().toISOString();
    const next = {
      lifecycle: patch.lifecycle ?? current?.lifecycle ?? (session.status === 'running' ? 'running' : session.status),
      activity: patch.activity ?? current?.activity ?? (session.status === 'running' ? 'idle' : 'stopped'),
      activityLabel: patch.activityLabel ?? current?.activity_label ?? null,
      pendingInteraction: patch.pendingInteraction ?? (current?.pending_interaction_json ? JSON.parse(current.pending_interaction_json) as ParsedInteraction : null),
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO session_view_state (session_id, lifecycle, activity, activity_label, pending_interaction_json, updated_at)
      VALUES (@sessionId, @lifecycle, @activity, @activityLabel, @pendingInteractionJson, @updatedAt)
      ON CONFLICT(session_id) DO UPDATE SET
        lifecycle = excluded.lifecycle,
        activity = excluded.activity,
        activity_label = excluded.activity_label,
        pending_interaction_json = excluded.pending_interaction_json,
        updated_at = excluded.updated_at
    `).run({
      sessionId,
      lifecycle: next.lifecycle,
      activity: next.activity,
      activityLabel: next.activityLabel,
      pendingInteractionJson: next.pendingInteraction ? JSON.stringify(next.pendingInteraction) : null,
      updatedAt: next.updatedAt,
    });

    return toSessionView(session, this.getSnapshot(sessionId).latestSequence, this.getSessionViewRow(sessionId) ?? undefined);
  }

  appendBlock(sessionId: string, input: AppendBlockInput): ConversationBlock {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const now = new Date().toISOString();
    const block: ConversationBlock = {
      id: randomUUID(),
      sessionId,
      kind: input.kind,
      text: input.text,
      sequence: this.nextSequence(sessionId),
      status: input.status,
      createdAt: now,
      updatedAt: now,
      source: input.source,
      interaction: input.interaction,
    };

    this.db.prepare(`
      INSERT INTO conversation_blocks (id, session_id, kind, text, sequence, status, source, interaction_json, created_at, updated_at)
      VALUES (@id, @sessionId, @kind, @text, @sequence, @status, @source, @interactionJson, @createdAt, @updatedAt)
    `).run({ ...block, interactionJson: block.interaction ? JSON.stringify(block.interaction) : null });

    return block;
  }

  updateBlock(sessionId: string, blockId: string, patch: Partial<Pick<ConversationBlock, 'text' | 'interaction' | 'updatedAt'>>): ConversationBlock {
    const current = this.getBlock(sessionId, blockId);
    if (!current) throw new Error('Block not found');
    const updated = { ...current, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
    this.db.prepare(`
      UPDATE conversation_blocks
      SET text = @text, interaction_json = @interactionJson, updated_at = @updatedAt
      WHERE session_id = @sessionId AND id = @id
    `).run({ ...updated, interactionJson: updated.interaction ? JSON.stringify(updated.interaction) : null });
    return updated;
  }

  finalizeBlock(sessionId: string, blockId: string): ConversationBlock {
    const current = this.getBlock(sessionId, blockId);
    if (!current) throw new Error('Block not found');
    const updated = { ...current, status: 'final' as const, updatedAt: new Date().toISOString() };
    this.db.prepare(`
      UPDATE conversation_blocks
      SET status = @status, updated_at = @updatedAt
      WHERE session_id = @sessionId AND id = @id
    `).run(updated);
    return updated;
  }

  appendStreamEvent(event: SessionStreamEvent): void {
    if (!('sequence' in event) || typeof event.sequence !== 'number') return;
    this.db.prepare(`
      INSERT OR REPLACE INTO stream_events (id, session_id, sequence, event_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), event.sessionId ?? '', event.sequence, JSON.stringify(event), new Date().toISOString());

    const oldRows = this.db.prepare(`
      SELECT id FROM stream_events
      WHERE session_id = ?
      ORDER BY sequence DESC
      LIMIT -1 OFFSET ?
    `).all(event.sessionId ?? '', this.eventLimit) as { id: string }[];

    for (const row of oldRows) {
      this.db.prepare('DELETE FROM stream_events WHERE id = ?').run(row.id);
    }
  }

  getEventsAfter(sessionId: string, sequence: number): SessionStreamEvent[] {
    const rows = this.db.prepare(`
      SELECT event_json FROM stream_events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC
    `).all(sessionId, sequence) as EventRow[];
    return rows.map((row) => JSON.parse(row.event_json) as SessionStreamEvent);
  }

  getSnapshot(sessionId: string): { session: SessionViewState; blocks: ConversationBlock[]; latestSequence: number } {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const blocks = this.getBlocks(sessionId);
    const latestSequence = Math.max(blocks.at(-1)?.sequence ?? 0, this.latestEventSequence(sessionId));
    return {
      session: toSessionView(session, latestSequence, this.getSessionViewRow(sessionId) ?? undefined),
      blocks,
      latestSequence,
    };
  }

  private getBlocks(sessionId: string): ConversationBlock[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversation_blocks WHERE session_id = ? ORDER BY sequence ASC
    `).all(sessionId) as BlockRow[];
    return rows.map(toBlock);
  }

  private getBlock(sessionId: string, blockId: string): ConversationBlock | null {
    const row = this.db.prepare('SELECT * FROM conversation_blocks WHERE session_id = ? AND id = ?').get(sessionId, blockId) as BlockRow | undefined;
    return row ? toBlock(row) : null;
  }

  private getSessionViewRow(sessionId: string): SessionViewRow | null {
    const row = this.db.prepare('SELECT * FROM session_view_state WHERE session_id = ?').get(sessionId) as SessionViewRow | undefined;
    return row ?? null;
  }

  private nextSequence(sessionId: string): number {
    return Math.max(this.latestBlockSequence(sessionId), this.latestEventSequence(sessionId)) + 1;
  }

  private latestBlockSequence(sessionId: string): number {
    const row = this.db.prepare('SELECT MAX(sequence) AS sequence FROM conversation_blocks WHERE session_id = ?').get(sessionId) as { sequence: number | null };
    return row.sequence ?? 0;
  }

  private latestEventSequence(sessionId: string): number {
    const row = this.db.prepare('SELECT MAX(sequence) AS sequence FROM stream_events WHERE session_id = ?').get(sessionId) as { sequence: number | null };
    return row.sequence ?? 0;
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

function toBlock(row: BlockRow): ConversationBlock {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    text: row.text,
    sequence: row.sequence,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    interaction: row.interaction_json ? JSON.parse(row.interaction_json) as ParsedInteraction : undefined,
  };
}

function toSessionView(session: ClaudeSession, latestSequence: number, view?: SessionViewRow): SessionViewState {
  return {
    sessionId: session.id,
    projectId: session.projectId,
    title: session.title,
    lifecycle: view?.lifecycle ?? (session.status === 'running' ? 'running' : session.status),
    activity: view?.activity ?? (session.status === 'running' ? 'idle' : 'stopped'),
    activityLabel: view?.activity_label ?? undefined,
    connection: 'connected',
    latestSequence,
    updatedAt: view?.updated_at ?? session.lastActiveAt,
    pendingInteraction: view?.pending_interaction_json ? JSON.parse(view.pending_interaction_json) as ParsedInteraction : null,
  };
}
