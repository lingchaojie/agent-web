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
  TranscriptSource,
} from '../../shared/types';
import type { Db } from '../db';

type SessionRow = {
  id: string;
  project_id: string;
  source: SessionSource;
  claude_session_id: string | null;
  external_key: string | null;
  external_pane_id: string | null;
  external_cwd: string | null;
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
  transcript_source: TranscriptSource;
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
      external_key: null,
      external_pane_id: null,
      external_cwd: null,
      title: input.title,
      status: 'stopped',
      last_active_at: now,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO sessions (id, project_id, source, claude_session_id, external_key, external_pane_id, external_cwd, title, status, last_active_at, created_at)
      VALUES (@id, @project_id, @source, @claude_session_id, @external_key, @external_pane_id, @external_cwd, @title, @status, @last_active_at, @created_at)
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

  listExternalSessions(): ClaudeSession[] {
    const rows = this.db.prepare("SELECT * FROM sessions WHERE source = 'external-tmux' ORDER BY last_active_at DESC").all() as SessionRow[];
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

  findByClaudeSessionId(claudeSessionId: string): ClaudeSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE claude_session_id = ? ORDER BY last_active_at DESC LIMIT 1').get(claudeSessionId) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  findByExternalKey(externalKey: string): ClaudeSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE external_key = ? LIMIT 1').get(externalKey) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  updateClaudeSessionId(id: string, claudeSessionId: string): ClaudeSession {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET claude_session_id = ?, last_active_at = ? WHERE id = ?').run(claudeSessionId, now, id);
    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    return session;
  }

  upsertExternalSession(input: { projectId: string; externalKey: string; title: string; cwd: string; paneId: string; claudeSessionId?: string | null }): ClaudeSession {
    const now = new Date().toISOString();
    const existing = this.findByExternalKey(input.externalKey);
    if (!existing) {
      const row: SessionRow = {
        id: randomUUID(),
        project_id: input.projectId,
        source: 'external-tmux',
        claude_session_id: input.claudeSessionId ?? null,
        external_key: input.externalKey,
        external_pane_id: input.paneId,
        external_cwd: input.cwd,
        title: input.title,
        status: 'running',
        last_active_at: now,
        created_at: now,
      };
      this.db.prepare(`
        INSERT INTO sessions (id, project_id, source, claude_session_id, external_key, external_pane_id, external_cwd, title, status, last_active_at, created_at)
        VALUES (@id, @project_id, @source, @claude_session_id, @external_key, @external_pane_id, @external_cwd, @title, @status, @last_active_at, @created_at)
      `).run(row);
      this.updateSessionView(row.id, { lifecycle: 'running', activity: 'idle', transcriptSource: 'tmux-capture' });
      return this.getSession(row.id)!;
    }

    this.db.prepare(`
      UPDATE sessions
      SET project_id = @projectId,
          claude_session_id = @claudeSessionId,
          external_pane_id = @paneId,
          external_cwd = @cwd,
          title = @title,
          status = 'running',
          last_active_at = @now
      WHERE id = @id
    `).run({
      id: existing.id,
      projectId: input.projectId,
      claudeSessionId: input.claudeSessionId ?? existing.claudeSessionId,
      paneId: input.paneId,
      cwd: input.cwd,
      title: input.title,
      now,
    });
    this.updateSessionView(existing.id, { lifecycle: 'running', activity: 'idle', transcriptSource: 'tmux-capture' });
    return this.getSession(existing.id)!;
  }

  markExternalDisconnected(id: string): ClaudeSession {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE sessions SET status = 'stopped', last_active_at = ? WHERE id = ? AND source = 'external-tmux'").run(now, id);
    this.updateSessionView(id, { lifecycle: 'disconnected', activity: 'stopped', transcriptSource: 'tmux-capture' });
    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    return session;
  }

  updateTitle(id: string, title: string): ClaudeSession {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET title = ?, last_active_at = ? WHERE id = ?').run(title, now, id);
    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    this.updateSessionView(id, { lifecycle: session.status === 'running' ? 'running' : 'stopped' });
    return session;
  }

  updateStatus(id: string, status: SessionStatus): ClaudeSession {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET status = ?, last_active_at = ? WHERE id = ?').run(status, now, id);
    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    this.updateSessionView(id, { lifecycle: status, activity: status === 'running' ? 'idle' : 'stopped' });
    return session;
  }

  updateSessionView(sessionId: string, patch: Partial<Pick<SessionViewState, 'lifecycle' | 'activity' | 'activityLabel' | 'pendingInteraction' | 'transcriptSource'>>): SessionViewState {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const current = this.getSessionViewRow(sessionId);
    const now = new Date().toISOString();
    const next = {
      lifecycle: patch.lifecycle ?? current?.lifecycle ?? (session.status === 'running' ? 'running' : session.status),
      activity: patch.activity ?? current?.activity ?? (session.status === 'running' ? 'idle' : 'stopped'),
      activityLabel: patch.activityLabel ?? current?.activity_label ?? null,
      pendingInteraction: patch.pendingInteraction ?? (current?.pending_interaction_json ? JSON.parse(current.pending_interaction_json) as ParsedInteraction : null),
      transcriptSource: patch.transcriptSource ?? current?.transcript_source ?? 'pty-fallback',
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO session_view_state (session_id, lifecycle, activity, activity_label, pending_interaction_json, transcript_source, updated_at)
      VALUES (@sessionId, @lifecycle, @activity, @activityLabel, @pendingInteractionJson, @transcriptSource, @updatedAt)
      ON CONFLICT(session_id) DO UPDATE SET
        lifecycle = excluded.lifecycle,
        activity = excluded.activity,
        activity_label = excluded.activity_label,
        pending_interaction_json = excluded.pending_interaction_json,
        transcript_source = excluded.transcript_source,
        updated_at = excluded.updated_at
    `).run({
      sessionId,
      lifecycle: next.lifecycle,
      activity: next.activity,
      activityLabel: next.activityLabel,
      pendingInteractionJson: next.pendingInteraction ? JSON.stringify(next.pendingInteraction) : null,
      transcriptSource: next.transcriptSource,
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
    externalKey: row.external_key ?? undefined,
    externalPaneId: row.external_pane_id ?? undefined,
    externalCwd: row.external_cwd ?? undefined,
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
    transcriptSource: view?.transcript_source ?? 'pty-fallback',
    claudeSessionId: session.claudeSessionId,
    latestSequence,
    updatedAt: view?.updated_at ?? session.lastActiveAt,
    pendingInteraction: view?.pending_interaction_json ? JSON.parse(view.pending_interaction_json) as ParsedInteraction : null,
  };
}
