# Sync Local Claude CLI Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let mobile webagent discover, display, and control explicitly exposed local Claude Code CLI sessions running inside tmux while fixing history title and collapsible transcript rendering.

**Architecture:** Add focused backend services for Claude resume title reading and tmux pane attachment, extend shared session types for `external-tmux` and `tmux-capture`, and route tmux capture/input through the existing `SessionRegistry` + `RealtimeHub` WebSocket stream. Keep app-owned Claude sessions and historical resume behavior intact.

**Tech Stack:** TypeScript, Fastify, React, SQLite via better-sqlite3, Vitest, tmux CLI integration through injectable command runners.

---

## File structure

- `src/shared/types.ts`: extend source/status/transcript/source types for external tmux sessions and optional external metadata.
- `src/shared/sessionRender.ts`: no broad rewrite; keep existing render reducer and rely on history/render regions.
- `src/server/db.ts`: additive columns for external attachment metadata.
- `src/server/services/sessionRegistry.ts`: create/update/find external sessions, update titles, list running/external sessions.
- `src/server/services/claudeResumeTitleReader.ts`: read Claude native `history.jsonl` prompts and JSONL summaries to match `/resume` title behavior.
- `src/server/services/claudeSemanticMapper.ts`: preserve tool/thinking/tool_result content as collapsible tool/system blocks.
- `src/server/services/claudeHistoryReader.ts`: use resume-title reader and semantic mapper output for history titles/regions.
- `src/server/services/tmuxPaneDiscovery.ts`: parse tmux pane metadata and filter only explicitly exposed panes.
- `src/server/services/tmuxPaneAdapter.ts`: capture/diff panes and send keys after validation.
- `src/server/services/tmuxSessionSync.ts`: reconcile discovered panes with app sessions and publish capture changes.
- `src/server/services/realtimeHub.ts`: accept `tmux-capture` source and expose reusable output handling for tmux sync.
- `src/server/app.ts`: include optional tmux sync in route context.
- `src/server/index.ts`: instantiate tmux sync when configured and start polling.
- `src/server/routes/sessionRoutes.ts`: refresh external session discovery before listing and detach external sessions instead of killing them.
- `src/client/components/SessionList.tsx`: label external sessions clearly and use non-destructive button text.
- `src/client/components/ChatView.tsx`: support external source labels and disconnected/read-only wording.
- `src/client/components/SessionRenderSurface.tsx`: improve collapsed summaries for non-direct content.
- `src/client/components/MessageStream.tsx`: keep tool/system collapsible and label summaries consistently.
- `src/client/styles.css`: add source/status chip styling for tmux capture and external sessions.
- Tests under `tests/server`, `tests/shared`, and `tests/client` for every new behavior.

## Task 1: Add shared external session types and registry persistence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/services/sessionRegistry.ts`
- Test: `tests/server/sessionRegistry.test.ts`

- [ ] **Step 1: Write failing registry tests for external sessions**

Append these tests to `tests/server/sessionRegistry.test.ts` inside the existing `describe('SessionRegistry', () => { ... })` block:

```ts
  it('creates and updates external tmux sessions by attachment key', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);

    const session = registry.upsertExternalSession({
      projectId: 'project-1',
      externalKey: 'tmux:/tmp/tmux-1000/default:%12',
      title: 'tmux demo',
      cwd: '/tmp/demo',
      paneId: '%12',
    });

    expect(session).toMatchObject({
      projectId: 'project-1',
      source: 'external-tmux',
      title: 'tmux demo',
      status: 'running',
      externalKey: 'tmux:/tmp/tmux-1000/default:%12',
    });

    const updated = registry.upsertExternalSession({
      projectId: 'project-1',
      externalKey: 'tmux:/tmp/tmux-1000/default:%12',
      title: 'renamed tmux demo',
      cwd: '/tmp/demo',
      paneId: '%12',
    });

    expect(updated.id).toBe(session.id);
    expect(updated.title).toBe('renamed tmux demo');
    expect(registry.findByExternalKey('tmux:/tmp/tmux-1000/default:%12')?.id).toBe(session.id);
  });

  it('marks external tmux sessions disconnected without deleting transcript blocks', () => {
    const db = createDatabase(':memory:');
    const registry = new SessionRegistry(db);
    const session = registry.upsertExternalSession({
      projectId: 'project-1',
      externalKey: 'tmux:socket:%9',
      title: 'attached',
      cwd: '/tmp/demo',
      paneId: '%9',
    });
    registry.appendBlock(session.id, { kind: 'assistant', text: 'still here', status: 'final', source: 'tmux-capture' });

    const disconnected = registry.markExternalDisconnected(session.id);

    expect(disconnected.status).toBe('stopped');
    expect(registry.getSnapshot(session.id).session).toMatchObject({
      lifecycle: 'disconnected',
      activity: 'stopped',
      transcriptSource: 'tmux-capture',
    });
    expect(registry.getSnapshot(session.id).blocks.map((block) => block.text)).toEqual(['still here']);
  });
```

- [ ] **Step 2: Run registry tests to verify failure**

Run:

```bash
npm test -- tests/server/sessionRegistry.test.ts
```

Expected: FAIL with TypeScript/runtime errors for missing `upsertExternalSession`, `findByExternalKey`, `markExternalDisconnected`, `external-tmux`, and `tmux-capture`.

- [ ] **Step 3: Extend shared types**

In `src/shared/types.ts`, replace the source/status/source type definitions near the top with:

```ts
export type SessionSource = 'web-created' | 'claude-history' | 'external-tmux';
export type SessionStatus = 'running' | 'stopped' | 'failed';
export type SessionActivity = 'idle' | 'working' | 'stopped';
export type SessionLifecycle = 'running' | 'idle' | 'waiting-for-input' | 'stopping' | 'stopped' | 'failed' | 'degraded-fallback' | 'disconnected';
export type SessionConnection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type TranscriptSource = 'structured' | 'pty-fallback' | 'tmux-capture';
```

Update `ClaudeSession` to include optional external metadata:

```ts
export type ClaudeSession = {
  id: string;
  projectId: string;
  source: SessionSource;
  claudeSessionId: string | null;
  externalKey?: string;
  externalPaneId?: string;
  externalCwd?: string;
  title: string;
  status: SessionStatus;
  lastActiveAt: string;
  createdAt: string;
};
```

Update `ConversationBlockSource`:

```ts
export type ConversationBlockSource = 'live' | 'history' | 'structured' | 'pty-fallback' | 'tmux-capture';
```

- [ ] **Step 4: Add database columns**

In `src/server/db.ts`, after the existing `addColumnIfMissing(db, 'session_view_state', 'transcript_source', ...)` call, add:

```ts
  addColumnIfMissing(db, 'sessions', 'external_key', 'TEXT');
  addColumnIfMissing(db, 'sessions', 'external_pane_id', 'TEXT');
  addColumnIfMissing(db, 'sessions', 'external_cwd', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sessions_external_key_unique ON sessions(external_key) WHERE external_key IS NOT NULL');
```

- [ ] **Step 5: Implement registry methods**

In `src/server/services/sessionRegistry.ts`, update `SessionRow` with:

```ts
  external_key: string | null;
  external_pane_id: string | null;
  external_cwd: string | null;
```

Update `createSession` row construction to set the three new fields to `null`, and update the INSERT column list and values:

```sql
INSERT INTO sessions (id, project_id, source, claude_session_id, external_key, external_pane_id, external_cwd, title, status, last_active_at, created_at)
VALUES (@id, @project_id, @source, @claude_session_id, @external_key, @external_pane_id, @external_cwd, @title, @status, @last_active_at, @created_at)
```

Add these public methods inside `SessionRegistry`:

```ts
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

  findByExternalKey(externalKey: string): ClaudeSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE external_key = ? LIMIT 1').get(externalKey) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  markExternalDisconnected(id: string): ClaudeSession {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE sessions SET status = 'stopped', last_active_at = ? WHERE id = ? AND source = 'external-tmux'").run(now, id);
    const session = this.getSession(id);
    if (!session) throw new Error('Session not found');
    this.updateSessionView(id, { lifecycle: 'disconnected', activity: 'stopped', transcriptSource: 'tmux-capture' });
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
```

Update `toSession` to include:

```ts
    externalKey: row.external_key ?? undefined,
    externalPaneId: row.external_pane_id ?? undefined,
    externalCwd: row.external_cwd ?? undefined,
```

- [ ] **Step 6: Run registry tests**

Run:

```bash
npm test -- tests/server/sessionRegistry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/shared/types.ts src/server/db.ts src/server/services/sessionRegistry.ts tests/server/sessionRegistry.test.ts
git commit -m "Add external tmux session registry state"
```

## Task 2: Align history titles with Claude resume title source

**Files:**
- Create: `src/server/services/claudeResumeTitleReader.ts`
- Modify: `src/server/services/claudeHistoryReader.ts`
- Test: `tests/server/claudeResumeTitleReader.test.ts`
- Test: `tests/server/claudeHistoryReader.test.ts`

- [ ] **Step 1: Write failing tests for resume title reader**

Create `tests/server/claudeResumeTitleReader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeResumeTitleReader } from '../../src/server/services/claudeResumeTitleReader';

function tempClaudeDir(): string {
  return mkdtempSync(join(tmpdir(), 'claude-resume-title-'));
}

function writeJsonl(path: string, lines: unknown[]): void {
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

describe('ClaudeResumeTitleReader', () => {
  it('uses the latest Claude native history display for a project/session pair', () => {
    const claudeDir = tempClaudeDir();
    writeJsonl(join(claudeDir, 'history.jsonl'), [
      { project: '/tmp/demo', sessionId: 'session-1', display: 'old prompt', timestamp: 1000 },
      { project: '/tmp/demo', sessionId: 'session-1', display: 'new prompt', timestamp: 2000 },
      { project: '/tmp/other', sessionId: 'session-1', display: 'wrong project', timestamp: 3000 },
    ]);

    const reader = new ClaudeResumeTitleReader(claudeDir);

    expect(reader.titleFor({ projectPath: '/tmp/demo', sessionId: 'session-1', summary: 'Summary title' })).toBe('new prompt');
  });

  it('falls back to summary then untitled session when native history has no display', () => {
    const claudeDir = tempClaudeDir();
    writeJsonl(join(claudeDir, 'history.jsonl'), [
      { project: '/tmp/demo', sessionId: 'session-1', display: '', timestamp: 1000 },
    ]);
    const reader = new ClaudeResumeTitleReader(claudeDir);

    expect(reader.titleFor({ projectPath: '/tmp/demo', sessionId: 'session-1', summary: 'Summary title' })).toBe('Summary title');
    expect(reader.titleFor({ projectPath: '/tmp/demo', sessionId: 'missing', summary: '' })).toBe('Untitled session');
  });

  it('returns an empty title index when history.jsonl is missing or malformed', () => {
    const claudeDir = tempClaudeDir();
    mkdirSync(join(claudeDir, 'projects'));
    writeFileSync(join(claudeDir, 'history.jsonl'), '{bad json}\n');

    const reader = new ClaudeResumeTitleReader(claudeDir);

    expect(reader.titleFor({ projectPath: '/tmp/demo', sessionId: 'missing', summary: 'Fallback' })).toBe('Fallback');
  });
});
```

- [ ] **Step 2: Run title reader test to verify failure**

Run:

```bash
npm test -- tests/server/claudeResumeTitleReader.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement ClaudeResumeTitleReader**

Create `src/server/services/claudeResumeTitleReader.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type HistoryEntry = {
  project?: string;
  sessionId?: string;
  display?: string;
  timestamp?: number;
};

export class ClaudeResumeTitleReader {
  constructor(private readonly claudeConfigDir: string) {}

  titleFor(input: { projectPath: string | null; sessionId: string; summary?: string }): string {
    const native = input.projectPath ? this.nativeDisplay(input.projectPath, input.sessionId) : null;
    const summary = input.summary?.trim();
    return native ?? (summary || 'Untitled session');
  }

  private nativeDisplay(projectPath: string, sessionId: string): string | null {
    const historyPath = join(this.claudeConfigDir, 'history.jsonl');
    if (!existsSync(historyPath)) return null;
    try {
      const stat = statSync(historyPath);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return null;
      let best: { display: string; timestamp: number } | null = null;
      for (const line of readFileSync(historyPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const parsed = parseLine(line);
        if (!parsed || parsed.project !== projectPath || parsed.sessionId !== sessionId) continue;
        const display = parsed.display?.trim();
        if (!display) continue;
        const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
        if (!best || timestamp >= best.timestamp) best = { display, timestamp };
      }
      return best?.display ?? null;
    } catch {
      return null;
    }
  }
}

function parseLine(line: string): HistoryEntry | null {
  try {
    return JSON.parse(line) as HistoryEntry;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Update history reader to use title reader**

In `src/server/services/claudeHistoryReader.ts`:

1. Add import:

```ts
import { ClaudeResumeTitleReader } from './claudeResumeTitleReader';
```

2. Change `readClaudeHistory` signature:

```ts
export function readClaudeHistory(projectsRoot: string, options: { claudeConfigDir?: string } = {}): HistorySession[] {
```

3. Before scanning sessions, create:

```ts
  const titleReader = options.claudeConfigDir ? new ClaudeResumeTitleReader(options.claudeConfigDir) : null;
```

4. Change `readTranscript(projectKey, transcriptPath)` calls to:

```ts
          const session = readTranscript(projectKey, transcriptPath, titleReader);
```

5. Change `readClaudeTranscriptWindow` signature:

```ts
export function readClaudeTranscriptWindow(projectsRoot: string, input: { sessionId: string; limit?: number; before?: string; claudeConfigDir?: string }): TranscriptWindow | null {
```

6. Change its `readTranscript` call to:

```ts
  const session = readTranscript(located.projectKey, located.transcriptPath, input.claudeConfigDir ? new ClaudeResumeTitleReader(input.claudeConfigDir) : null);
```

7. Change `readTranscript` signature:

```ts
function readTranscript(projectKey: string, transcriptPath: string, titleReader: ClaudeResumeTitleReader | null): HistorySession | null {
```

8. Track summary separately:

```ts
    let summary = '';
```

Replace:

```ts
      if (parsed.type === 'summary' && parsed.summary) title = parsed.summary;
```

with:

```ts
      if (parsed.type === 'summary' && parsed.summary) summary = parsed.summary;
```

9. Before returning, compute:

```ts
    title = titleReader?.titleFor({ projectPath: cwd ?? projectKeyToPath(projectKey), sessionId, summary }) ?? (summary || title);
```

- [ ] **Step 5: Pass config through history routes**

In `src/server/routes/historyRoutes.ts`, update calls:

```ts
  return readClaudeHistory(projectsRoot(context), { claudeConfigDir: context.config.claudeConfigDir })
```

and:

```ts
    const window = readClaudeTranscriptWindow(projectsRoot(context), { sessionId: params.sessionId, limit: parseLimit(query.limit), before: query.before, claudeConfigDir: context.config.claudeConfigDir });
```

and:

```ts
    const window = readClaudeTranscriptWindow(projectsRoot(context), { sessionId: session.claudeSessionId, limit: parseLimit(query.limit), before: query.before, claudeConfigDir: context.config.claudeConfigDir });
```

- [ ] **Step 6: Add history reader test for native title override**

Append to `tests/server/claudeHistoryReader.test.ts`:

```ts
  it('uses Claude native resume history display before JSONL summary titles', () => {
    const claudeDir = createTempHistoryRoot();
    const projectsRoot = join(claudeDir, 'projects');
    const projectDir = join(projectsRoot, '-tmp-demo');
    mkdirSync(projectDir, { recursive: true });
    writeTranscript(projectDir, 'resume-title-session', [
      { type: 'summary', summary: 'JSONL summary title', timestamp: '2026-05-18T19:00:00.000Z' },
      { type: 'assistant', timestamp: '2026-05-18T19:01:00.000Z', cwd: '/tmp/demo', message: { role: 'assistant', content: 'Done.' } },
    ]);
    writeTranscript(claudeDir, 'history', []);
    writeFileSync(join(claudeDir, 'history.jsonl'), `${JSON.stringify({ project: '/tmp/demo', sessionId: 'resume-title-session', display: 'Native /resume title', timestamp: 1234 })}\n`);

    expect(readClaudeHistory(projectsRoot, { claudeConfigDir: claudeDir })[0].title).toBe('Native /resume title');
    expect(readClaudeTranscriptWindow(projectsRoot, { sessionId: 'resume-title-session', claudeConfigDir: claudeDir })?.title).toBe('Native /resume title');
  });
```

If the helper `writeTranscript` only writes JSONL files with the provided session id, the `writeTranscript(claudeDir, 'history', [])` line creates an unnecessary `history.jsonl`; remove that line before running and keep the explicit `writeFileSync(join(claudeDir, 'history.jsonl'), ...)`.

- [ ] **Step 7: Run title/history tests**

Run:

```bash
npm test -- tests/server/claudeResumeTitleReader.test.ts tests/server/claudeHistoryReader.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/server/services/claudeResumeTitleReader.ts src/server/services/claudeHistoryReader.ts src/server/routes/historyRoutes.ts tests/server/claudeResumeTitleReader.test.ts tests/server/claudeHistoryReader.test.ts
git commit -m "Align history titles with Claude resume display"
```

## Task 3: Preserve collapsible non-direct history content

**Files:**
- Modify: `src/server/services/claudeSemanticMapper.ts`
- Modify: `src/client/components/SessionRenderSurface.tsx`
- Modify: `src/client/components/MessageStream.tsx`
- Test: `tests/server/claudeSemanticMapper.test.ts`
- Test: `tests/server/claudeHistoryReader.test.ts`
- Test: `tests/client/MessageStream.test.tsx`

- [ ] **Step 1: Write mapper tests for non-direct content**

Append to `tests/server/claudeSemanticMapper.test.ts`:

```ts
  it('maps history tool use, tool result, and thinking into collapsible non-direct blocks', () => {
    expect(mapClaudeJsonlEntryToSemantic({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'considering' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    })).toEqual([
      expect.objectContaining({ kind: 'system', text: 'Thinking\nconsidering' }),
      expect.objectContaining({ kind: 'tool', text: 'Bash\nnpm test' }),
    ]);

    expect(mapClaudeJsonlEntryToSemantic({
      type: 'user',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'passed' }] },
    })).toEqual([
      expect.objectContaining({ kind: 'tool', text: 'Tool result\npassed' }),
    ]);
  });
```

- [ ] **Step 2: Update history reader test expectation**

In `tests/server/claudeHistoryReader.test.ts`, replace the test named `keeps internal history transcript parts out of visible blocks` with:

```ts
  it('keeps non-direct history transcript parts as collapsible blocks', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-kinds');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'kind-session', [
      { type: 'system', timestamp: '2026-05-18T14:59:00.000Z', content: 'System notice' },
      { type: 'user', timestamp: '2026-05-18T15:00:00.000Z', message: { role: 'user', content: 'Run tests' } },
      { type: 'assistant', timestamp: '2026-05-18T15:01:00.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'I will run the tests.' }] } },
      { type: 'assistant', timestamp: '2026-05-18T15:02:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
      { type: 'user', timestamp: '2026-05-18T15:03:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'All tests passed.' }] } },
    ]);

    expect(readClaudeHistory(root)[0].blocks).toEqual([
      expect.objectContaining({ kind: 'system', text: 'System notice' }),
      expect.objectContaining({ kind: 'user', text: 'Run tests' }),
      expect.objectContaining({ kind: 'system', text: 'Thinking\nprivate reasoning' }),
      expect.objectContaining({ kind: 'assistant', text: 'I will run the tests.' }),
      expect.objectContaining({ kind: 'tool', text: 'Bash\nnpm test' }),
      expect.objectContaining({ kind: 'tool', text: 'Tool result\nAll tests passed.' }),
    ]);
  });
```

- [ ] **Step 3: Run mapper/history tests to verify failure**

Run:

```bash
npm test -- tests/server/claudeSemanticMapper.test.ts tests/server/claudeHistoryReader.test.ts
```

Expected: FAIL because tool/thinking parts are currently dropped.

- [ ] **Step 4: Implement semantic mapping for non-direct parts**

In `src/server/services/claudeSemanticMapper.ts`, replace `extractContentPart` with:

```ts
function extractContentPart(role: string | undefined, part: unknown, entry: ClaudeJsonlEntry): SemanticBlockPart[] {
  if (!part || typeof part !== 'object') return [];
  const type = 'type' in part && typeof part.type === 'string' ? part.type : '';

  if (type === 'tool_use') {
    const name = 'name' in part && typeof part.name === 'string' ? part.name : 'Tool';
    const input = 'input' in part ? part.input : undefined;
    return textToBlockParts('tool', toolText(name, input), entry);
  }

  if (type === 'tool_result') {
    const content = 'content' in part ? part.content : '';
    return textToBlockParts('tool', ['Tool result', extractText(content)].filter(Boolean).join('\n'), entry);
  }

  if (type === 'thinking') {
    const thinking = 'thinking' in part && typeof part.thinking === 'string' ? part.thinking : extractText(part);
    return textToBlockParts('system', ['Thinking', thinking].filter(Boolean).join('\n'), entry);
  }

  const kind = messageRoleToBlockKind(role);
  if (!kind) return [];
  return textToBlockParts(kind, extractText(part), entry);
}
```

- [ ] **Step 5: Improve collapsed summaries**

In `src/client/components/SessionRenderSurface.tsx`, replace the tool branch summary calculation:

```ts
    const title = region.text.split(/\r?\n/)[0]?.trim() || 'Tool';
```

with:

```ts
    const title = collapsedRegionTitle(region.kind, region.text);
```

Add helper functions near the bottom:

```ts
function collapsedRegionTitle(kind: RenderRegion['kind'], text: string): string {
  const first = text.split(/\r?\n/)[0]?.trim();
  if (kind === 'tool') return first ? `工具调用 · ${first}` : '工具调用';
  if (kind === 'system') return first ? `系统信息 · ${first}` : '系统信息';
  return first || kind;
}
```

In `src/client/components/MessageStream.tsx`, update `MessageBlock` so both tool and system blocks use `<details>`:

```tsx
function MessageBlock({ block }: { block: ConversationBlock }) {
  if (block.kind === 'tool' || block.kind === 'system') {
    return (
      <details className={`message-bubble ${block.kind} tool-message`} data-block-kind={block.kind} data-block-status={block.status}>
        <summary>
          <span>{collapsedBlockLabel(block.kind, block.text)}</span>
          <time dateTime={block.createdAt}>{formatTime(block.createdAt)}</time>
        </summary>
        <pre>{block.text}</pre>
      </details>
    );
  }

  return (
    <article className={`message-bubble ${block.kind}`} data-block-kind={block.kind} data-block-status={block.status}>
      <header>
        <span>{block.kind}</span>
        <time dateTime={block.createdAt}>{formatTime(block.createdAt)}</time>
      </header>
      <pre>{block.text}</pre>
    </article>
  );
}

function collapsedBlockLabel(kind: ConversationBlock['kind'], text: string): string {
  const name = text.split(/\r?\n/)[0]?.trim();
  if (kind === 'tool') return name ? `工具调用 · ${name}` : toolOutputLabel(text);
  if (kind === 'system') return name ? `系统信息 · ${name}` : '系统信息';
  return name || kind;
}
```

Remove the old `typedToolOutputLabel` helper.

- [ ] **Step 6: Add client render test for system collapse**

Append to `tests/client/MessageStream.test.tsx`:

```tsx
  it('renders system and tool blocks as collapsed details', () => {
    const blocks = [
      block({ id: 'system-1', kind: 'system', text: 'Thinking\nprivate reasoning' }),
      block({ id: 'tool-1', kind: 'tool', text: 'Bash\nnpm test' }),
    ];

    const { container } = render(<MessageStream blocks={blocks} />);

    expect(container.querySelectorAll('details.message-bubble')).toHaveLength(2);
    expect(screen.getByText('系统信息 · Thinking')).toBeInTheDocument();
    expect(screen.getByText('工具调用 · Bash')).toBeInTheDocument();
  });
```

Use the existing local block helper in that file; if it does not accept overrides, update it to accept `Partial<ConversationBlock>`.

- [ ] **Step 7: Run non-direct rendering tests**

Run:

```bash
npm test -- tests/server/claudeSemanticMapper.test.ts tests/server/claudeHistoryReader.test.ts tests/client/MessageStream.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/server/services/claudeSemanticMapper.ts src/client/components/SessionRenderSurface.tsx src/client/components/MessageStream.tsx tests/server/claudeSemanticMapper.test.ts tests/server/claudeHistoryReader.test.ts tests/client/MessageStream.test.tsx
git commit -m "Render non-direct Claude history as collapsible content"
```

## Task 4: Add tmux pane discovery and adapter services

**Files:**
- Create: `src/server/services/tmuxPaneDiscovery.ts`
- Create: `src/server/services/tmuxPaneAdapter.ts`
- Test: `tests/server/tmuxPaneDiscovery.test.ts`
- Test: `tests/server/tmuxPaneAdapter.test.ts`

- [ ] **Step 1: Write discovery tests**

Create `tests/server/tmuxPaneDiscovery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTmuxPaneList, exposedTmuxPanes, tmuxExternalKey } from '../../src/server/services/tmuxPaneDiscovery';

const formatLine = [
  '%12',
  'main',
  'claude',
  'webagent',
  '/tmp/demo',
  '1',
  '/tmp/tmux-1000/default',
].join('\t');

describe('tmuxPaneDiscovery', () => {
  it('parses tab-separated tmux pane metadata', () => {
    expect(parseTmuxPaneList(`${formatLine}\n`)).toEqual([
      {
        paneId: '%12',
        sessionName: 'main',
        windowName: 'claude',
        paneTitle: 'webagent',
        cwd: '/tmp/demo',
        exposedFlag: '1',
        socketPath: '/tmp/tmux-1000/default',
      },
    ]);
  });

  it('keeps only explicitly exposed panes', () => {
    const panes = parseTmuxPaneList([
      formatLine,
      ['%13', 'main', 'shell', 'bash', '/tmp/demo', '0', '/tmp/tmux-1000/default'].join('\t'),
      ['%14', 'main', 'webagent-claude', 'bash', '/tmp/demo', '', '/tmp/tmux-1000/default'].join('\t'),
    ].join('\n'));

    expect(exposedTmuxPanes(panes).map((pane) => pane.paneId)).toEqual(['%12', '%14']);
  });

  it('builds stable external keys from socket and pane identity', () => {
    const pane = parseTmuxPaneList(`${formatLine}\n`)[0];

    expect(tmuxExternalKey(pane)).toBe('tmux:/tmp/tmux-1000/default:main:claude:%12');
  });
});
```

- [ ] **Step 2: Write adapter tests**

Create `tests/server/tmuxPaneAdapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TmuxPaneAdapter, diffPaneCapture } from '../../src/server/services/tmuxPaneAdapter';
import type { TmuxPane } from '../../src/server/services/tmuxPaneDiscovery';

const pane: TmuxPane = {
  paneId: '%12',
  sessionName: 'main',
  windowName: 'claude',
  paneTitle: 'webagent',
  cwd: '/tmp/demo',
  exposedFlag: '1',
  socketPath: '/tmp/tmux-1000/default',
};

describe('tmuxPaneAdapter', () => {
  it('diffs appended pane capture text', () => {
    expect(diffPaneCapture('hello', 'hello\nworld')).toBe('world');
    expect(diffPaneCapture('', 'first')).toBe('first');
    expect(diffPaneCapture('old content', 'new screen')).toBe('new screen');
  });

  it('captures panes and sends keys through injected command runner', async () => {
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'tmux' && args.includes('capture-pane')) return 'captured output';
      return '';
    });
    const adapter = new TmuxPaneAdapter({ run });

    await expect(adapter.capture(pane)).resolves.toBe('captured output');
    await adapter.sendInput(pane, 'hello');

    expect(run).toHaveBeenCalledWith('tmux', ['-S', '/tmp/tmux-1000/default', 'capture-pane', '-p', '-J', '-t', '%12']);
    expect(run).toHaveBeenCalledWith('tmux', ['-S', '/tmp/tmux-1000/default', 'send-keys', '-t', '%12', 'hello', 'Enter']);
  });
});
```

- [ ] **Step 3: Run tmux service tests to verify failure**

Run:

```bash
npm test -- tests/server/tmuxPaneDiscovery.test.ts tests/server/tmuxPaneAdapter.test.ts
```

Expected: FAIL because services do not exist.

- [ ] **Step 4: Implement tmuxPaneDiscovery**

Create `src/server/services/tmuxPaneDiscovery.ts`:

```ts
export type TmuxPane = {
  paneId: string;
  sessionName: string;
  windowName: string;
  paneTitle: string;
  cwd: string;
  exposedFlag: string;
  socketPath: string;
};

export function parseTmuxPaneList(output: string): TmuxPane[] {
  return output.split('\n').map((line) => line.trimEnd()).filter(Boolean).map((line) => {
    const [paneId, sessionName, windowName, paneTitle, cwd, exposedFlag, socketPath] = line.split('\t');
    return { paneId, sessionName, windowName, paneTitle, cwd, exposedFlag, socketPath };
  }).filter((pane) => pane.paneId && pane.cwd);
}

export function exposedTmuxPanes(panes: TmuxPane[]): TmuxPane[] {
  return panes.filter((pane) => pane.exposedFlag === '1' || markerText(pane).includes('webagent'));
}

export function tmuxExternalKey(pane: TmuxPane): string {
  return `tmux:${pane.socketPath}:${pane.sessionName}:${pane.windowName}:${pane.paneId}`;
}

export function tmuxListPanesArgs(): string[] {
  return ['list-panes', '-a', '-F', '#{pane_id}\t#{session_name}\t#{window_name}\t#{pane_title}\t#{pane_current_path}\t#{pane_env_WEBAGENT_EXPOSE}\t#{socket_path}'];
}

function markerText(pane: TmuxPane): string {
  return `${pane.sessionName} ${pane.windowName} ${pane.paneTitle}`.toLowerCase();
}
```

- [ ] **Step 5: Implement tmuxPaneAdapter**

Create `src/server/services/tmuxPaneAdapter.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TmuxPane } from './tmuxPaneDiscovery';

const execFileAsync = promisify(execFile);

type RunCommand = (command: string, args: string[]) => Promise<string>;

export class TmuxPaneAdapter {
  constructor(private readonly options: { run?: RunCommand } = {}) {}

  async capture(pane: TmuxPane): Promise<string> {
    return this.run('tmux', socketArgs(pane, ['capture-pane', '-p', '-J', '-t', pane.paneId]));
  }

  async sendInput(pane: TmuxPane, text: string): Promise<void> {
    await this.run('tmux', socketArgs(pane, ['send-keys', '-t', pane.paneId, text, 'Enter']));
  }

  private async run(command: string, args: string[]): Promise<string> {
    if (this.options.run) return this.options.run(command, args);
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
    return stdout;
  }
}

export function diffPaneCapture(previous: string, next: string): string {
  if (!previous) return next.trim();
  if (next.startsWith(previous)) return next.slice(previous.length).trim();
  const previousLines = previous.split('\n');
  const nextLines = next.split('\n');
  let overlap = 0;
  const max = Math.min(previousLines.length, nextLines.length);
  for (let size = 1; size <= max; size += 1) {
    if (previousLines.slice(-size).join('\n') === nextLines.slice(0, size).join('\n')) overlap = size;
  }
  return overlap > 0 ? nextLines.slice(overlap).join('\n').trim() : next.trim();
}

function socketArgs(pane: TmuxPane, args: string[]): string[] {
  return pane.socketPath ? ['-S', pane.socketPath, ...args] : args;
}
```

- [ ] **Step 6: Run tmux service tests**

Run:

```bash
npm test -- tests/server/tmuxPaneDiscovery.test.ts tests/server/tmuxPaneAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/server/services/tmuxPaneDiscovery.ts src/server/services/tmuxPaneAdapter.ts tests/server/tmuxPaneDiscovery.test.ts tests/server/tmuxPaneAdapter.test.ts
git commit -m "Add tmux pane discovery and adapter"
```

## Task 5: Reconcile exposed tmux panes into live webagent sessions

**Files:**
- Create: `src/server/services/tmuxSessionSync.ts`
- Modify: `src/server/services/realtimeHub.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/routes/sessionRoutes.ts`
- Test: `tests/server/tmuxSessionSync.test.ts`
- Test: `tests/server/realtimeHub.test.ts`
- Test: `tests/server/appRoutes.test.ts`

- [ ] **Step 1: Add RealtimeHub test for tmux capture source**

Append to `tests/server/realtimeHub.test.ts`:

```ts
  it('stores tmux capture output with tmux transcript source', () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: 'tmux:socket:%1', title: 'tmux', cwd: '/tmp/demo', paneId: '%1' });
    const hub = new RealtimeHub(sessions, fakeRunner());
    const sent: unknown[] = [];
    hub.subscribe({ sessionId: session.id }, (message) => sent.push(message));

    hub.handleTmuxCapture(session.id, 'hello from tmux');

    expect(sessions.getSnapshot(session.id).session.transcriptSource).toBe('tmux-capture');
    expect(lastMessage(sent, 'block-added')).toMatchObject({
      type: 'block-added',
      block: expect.objectContaining({ source: 'tmux-capture', text: 'hello from tmux' }),
    });
  });
```

- [ ] **Step 2: Write tmux sync tests**

Create `tests/server/tmuxSessionSync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { SessionRegistry } from '../../src/server/services/sessionRegistry';
import { TmuxSessionSync } from '../../src/server/services/tmuxSessionSync';
import type { TmuxPane } from '../../src/server/services/tmuxPaneDiscovery';

const pane: TmuxPane = {
  paneId: '%12',
  sessionName: 'main',
  windowName: 'webagent-claude',
  paneTitle: 'claude',
  cwd: '/tmp/demo',
  exposedFlag: '1',
  socketPath: '/tmp/tmux-1000/default',
};

describe('TmuxSessionSync', () => {
  it('creates external sessions for exposed panes and publishes capture deltas', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const handleTmuxCapture = vi.fn();
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture },
      listPanes: vi.fn(async () => [pane]),
      capture: vi.fn(async () => 'first screen'),
      resolveProjectId: (cwd) => cwd === '/tmp/demo' ? 'project-1' : null,
      titleForPane: () => 'Claude tmux',
    });

    await sync.refresh();

    const listed = sessions.listRunningSessions('project-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ source: 'external-tmux', title: 'Claude tmux', status: 'running' });
    expect(handleTmuxCapture).toHaveBeenCalledWith(listed[0].id, 'first screen');
  });

  it('marks missing external sessions disconnected', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.upsertExternalSession({ projectId: 'project-1', externalKey: 'tmux:/tmp/tmux-1000/default:main:webagent-claude:%12', title: 'Claude tmux', cwd: '/tmp/demo', paneId: '%12' });
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn() },
      listPanes: vi.fn(async () => []),
      capture: vi.fn(),
      resolveProjectId: () => null,
      titleForPane: () => 'unused',
    });

    await sync.refresh();

    expect(sessions.getSession(session.id)?.status).toBe('stopped');
    expect(sessions.getSnapshot(session.id).session.lifecycle).toBe('disconnected');
  });
});
```

- [ ] **Step 3: Run sync tests to verify failure**

Run:

```bash
npm test -- tests/server/realtimeHub.test.ts tests/server/tmuxSessionSync.test.ts
```

Expected: FAIL because `handleTmuxCapture` and `TmuxSessionSync` do not exist.

- [ ] **Step 4: Add RealtimeHub tmux capture method**

In `src/server/services/realtimeHub.ts`, add public method near `handleOutput`:

```ts
  handleTmuxCapture(sessionId: string, text: string): void {
    this.markTranscriptSource(sessionId, 'tmux-capture');
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
      const block = this.sessions.appendBlock(sessionId, { kind: frame.blockKind, text: frame.text, status: frame.status, source: 'tmux-capture', interaction });
      this.broadcastStreamEvent({ type: 'block-added', sessionId, sequence: block.sequence, block });
    }
    if (interaction.kind === 'none') this.broadcastActivity(sessionId, 'idle');
    else this.broadcastWaitingForInput(sessionId, interaction);
  }
```

- [ ] **Step 5: Implement TmuxSessionSync**

Create `src/server/services/tmuxSessionSync.ts`:

```ts
import type { SessionRegistry } from './sessionRegistry';
import type { TmuxPane } from './tmuxPaneDiscovery';
import { tmuxExternalKey } from './tmuxPaneDiscovery';
import { diffPaneCapture } from './tmuxPaneAdapter';

type Hub = { handleTmuxCapture(sessionId: string, text: string): void };

export class TmuxSessionSync {
  private readonly captures = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: {
    sessions: SessionRegistry;
    hub: Hub;
    listPanes(): Promise<TmuxPane[]>;
    capture(pane: TmuxPane): Promise<string>;
    resolveProjectId(cwd: string): string | null;
    titleForPane(pane: TmuxPane): string;
    intervalMs?: number;
  }) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.options.intervalMs ?? 1500);
    void this.refresh();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    const panes = await this.options.listPanes();
    const seen = new Set<string>();
    for (const pane of panes) {
      const projectId = this.options.resolveProjectId(pane.cwd);
      if (!projectId) continue;
      const externalKey = tmuxExternalKey(pane);
      seen.add(externalKey);
      const session = this.options.sessions.upsertExternalSession({
        projectId,
        externalKey,
        title: this.options.titleForPane(pane),
        cwd: pane.cwd,
        paneId: pane.paneId,
      });
      const next = await this.options.capture(pane);
      const previous = this.captures.get(externalKey) ?? '';
      const delta = diffPaneCapture(previous, next);
      this.captures.set(externalKey, next);
      if (delta) this.options.hub.handleTmuxCapture(session.id, delta);
    }

    for (const session of this.options.sessions.listExternalSessions()) {
      if (!session.externalKey || seen.has(session.externalKey) || session.status !== 'running') continue;
      this.options.sessions.markExternalDisconnected(session.id);
    }
  }
}
```

Also add `listExternalSessions()` to `SessionRegistry`:

```ts
  listExternalSessions(): ClaudeSession[] {
    const rows = this.db.prepare("SELECT * FROM sessions WHERE source = 'external-tmux' ORDER BY last_active_at DESC").all() as SessionRow[];
    return rows.map(toSession);
  }
```

- [ ] **Step 6: Wire optional tmux sync into route context**

In `src/server/app.ts`, add to `RouteContext`:

```ts
  tmuxSync?: { refresh(): Promise<void> };
```

In `src/server/routes/sessionRoutes.ts`, update the list sessions route:

```ts
  app.get('/api/projects/:projectId/sessions', async (request) => {
    await context.tmuxSync?.refresh();
    const params = request.params as { projectId: string };
    return context.sessions.listRunningSessions(params.projectId);
  });
```

In stop route before `context.hub.broadcastStatus(session.id, 'stopping');`, add:

```ts
    if (session.source === 'external-tmux') {
      return context.sessions.markExternalDisconnected(session.id);
    }
```

- [ ] **Step 7: Instantiate sync in server index**

In `src/server/index.ts`, add imports:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TmuxPaneAdapter } from './services/tmuxPaneAdapter';
import { exposedTmuxPanes, parseTmuxPaneList, tmuxListPanesArgs } from './services/tmuxPaneDiscovery';
import { TmuxSessionSync } from './services/tmuxSessionSync';
import { historyProjectId, isAvailableProjectPath } from './services/projectDiscovery';
```

Add after `transcripts` setup:

```ts
const execFileAsync = promisify(execFile);
const tmuxAdapter = new TmuxPaneAdapter();
const tmuxSync = new TmuxSessionSync({
  sessions,
  hub,
  listPanes: async () => {
    try {
      const { stdout } = await execFileAsync('tmux', tmuxListPanesArgs(), { maxBuffer: 1024 * 1024 });
      return exposedTmuxPanes(parseTmuxPaneList(stdout));
    } catch {
      return [];
    }
  },
  capture: (pane) => tmuxAdapter.capture(pane),
  resolveProjectId: (cwd) => {
    const project = projects.listProjects().find((item) => item.path === cwd && item.available);
    if (project) return project.id;
    return isAvailableProjectPath(cwd) ? historyProjectId(cwd) : null;
  },
  titleForPane: (pane) => [pane.windowName, pane.paneTitle].find((part) => part && part !== 'bash' && part !== 'zsh') ?? pane.cwd.split('/').filter(Boolean).at(-1) ?? 'Claude tmux',
});
tmuxSync.start();
```

Update createApp call:

```ts
const app = await createApp({ config, projects, sessions, runner, hub, resumeIndex, transcripts, tmuxSync });
```

- [ ] **Step 8: Run sync and route tests**

Run:

```bash
npm test -- tests/server/realtimeHub.test.ts tests/server/tmuxSessionSync.test.ts tests/server/appRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

Run:

```bash
git add src/server/services/realtimeHub.ts src/server/services/tmuxSessionSync.ts src/server/services/sessionRegistry.ts src/server/app.ts src/server/index.ts src/server/routes/sessionRoutes.ts tests/server/realtimeHub.test.ts tests/server/tmuxSessionSync.test.ts tests/server/appRoutes.test.ts
git commit -m "Sync exposed tmux panes as live sessions"
```

## Task 6: Send input/actions safely to external tmux sessions

**Files:**
- Modify: `src/server/services/tmuxSessionSync.ts`
- Modify: `src/server/services/realtimeHub.ts`
- Modify: `src/server/routes/sessionRoutes.ts`
- Test: `tests/server/tmuxSessionSync.test.ts`
- Test: `tests/server/realtimeHub.test.ts`

- [ ] **Step 1: Write failing safe-input tests**

Append to `tests/server/tmuxSessionSync.test.ts`:

```ts
  it('sends input only when the external pane is still exposed', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const sendInput = vi.fn(async () => undefined);
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn() },
      listPanes: vi.fn(async () => [pane]),
      capture: vi.fn(async () => ''),
      sendInput,
      resolveProjectId: (cwd) => cwd === '/tmp/demo' ? 'project-1' : null,
      titleForPane: () => 'Claude tmux',
    });
    await sync.refresh();
    const session = sessions.listRunningSessions('project-1')[0];

    await sync.sendInput(session.id, 'hello');

    expect(sendInput).toHaveBeenCalledWith(pane, 'hello');
  });

  it('rejects input when the exposed pane is no longer discoverable', async () => {
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const listPanes = vi.fn(async () => [pane]);
    const sync = new TmuxSessionSync({
      sessions,
      hub: { handleTmuxCapture: vi.fn() },
      listPanes,
      capture: vi.fn(async () => ''),
      sendInput: vi.fn(),
      resolveProjectId: (cwd) => cwd === '/tmp/demo' ? 'project-1' : null,
      titleForPane: () => 'Claude tmux',
    });
    await sync.refresh();
    const session = sessions.listRunningSessions('project-1')[0];
    listPanes.mockResolvedValue([]);

    await expect(sync.sendInput(session.id, 'hello')).rejects.toThrow('External tmux pane is not available');
  });
```

- [ ] **Step 2: Run safe-input tests to verify failure**

Run:

```bash
npm test -- tests/server/tmuxSessionSync.test.ts
```

Expected: FAIL because `sendInput` option/method does not exist.

- [ ] **Step 3: Implement safe input in TmuxSessionSync**

In `src/server/services/tmuxSessionSync.ts`, add `sendInput` to constructor options:

```ts
    sendInput?(pane: TmuxPane, text: string): Promise<void>;
```

Add method:

```ts
  async sendInput(sessionId: string, text: string): Promise<void> {
    const session = this.options.sessions.getSession(sessionId);
    if (!session?.externalKey) throw new Error('External tmux session not found');
    const panes = await this.options.listPanes();
    const pane = panes.find((candidate) => tmuxExternalKey(candidate) === session.externalKey);
    if (!pane || this.options.resolveProjectId(pane.cwd) !== session.projectId) {
      this.options.sessions.markExternalDisconnected(sessionId);
      throw new Error('External tmux pane is not available');
    }
    if (this.options.sendInput) await this.options.sendInput(pane, text);
  }
```

- [ ] **Step 4: Wire tmux input through session routes**

In `src/server/app.ts`, update context type:

```ts
  tmuxSync?: { refresh(): Promise<void>; sendInput(sessionId: string, text: string): Promise<void> };
```

In `src/server/routes/sessionRoutes.ts`, inside websocket message handler for `input`, before `context.hub.sendInput(...)`, add:

```ts
          const session = context.sessions.getSession(message.sessionId);
          if (session?.source === 'external-tmux') {
            await context.tmuxSync?.sendInput(message.sessionId, message.text);
            context.hub.sendExternalInput(message.sessionId, message.text);
            return;
          }
```

For `action`, replace `context.hub.sendAction(message.sessionId, message.actionId);` with:

```ts
          const session = context.sessions.getSession(message.sessionId);
          if (session?.source === 'external-tmux') {
            const input = context.hub.resolveActionInput(message.sessionId, message.actionId);
            await context.tmuxSync?.sendInput(message.sessionId, input);
            context.hub.sendExternalInput(message.sessionId, input);
            return;
          }
          context.hub.sendAction(message.sessionId, message.actionId);
```

Because the websocket callback is not currently `async`, change:

```ts
    socket.on('message', (raw: Buffer) => {
```

to:

```ts
    socket.on('message', async (raw: Buffer) => {
```

- [ ] **Step 5: Add RealtimeHub external input helpers**

In `src/server/services/realtimeHub.ts`, add public methods:

```ts
  resolveActionInput(sessionId: string, actionId: string): string {
    const action = this.latestActions.get(sessionId)?.get(actionId);
    if (!action) throw new Error('Action not found');
    return action.input;
  }

  sendExternalInput(sessionId: string, text: string): void {
    this.pendingEchoes.set(sessionId, text);
    this.broadcastUserMessage(sessionId, text);
    this.broadcastActivity(sessionId, 'working');
  }
```

Update existing `sendAction`:

```ts
  sendAction(sessionId: string, actionId: string): void {
    this.deliverInput(sessionId, this.resolveActionInput(sessionId, actionId));
  }
```

- [ ] **Step 6: Wire index sendInput option**

In `src/server/index.ts`, add to `TmuxSessionSync` constructor options:

```ts
  sendInput: (pane, text) => tmuxAdapter.sendInput(pane, text),
```

- [ ] **Step 7: Run safe-input tests**

Run:

```bash
npm test -- tests/server/tmuxSessionSync.test.ts tests/server/realtimeHub.test.ts tests/server/appRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add src/server/services/tmuxSessionSync.ts src/server/services/realtimeHub.ts src/server/app.ts src/server/index.ts src/server/routes/sessionRoutes.ts tests/server/tmuxSessionSync.test.ts tests/server/realtimeHub.test.ts tests/server/appRoutes.test.ts
git commit -m "Send mobile input to exposed tmux panes safely"
```

## Task 7: Update frontend labels and external session controls

**Files:**
- Modify: `src/client/components/SessionList.tsx`
- Modify: `src/client/components/ChatView.tsx`
- Modify: `src/client/styles.css`
- Test: `tests/client/SessionList.test.tsx`
- Test: `tests/client/ChatViewStream.test.tsx`

- [x] **Step 1: Add frontend tests for external labels**

Append to `tests/client/SessionList.test.tsx`:

```tsx
  it('labels external tmux sessions with a detach action', () => {
    render(
      <SessionList
        project={project}
        sessions={[session({ source: 'external-tmux', title: 'tmux Claude', externalPaneId: '%12' })]}
        history={[]}
        loading={false}
        selectedSessionId={null}
        onNew={vi.fn()}
        onContinue={vi.fn()}
        onResume={vi.fn()}
        onOpen={vi.fn()}
        onOpenHistory={vi.fn()}
        onStop={vi.fn()}
        onBackToProjects={vi.fn()}
      />,
    );

    expect(screen.getByText(/external tmux/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /断开 tmux Claude/i })).toBeInTheDocument();
  });
```

Append to `tests/client/ChatViewStream.test.tsx`:

```tsx
  it('shows tmux capture source and disconnected lifecycle with readable labels', async () => {
    render(<ChatView session={{ ...session, source: 'external-tmux' }} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(serverMessage({
      type: 'snapshot',
      sessionId: session.id,
      sequence: 1,
      session: sessionView({ latestSequence: 1, lifecycle: 'disconnected', activity: 'stopped', transcriptSource: 'tmux-capture' }),
      blocks: [],
    }));

    expect(await screen.findByText('已断开')).toBeInTheDocument();
    expect(screen.getByText('tmux capture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '断开' })).toBeDisabled();
  });
```

- [x] **Step 2: Run frontend tests to verify failure**

Run:

```bash
npm test -- tests/client/SessionList.test.tsx tests/client/ChatViewStream.test.tsx
```

Expected: FAIL because labels are not implemented.

- [x] **Step 3: Update SessionList labels**

In `src/client/components/SessionList.tsx`, replace row subtitle and button text inside `sessions.map` with helpers:

```tsx
                  <span className="row-subtitle">{formatDate(session.lastActiveAt)} · {sourceLabel(session)}</span>
```

Replace close button:

```tsx
              <button className="secondary-button compact danger-button" type="button" onClick={() => onStop(session)} aria-label={`${stopActionLabel(session)} ${session.title}`} disabled={loading}>
                {stopActionLabel(session)}
              </button>
```

Add helpers before `formatDate`:

```ts
function sourceLabel(session: ClaudeSession): string {
  if (session.source === 'external-tmux') return session.externalPaneId ? `external tmux · ${session.externalPaneId}` : 'external tmux';
  return session.source;
}

function stopActionLabel(session: ClaudeSession): string {
  return session.source === 'external-tmux' ? '断开' : '关闭';
}
```

- [x] **Step 4: Update ChatView labels**

In `src/client/components/ChatView.tsx`, update stop button text:

```tsx
              {session.source === 'external-tmux' ? '断开' : '停止'}
```

Update `activityLabel`:

```ts
function activityLabel(activity: SessionActivity, lifecycle: SessionViewState['lifecycle'] | null): string {
  if (lifecycle === 'failed') return '失败';
  if (lifecycle === 'degraded-fallback') return '降级模式';
  if (lifecycle === 'disconnected') return '已断开';
  if (activity === 'working') return '工作中';
  if (activity === 'idle') return '等待输入';
  return '已停止';
}
```

Update `sourceLabel`:

```ts
function sourceLabel(source: SessionViewState['transcriptSource'] | undefined): string {
  if (source === 'tmux-capture') return 'tmux capture';
  return source === 'pty-fallback' ? 'PTY fallback' : 'structured';
}
```

Disable the external detach button when disconnected:

```tsx
              disabled={session.status !== 'running'}
```

already exists; `onStatusChange` will update the status when lifecycle maps to stopped in the next step.

- [x] **Step 5: Update lifecycle status mapping**

In `src/client/components/ChatView.tsx`, update `statusFromLifecycle`:

```ts
function statusFromLifecycle(lifecycle: SessionViewState['lifecycle']): SessionStatus | null {
  if (lifecycle === 'running' || lifecycle === 'stopped' || lifecycle === 'failed') return lifecycle;
  if (lifecycle === 'disconnected') return 'stopped';
  return null;
}
```

- [x] **Step 6: Add styles**

In `src/client/styles.css`, update the success source selector:

```css
.source-chip.structured,
.source-chip.tmux-capture {
```

React class names currently use source string as class value. If `tmux-capture` class is not applied because the component only uses degraded/structured, update the chip class in `ChatView.tsx`:

```tsx
          <span className={`source-chip ${streamState.session?.transcriptSource === 'pty-fallback' ? 'degraded' : streamState.session?.transcriptSource ?? 'structured'}`}>{sourceLabel(streamState.session?.transcriptSource)}</span>
```

- [x] **Step 7: Run frontend tests**

Run:

```bash
npm test -- tests/client/SessionList.test.tsx tests/client/ChatViewStream.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

Run:

```bash
git add src/client/components/SessionList.tsx src/client/components/ChatView.tsx src/client/styles.css tests/client/SessionList.test.tsx tests/client/ChatViewStream.test.tsx
git commit -m "Clarify external tmux session UI state"
```

## Task 8: Full verification and browser check

**Files:**
- No source changes expected unless verification finds defects.

- [ ] **Step 1: Run full automated test suite**

Run:

```bash
npm test
```

Expected: PASS all tests.

- [ ] **Step 2: Run typecheck/build**

Run:

```bash
npm run build
```

Expected: PASS TypeScript and Vite build.

- [ ] **Step 3: Start dev server**

Run:

```bash
npm run dev
```

Use background execution for this command if running from Claude Code. Expected: server listens on port 8787 using `webagent-dev.db`.

- [ ] **Step 4: Browser verify history folding**

Open `http://127.0.0.1:8787` with the app token, select the webagent project, open Claude history, and verify tool/system/thinking content appears as collapsed details while user/assistant prose remains expanded.

- [ ] **Step 5: Browser verify external tmux session path**

In a separate terminal, start a tmux pane with a marker:

```bash
tmux new-session -s webagent-claude
export WEBAGENT_EXPOSE=1
claude
```

Refresh webagent, open the project, and verify the exposed tmux pane appears under live sessions as external tmux. Send a short input from the browser and verify it appears in the tmux pane. If the environment cannot run interactive tmux, record that manual tmux verification was not completed and include automated test results.

- [ ] **Step 6: Stop dev server**

Stop the background dev server task from Claude Code or terminate the process started in Step 3.

- [ ] **Step 7: Final git status**

Run:

```bash
git status --short
```

Expected: only intended source/test/spec/plan changes, or a clean tree if all commits were created.

- [ ] **Step 8: Final summary**

Report:

- spec path
- plan path
- commits created
- test/build results
- browser/manual tmux verification status
