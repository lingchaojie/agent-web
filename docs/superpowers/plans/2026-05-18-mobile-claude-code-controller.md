# Mobile Claude Code Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal mobile web app that controls the real local Claude Code CLI through a chat UI, with project whitelisting, native history discovery, session resume, streaming output, and reconnect support.

**Architecture:** A Node.js/TypeScript backend runs on the PC, binds to a private interface, authenticates requests, manages whitelisted projects, reads Claude Code native JSONL history in read-only mode, and wraps `claude` with a PTY. A Vite/React mobile-first frontend talks to the backend over REST and WebSocket.

**Tech Stack:** Node.js 22+, TypeScript, Fastify, `@fastify/websocket`, `node-pty`, `better-sqlite3`, Zod, Vitest, Vite, React, CSS modules/plain CSS.

---

## CLI Facts This Plan Relies On

- New interactive Claude Code session: spawn `claude` with `cwd` set to the selected project directory.
- Continue most recent session for a project: spawn `claude -c` with `cwd` set to the selected project directory.
- Resume a specific session: spawn `claude -r <session-id>` with `cwd` set to the selected project directory.
- Claude Code native transcripts are stored under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<project-key>/<session-id>.jsonl`.
- The app treats those JSONL files as read-only. It may enumerate and parse them, but must not write to them.

## File Structure

Create this repository structure:

```text
package.json
package-lock.json
tsconfig.json
vitest.config.ts
.gitignore
.env.example
src/
  shared/
    types.ts
  server/
    index.ts
    app.ts
    config.ts
    auth.ts
    db.ts
    routes/
      authRoutes.ts
      projectRoutes.ts
      sessionRoutes.ts
      historyRoutes.ts
    services/
      projectRegistry.ts
      sessionRegistry.ts
      claudeHistoryReader.ts
      interactionParser.ts
      ptyRunner.ts
      realtimeHub.ts
  client/
    main.tsx
    App.tsx
    api.ts
    styles.css
    components/
      LoginView.tsx
      ProjectList.tsx
      SessionList.tsx
      ChatView.tsx
      MessageStream.tsx
      PromptActions.tsx
tests/
  server/
    auth.test.ts
    projectRegistry.test.ts
    sessionRegistry.test.ts
    claudeHistoryReader.test.ts
    interactionParser.test.ts
    ptyRunner.test.ts
    realtimeHub.test.ts
  fixtures/
    claude-projects/
      -home-alvin-demo/
        11111111-1111-4111-8111-111111111111.jsonl
```

### Responsibilities

- `src/shared/types.ts`: API and domain types shared by backend and frontend.
- `src/server/config.ts`: environment parsing and safe defaults.
- `src/server/auth.ts`: token authentication helpers.
- `src/server/db.ts`: SQLite schema and database connection.
- `src/server/services/projectRegistry.ts`: whitelisted project CRUD and path checks.
- `src/server/services/sessionRegistry.ts`: web-visible session state and recent output cache.
- `src/server/services/claudeHistoryReader.ts`: read-only scan of Claude Code native history.
- `src/server/services/interactionParser.ts`: parse known CLI prompts into UI actions.
- `src/server/services/ptyRunner.ts`: start/resume Claude CLI via PTY and send input.
- `src/server/services/realtimeHub.ts`: WebSocket session attach, input forwarding, replay.
- `src/server/routes/*`: thin HTTP/WebSocket route adapters.
- `src/client/*`: mobile-first React UI.

---

## Task 1: Bootstrap TypeScript Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/shared/types.ts`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "mobile-claude-code-controller",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "dev:client": "vite --host 0.0.0.0",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/cors": "latest",
    "@fastify/static": "latest",
    "@fastify/websocket": "latest",
    "@vitejs/plugin-react": "latest",
    "better-sqlite3": "latest",
    "fastify": "latest",
    "node-pty": "latest",
    "react": "latest",
    "react-dom": "latest",
    "vite": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "jsdom": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
  },
});
```

- [ ] **Step 4: Create ignore and environment sample files**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
*.db
*.db-shm
*.db-wal
.superpowers/
```

Create `.env.example`:

```bash
HOST=127.0.0.1
PORT=8787
APP_TOKEN=replace-with-a-long-random-token
DATABASE_PATH=./webagent.db
CLAUDE_CONFIG_DIR=
CLAUDE_BIN=claude
SESSION_TTL_MS=1800000
```

- [ ] **Step 5: Create shared domain types**

Create `src/shared/types.ts`:

```ts
export type Project = {
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SessionSource = 'web-created' | 'claude-history';
export type SessionStatus = 'running' | 'stopped' | 'failed';

export type ClaudeSession = {
  id: string;
  projectId: string;
  source: SessionSource;
  claudeSessionId: string | null;
  title: string;
  status: SessionStatus;
  lastActiveAt: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  text: string;
  createdAt: string;
};

export type PromptAction = {
  id: string;
  label: string;
  input: string;
  variant: 'allow' | 'deny' | 'neutral';
};

export type ParsedInteraction = {
  kind: 'none' | 'permission' | 'choice';
  actions: PromptAction[];
  raw: string;
};

export type HistorySession = {
  projectKey: string;
  projectPath: string | null;
  sessionId: string;
  transcriptPath: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
};

export type WsClientMessage =
  | { type: 'attach'; sessionId: string }
  | { type: 'input'; sessionId: string; text: string }
  | { type: 'action'; sessionId: string; actionId: string; input: string };

export type WsServerMessage =
  | { type: 'attached'; sessionId: string; status: SessionStatus; replay: ChatMessage[] }
  | { type: 'output'; sessionId: string; message: ChatMessage; interaction: ParsedInteraction }
  | { type: 'status'; sessionId: string; status: SessionStatus }
  | { type: 'error'; sessionId?: string; message: string };
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
npm install
```

Expected: npm creates `package-lock.json` and installs dependencies without errors.

- [ ] **Step 7: Verify baseline scripts**

Run:

```bash
npm run typecheck
npm test
```

Expected: typecheck passes. Vitest reports no tests or an empty test suite without TypeScript errors.

- [ ] **Step 8: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/shared/types.ts && git commit -m "chore: bootstrap mobile Claude controller"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 2: Configuration and Token Authentication

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/auth.ts`
- Create: `tests/server/auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

Create `tests/server/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { getBearerToken, isAuthorized } from '../../src/server/auth';

const baseEnv = {
  HOST: '100.64.0.10',
  PORT: '8787',
  APP_TOKEN: 'secret-token',
  DATABASE_PATH: ':memory:',
  CLAUDE_BIN: 'claude',
  SESSION_TTL_MS: '1800000',
};

describe('config', () => {
  it('loads safe defaults and explicit values', () => {
    const config = loadConfig(baseEnv);

    expect(config.host).toBe('100.64.0.10');
    expect(config.port).toBe(8787);
    expect(config.appToken).toBe('secret-token');
    expect(config.databasePath).toBe(':memory:');
    expect(config.claudeBin).toBe('claude');
    expect(config.sessionTtlMs).toBe(1800000);
  });

  it('rejects missing app token', () => {
    expect(() => loadConfig({ ...baseEnv, APP_TOKEN: '' })).toThrow('APP_TOKEN is required');
  });
});

describe('auth', () => {
  it('extracts bearer token', () => {
    expect(getBearerToken('Bearer secret-token')).toBe('secret-token');
    expect(getBearerToken('bearer secret-token')).toBe('secret-token');
  });

  it('rejects missing or malformed bearer token', () => {
    expect(getBearerToken(undefined)).toBeNull();
    expect(getBearerToken('Token secret-token')).toBeNull();
  });

  it('authorizes only exact token matches', () => {
    expect(isAuthorized('Bearer secret-token', 'secret-token')).toBe(true);
    expect(isAuthorized('Bearer wrong', 'secret-token')).toBe(false);
    expect(isAuthorized(undefined, 'secret-token')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/auth.test.ts
```

Expected: FAIL because `src/server/config.ts` and `src/server/auth.ts` do not exist yet.

- [ ] **Step 3: Implement config loader**

Create `src/server/config.ts`:

```ts
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type AppConfig = {
  host: string;
  port: number;
  appToken: string;
  databasePath: string;
  claudeConfigDir: string;
  claudeBin: string;
  sessionTtlMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appToken = env.APP_TOKEN?.trim();
  if (!appToken) {
    throw new Error('APP_TOKEN is required');
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const sessionTtlMs = Number(env.SESSION_TTL_MS ?? '1800000');
  if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 60000) {
    throw new Error('SESSION_TTL_MS must be at least 60000');
  }

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    appToken,
    databasePath: env.DATABASE_PATH?.trim() || './webagent.db',
    claudeConfigDir: env.CLAUDE_CONFIG_DIR?.trim() || resolve(homedir(), '.claude'),
    claudeBin: env.CLAUDE_BIN?.trim() || 'claude',
    sessionTtlMs,
  };
}
```

- [ ] **Step 4: Implement auth helpers**

Create `src/server/auth.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';

export function getBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  const actualToken = getBearerToken(header);
  if (!actualToken) return false;

  const actual = Buffer.from(actualToken);
  const expected = Buffer.from(expectedToken);
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm test -- tests/server/auth.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/config.ts src/server/auth.ts tests/server/auth.test.ts && git commit -m "feat: add config and token auth"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 3: SQLite Data Layer and Registries

**Files:**
- Create: `src/server/db.ts`
- Create: `src/server/services/projectRegistry.ts`
- Create: `src/server/services/sessionRegistry.ts`
- Create: `tests/server/projectRegistry.test.ts`
- Create: `tests/server/sessionRegistry.test.ts`

- [ ] **Step 1: Write failing project registry tests**

Create `tests/server/projectRegistry.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { ProjectRegistry } from '../../src/server/services/projectRegistry';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-projects-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ProjectRegistry', () => {
  it('adds and lists whitelisted projects', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);

    const project = registry.addProject({ name: 'Demo', path: root, favorite: true });
    const projects = registry.listProjects();

    expect(project.name).toBe('Demo');
    expect(project.path).toBe(root);
    expect(project.favorite).toBe(true);
    expect(project.available).toBe(true);
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(project.id);
  });

  it('rejects paths that do not exist', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);

    expect(() => registry.addProject({ name: 'Missing', path: join(root, 'missing'), favorite: false })).toThrow('Project path does not exist');
  });

  it('resolves availability when listing projects', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);
    const project = registry.addProject({ name: 'Demo', path: root, favorite: false });

    rmSync(root, { recursive: true, force: true });

    const listed = registry.getProject(project.id);
    expect(listed?.available).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing session registry tests**

Create `tests/server/sessionRegistry.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/server/projectRegistry.test.ts tests/server/sessionRegistry.test.ts
```

Expected: FAIL because database and registries do not exist yet.

- [ ] **Step 4: Implement database schema**

Create `src/server/db.ts`:

```ts
import Database from 'better-sqlite3';

export type Db = Database.Database;

export function createDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL,
      claude_session_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recent_output (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
```

- [ ] **Step 5: Implement project registry**

Create `src/server/services/projectRegistry.ts`:

```ts
import { existsSync, realpathSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Project } from '../../shared/types';
import type { Db } from '../db';

type ProjectRow = {
  id: string;
  name: string;
  path: string;
  favorite: number;
  created_at: string;
  updated_at: string;
};

export class ProjectRegistry {
  constructor(private readonly db: Db) {}

  addProject(input: { name: string; path: string; favorite: boolean }): Project {
    const path = normalizeProjectPath(input.path);
    const now = new Date().toISOString();
    const row: ProjectRow = {
      id: randomUUID(),
      name: input.name.trim(),
      path,
      favorite: input.favorite ? 1 : 0,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO projects (id, name, path, favorite, created_at, updated_at)
      VALUES (@id, @name, @path, @favorite, @created_at, @updated_at)
    `).run(row);

    return toProject(row);
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY favorite DESC, name ASC').all() as ProjectRow[];
    return rows.map(toProject);
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }
}

function normalizeProjectPath(path: string): string {
  if (!existsSync(path)) {
    throw new Error('Project path does not exist');
  }
  const real = realpathSync(path);
  if (!statSync(real).isDirectory()) {
    throw new Error('Project path must be a directory');
  }
  return real;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    favorite: row.favorite === 1,
    available: existsSync(row.path),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 6: Implement session registry**

Create `src/server/services/sessionRegistry.ts`:

```ts
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
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
    `).all(sessionId, this.outputLimit) as { id: string }[];

    for (const row of oldRows) {
      this.db.prepare('DELETE FROM recent_output WHERE id = ?').run(row.id);
    }

    return message;
  }

  getRecentOutput(sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM recent_output WHERE session_id = ? ORDER BY created_at ASC
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
```

- [ ] **Step 7: Run registry tests**

Run:

```bash
npm test -- tests/server/projectRegistry.test.ts tests/server/sessionRegistry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/db.ts src/server/services/projectRegistry.ts src/server/services/sessionRegistry.ts tests/server/projectRegistry.test.ts tests/server/sessionRegistry.test.ts && git commit -m "feat: add project and session registries"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 4: Read-Only Claude Code History Reader

**Files:**
- Create: `src/server/services/claudeHistoryReader.ts`
- Create: `tests/fixtures/claude-projects/-home-alvin-demo/11111111-1111-4111-8111-111111111111.jsonl`
- Create: `tests/server/claudeHistoryReader.test.ts`

- [ ] **Step 1: Create representative Claude history fixture**

Create `tests/fixtures/claude-projects/-home-alvin-demo/11111111-1111-4111-8111-111111111111.jsonl`:

```jsonl
{"type":"summary","summary":"Build auth flow","timestamp":"2026-05-18T10:00:00.000Z"}
{"type":"user","message":{"role":"user","content":"Add login"},"timestamp":"2026-05-18T10:01:00.000Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Implemented token login."}]},"timestamp":"2026-05-18T10:02:00.000Z"}
```

- [ ] **Step 2: Write failing history reader tests**

Create `tests/server/claudeHistoryReader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readClaudeHistory, projectKeyToPath } from '../../src/server/services/claudeHistoryReader';

const fixtureRoot = join(process.cwd(), 'tests/fixtures/claude-projects');

describe('claudeHistoryReader', () => {
  it('converts Claude project keys back to absolute paths', () => {
    expect(projectKeyToPath('-home-alvin-demo')).toBe('/home/alvin/demo');
  });

  it('reads sessions from Claude native JSONL history', () => {
    const sessions = readClaudeHistory(fixtureRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      projectKey: '-home-alvin-demo',
      projectPath: '/home/alvin/demo',
      sessionId: '11111111-1111-4111-8111-111111111111',
      title: 'Build auth flow',
      lastMessage: 'Implemented token login.',
      updatedAt: '2026-05-18T10:02:00.000Z',
    });
  });

  it('returns an empty list when history root is missing', () => {
    expect(readClaudeHistory(join(fixtureRoot, 'missing'))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/claudeHistoryReader.test.ts
```

Expected: FAIL because `claudeHistoryReader.ts` does not exist.

- [ ] **Step 4: Implement read-only history reader**

Create `src/server/services/claudeHistoryReader.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HistorySession } from '../../shared/types';

type ParsedLine = {
  type?: string;
  summary?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

export function readClaudeHistory(projectsRoot: string): HistorySession[] {
  if (!existsSync(projectsRoot)) return [];

  const sessions: HistorySession[] = [];
  for (const projectKey of readdirSync(projectsRoot)) {
    const projectDir = join(projectsRoot, projectKey);
    if (!statSync(projectDir).isDirectory()) continue;

    for (const fileName of readdirSync(projectDir)) {
      if (!fileName.endsWith('.jsonl')) continue;
      const transcriptPath = join(projectDir, fileName);
      const session = readTranscript(projectKey, transcriptPath);
      if (session) sessions.push(session);
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function projectKeyToPath(projectKey: string): string | null {
  if (!projectKey.startsWith('-')) return null;
  return projectKey.replace(/-/g, '/');
}

function readTranscript(projectKey: string, transcriptPath: string): HistorySession | null {
  const sessionId = transcriptPath.split('/').at(-1)?.replace(/\.jsonl$/, '');
  if (!sessionId) return null;

  const raw = readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  let title = 'Untitled session';
  let lastMessage = '';
  let updatedAt = statSync(transcriptPath).mtime.toISOString();

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    if (parsed.timestamp) updatedAt = parsed.timestamp;
    if (parsed.type === 'summary' && parsed.summary) title = parsed.summary;

    const text = extractMessageText(parsed.message?.content);
    if (text) lastMessage = text;
  }

  return {
    projectKey,
    projectPath: projectKeyToPath(projectKey),
    sessionId,
    transcriptPath,
    title,
    lastMessage,
    updatedAt,
  };
}

function parseLine(line: string): ParsedLine | null {
  try {
    return JSON.parse(line) as ParsedLine;
  } catch {
    return null;
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
```

- [ ] **Step 5: Run history tests**

Run:

```bash
npm test -- tests/server/claudeHistoryReader.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/services/claudeHistoryReader.ts tests/fixtures/claude-projects tests/server/claudeHistoryReader.test.ts && git commit -m "feat: read Claude Code history"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 5: Interaction Parser

**Files:**
- Create: `src/server/services/interactionParser.ts`
- Create: `tests/server/interactionParser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `tests/server/interactionParser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseInteraction } from '../../src/server/services/interactionParser';

describe('parseInteraction', () => {
  it('detects permission prompts with allow and deny actions', () => {
    const parsed = parseInteraction('Claude wants to run Bash command: npm test\nDo you want to allow this?');

    expect(parsed.kind).toBe('permission');
    expect(parsed.actions).toEqual([
      { id: 'allow', label: 'Allow', input: '1', variant: 'allow' },
      { id: 'deny', label: 'Deny', input: '2', variant: 'deny' },
    ]);
  });

  it('detects numbered choice prompts', () => {
    const parsed = parseInteraction('Choose an option:\n1. Yes\n2. No\n3. Always allow');

    expect(parsed.kind).toBe('choice');
    expect(parsed.actions).toEqual([
      { id: 'choice-1', label: 'Yes', input: '1', variant: 'neutral' },
      { id: 'choice-2', label: 'No', input: '2', variant: 'neutral' },
      { id: 'choice-3', label: 'Always allow', input: '3', variant: 'neutral' },
    ]);
  });

  it('falls back to none for normal output', () => {
    const parsed = parseInteraction('I updated the file and tests pass.');

    expect(parsed.kind).toBe('none');
    expect(parsed.actions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/interactionParser.test.ts
```

Expected: FAIL because parser does not exist.

- [ ] **Step 3: Implement parser**

Create `src/server/services/interactionParser.ts`:

```ts
import type { ParsedInteraction, PromptAction } from '../../shared/types';

export function parseInteraction(raw: string): ParsedInteraction {
  if (looksLikePermission(raw)) {
    return {
      kind: 'permission',
      raw,
      actions: [
        { id: 'allow', label: 'Allow', input: '1', variant: 'allow' },
        { id: 'deny', label: 'Deny', input: '2', variant: 'deny' },
      ],
    };
  }

  const choices = parseNumberedChoices(raw);
  if (choices.length > 0) {
    return { kind: 'choice', raw, actions: choices };
  }

  return { kind: 'none', raw, actions: [] };
}

function looksLikePermission(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('do you want to allow') ||
    lower.includes('permission') ||
    lower.includes('wants to run') ||
    lower.includes('allow this')
  );
}

function parseNumberedChoices(raw: string): PromptAction[] {
  const actions: PromptAction[] = [];
  for (const line of raw.split('\n')) {
    const match = /^\s*(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    actions.push({
      id: `choice-${match[1]}`,
      label: match[2],
      input: match[1],
      variant: 'neutral',
    });
  }
  return actions;
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
npm test -- tests/server/interactionParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/services/interactionParser.ts tests/server/interactionParser.test.ts && git commit -m "feat: parse Claude CLI interactions"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 6: PTY Runner

**Files:**
- Create: `src/server/services/ptyRunner.ts`
- Create: `tests/server/ptyRunner.test.ts`

- [ ] **Step 1: Write failing PTY runner tests with a fake spawn function**

Create `tests/server/ptyRunner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PtyRunner } from '../../src/server/services/ptyRunner';

describe('PtyRunner', () => {
  it('starts a new Claude session in the project cwd', () => {
    const spawn = vi.fn(() => fakePty());
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    expect(spawn).toHaveBeenCalledWith('claude', [], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('continues the latest Claude session with -c', () => {
    const spawn = vi.fn(() => fakePty());
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'continue' });

    expect(spawn).toHaveBeenCalledWith('claude', ['-c'], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('resumes a specific Claude session with -r', () => {
    const spawn = vi.fn(() => fakePty());
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'resume', claudeSessionId: 'abc' });

    expect(spawn).toHaveBeenCalledWith('claude', ['-r', 'abc'], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('writes input with a newline', () => {
    const pty = fakePty();
    const runner = new PtyRunner({ claudeBin: 'claude', spawn: vi.fn(() => pty) });
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    runner.sendInput('web-1', '/help');

    expect(pty.write).toHaveBeenCalledWith('/help\r');
  });
});

function fakePty() {
  return {
    write: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/ptyRunner.test.ts
```

Expected: FAIL because `ptyRunner.ts` does not exist.

- [ ] **Step 3: Implement PTY runner**

Create `src/server/services/ptyRunner.ts`:

```ts
import os from 'node:os';
import pty from 'node-pty';

type PtyProcess = {
  write(data: string): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): void;
};

type SpawnOptions = {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

type SpawnFn = (file: string, args: string[], options: SpawnOptions) => PtyProcess;

type StartInput =
  | { sessionId: string; cwd: string; mode: 'new' }
  | { sessionId: string; cwd: string; mode: 'continue' }
  | { sessionId: string; cwd: string; mode: 'resume'; claudeSessionId: string };

export class PtyRunner {
  private readonly processes = new Map<string, PtyProcess>();

  constructor(private readonly options: { claudeBin: string; spawn?: SpawnFn }) {}

  start(input: StartInput): void {
    if (this.processes.has(input.sessionId)) {
      throw new Error('Session already running');
    }

    const args = argsFor(input);
    const spawn = this.options.spawn ?? defaultSpawn;
    const proc = spawn(this.options.claudeBin, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: input.cwd,
      env: process.env,
    });

    this.processes.set(input.sessionId, proc);
  }

  onData(sessionId: string, callback: (data: string) => void): void {
    const proc = this.requireProcess(sessionId);
    proc.onData(callback);
  }

  onExit(sessionId: string, callback: (event: { exitCode: number; signal?: number }) => void): void {
    const proc = this.requireProcess(sessionId);
    proc.onExit((event) => {
      this.processes.delete(sessionId);
      callback(event);
    });
  }

  sendInput(sessionId: string, text: string): void {
    this.requireProcess(sessionId).write(`${text}\r`);
  }

  stop(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;
    proc.kill();
    this.processes.delete(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  private requireProcess(sessionId: string): PtyProcess {
    const proc = this.processes.get(sessionId);
    if (!proc) throw new Error('Session is not running');
    return proc;
  }
}

function argsFor(input: StartInput): string[] {
  if (input.mode === 'continue') return ['-c'];
  if (input.mode === 'resume') return ['-r', input.claudeSessionId];
  return [];
}

const defaultSpawn: SpawnFn = (file, args, options) => pty.spawn(file, args, {
  ...options,
  env: options.env as Record<string, string>,
});
```

- [ ] **Step 4: Run PTY tests**

Run:

```bash
npm test -- tests/server/ptyRunner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If TypeScript reports `node-pty` type mismatch, adjust only the local `PtyProcess` adapter type; do not change the public runner methods.

- [ ] **Step 6: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/services/ptyRunner.ts tests/server/ptyRunner.test.ts && git commit -m "feat: wrap Claude CLI with pty runner"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 7: Realtime Hub

**Files:**
- Create: `src/server/services/realtimeHub.ts`
- Create: `tests/server/realtimeHub.test.ts`

- [ ] **Step 1: Write failing realtime hub tests**

Create `tests/server/realtimeHub.test.ts`:

```ts
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

  it('forwards text input to the runner', () => {
    const runner = fakeRunner();
    const sessions = new SessionRegistry(createDatabase(':memory:'));
    const session = sessions.createSession({ projectId: 'project-1', source: 'web-created', claudeSessionId: null, title: 'Demo' });
    const hub = new RealtimeHub(sessions, runner);

    hub.sendInput(session.id, '/help');

    expect(runner.sendInput).toHaveBeenCalledWith(session.id, '/help');
  });
});

function fakeRunner() {
  return {
    sendInput: vi.fn(),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server/realtimeHub.test.ts
```

Expected: FAIL because `realtimeHub.ts` does not exist.

- [ ] **Step 3: Implement realtime hub**

Create `src/server/services/realtimeHub.ts`:

```ts
import type { WsServerMessage } from '../../shared/types';
import type { SessionRegistry } from './sessionRegistry';
import { parseInteraction } from './interactionParser';

type SendFn = (message: WsServerMessage) => void;

type InputRunner = {
  sendInput(sessionId: string, text: string): void;
};

export class RealtimeHub {
  private readonly clients = new Map<string, Set<SendFn>>();

  constructor(private readonly sessions: SessionRegistry, private readonly runner: InputRunner) {}

  attach(sessionId: string, send: SendFn): () => void {
    const session = this.sessions.getSession(sessionId);
    if (!session) {
      send({ type: 'error', sessionId, message: 'Session not found' });
      return () => undefined;
    }

    const clients = this.clients.get(sessionId) ?? new Set<SendFn>();
    clients.add(send);
    this.clients.set(sessionId, clients);

    send({
      type: 'attached',
      sessionId,
      status: session.status,
      replay: this.sessions.getRecentOutput(sessionId),
    });

    return () => clients.delete(send);
  }

  handleOutput(sessionId: string, text: string): void {
    const message = this.sessions.appendOutput(sessionId, { role: 'assistant', text });
    const interaction = parseInteraction(text);
    this.broadcast(sessionId, { type: 'output', sessionId, message, interaction });
  }

  sendInput(sessionId: string, text: string): void {
    this.sessions.appendOutput(sessionId, { role: 'user', text });
    this.runner.sendInput(sessionId, text);
  }

  broadcastStatus(sessionId: string, status: 'running' | 'stopped' | 'failed'): void {
    this.sessions.updateStatus(sessionId, status);
    this.broadcast(sessionId, { type: 'status', sessionId, status });
  }

  private broadcast(sessionId: string, message: WsServerMessage): void {
    const clients = this.clients.get(sessionId);
    if (!clients) return;
    for (const send of clients) send(message);
  }
}
```

- [ ] **Step 4: Run realtime hub tests**

Run:

```bash
npm test -- tests/server/realtimeHub.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/services/realtimeHub.ts tests/server/realtimeHub.test.ts && git commit -m "feat: add realtime session hub"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 8: Fastify Backend Routes

**Files:**
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Create: `src/server/routes/authRoutes.ts`
- Create: `src/server/routes/projectRoutes.ts`
- Create: `src/server/routes/sessionRoutes.ts`
- Create: `src/server/routes/historyRoutes.ts`

- [ ] **Step 1: Implement app factory and route context**

Create `src/server/app.ts`:

```ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import type { AppConfig } from './config';
import { isAuthorized } from './auth';
import type { ProjectRegistry } from './services/projectRegistry';
import type { SessionRegistry } from './services/sessionRegistry';
import type { PtyRunner } from './services/ptyRunner';
import type { RealtimeHub } from './services/realtimeHub';
import { registerAuthRoutes } from './routes/authRoutes';
import { registerProjectRoutes } from './routes/projectRoutes';
import { registerSessionRoutes } from './routes/sessionRoutes';
import { registerHistoryRoutes } from './routes/historyRoutes';

export type RouteContext = {
  config: AppConfig;
  projects: ProjectRegistry;
  sessions: SessionRegistry;
  runner: PtyRunner;
  hub: RealtimeHub;
};

export async function createApp(context: RouteContext) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/api/auth/check') return;
    if (!request.url.startsWith('/api/')) return;
    if (!isAuthorized(request.headers.authorization, context.config.appToken)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  registerAuthRoutes(app, context);
  registerProjectRoutes(app, context);
  registerSessionRoutes(app, context);
  registerHistoryRoutes(app, context);

  return app;
}
```

- [ ] **Step 2: Implement auth route**

Create `src/server/routes/authRoutes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { isAuthorized } from '../auth';
import type { RouteContext } from '../app';

export function registerAuthRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/auth/check', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, context.config.appToken)) {
      return reply.code(401).send({ ok: false });
    }
    return { ok: true };
  });
}
```

- [ ] **Step 3: Implement project routes**

Create `src/server/routes/projectRoutes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteContext } from '../app';

const addProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  favorite: z.boolean().default(false),
});

export function registerProjectRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/projects', async () => context.projects.listProjects());

  app.post('/api/projects', async (request, reply) => {
    const parsed = addProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return context.projects.addProject(parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to add project' });
    }
  });
}
```

- [ ] **Step 4: Implement session routes**

Create `src/server/routes/sessionRoutes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteContext } from '../app';
import type { WsClientMessage } from '../../shared/types';

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(['new', 'continue']).default('new'),
});

const resumeSessionSchema = z.object({
  projectId: z.string().min(1),
  claudeSessionId: z.string().min(1),
  title: z.string().min(1).default('Resumed session'),
});

export function registerSessionRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/projects/:projectId/sessions', async (request) => {
    const params = request.params as { projectId: string };
    return context.sessions.listSessions(params.projectId);
  });

  app.post('/api/sessions', async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const project = context.projects.getProject(parsed.data.projectId);
    if (!project || !project.available) return reply.code(404).send({ error: 'Project not found' });

    const session = context.sessions.createSession({
      projectId: project.id,
      source: 'web-created',
      claudeSessionId: null,
      title: parsed.data.mode === 'continue' ? 'Continued session' : 'New session',
    });

    context.runner.start({ sessionId: session.id, cwd: project.path, mode: parsed.data.mode });
    context.runner.onData(session.id, (data) => context.hub.handleOutput(session.id, data));
    context.runner.onExit(session.id, () => context.hub.broadcastStatus(session.id, 'stopped'));
    context.hub.broadcastStatus(session.id, 'running');

    return context.sessions.getSession(session.id);
  });

  app.post('/api/sessions/resume', async (request, reply) => {
    const parsed = resumeSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const project = context.projects.getProject(parsed.data.projectId);
    if (!project || !project.available) return reply.code(404).send({ error: 'Project not found' });

    const session = context.sessions.createSession({
      projectId: project.id,
      source: 'claude-history',
      claudeSessionId: parsed.data.claudeSessionId,
      title: parsed.data.title,
    });

    context.runner.start({ sessionId: session.id, cwd: project.path, mode: 'resume', claudeSessionId: parsed.data.claudeSessionId });
    context.runner.onData(session.id, (data) => context.hub.handleOutput(session.id, data));
    context.runner.onExit(session.id, () => context.hub.broadcastStatus(session.id, 'stopped'));
    context.hub.broadcastStatus(session.id, 'running');

    return context.sessions.getSession(session.id);
  });

  app.get('/api/ws', { websocket: true }, (socket) => {
    let detach: (() => void) | null = null;

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as WsClientMessage;
      if (message.type === 'attach') {
        detach?.();
        detach = context.hub.attach(message.sessionId, (serverMessage) => socket.send(JSON.stringify(serverMessage)));
      }
      if (message.type === 'input') {
        context.hub.sendInput(message.sessionId, message.text);
      }
      if (message.type === 'action') {
        context.hub.sendInput(message.sessionId, message.input);
      }
    });

    socket.on('close', () => detach?.());
  });
}
```

- [ ] **Step 5: Implement history route**

Create `src/server/routes/historyRoutes.ts`:

```ts
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from '../app';
import { readClaudeHistory } from '../services/claudeHistoryReader';

export function registerHistoryRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/history', async () => {
    const projectsRoot = join(context.config.claudeConfigDir, 'projects');
    return readClaudeHistory(projectsRoot);
  });
}
```

- [ ] **Step 6: Implement server entrypoint**

Create `src/server/index.ts`:

```ts
import { createDatabase } from './db';
import { loadConfig } from './config';
import { createApp } from './app';
import { ProjectRegistry } from './services/projectRegistry';
import { SessionRegistry } from './services/sessionRegistry';
import { PtyRunner } from './services/ptyRunner';
import { RealtimeHub } from './services/realtimeHub';

const config = loadConfig();
const db = createDatabase(config.databasePath);
const projects = new ProjectRegistry(db);
const sessions = new SessionRegistry(db);
const runner = new PtyRunner({ claudeBin: config.claudeBin });
const hub = new RealtimeHub(sessions, runner);

const app = await createApp({ config, projects, sessions, runner, hub });
await app.listen({ host: config.host, port: config.port });
```

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 9: Start backend manually**

Run:

```bash
APP_TOKEN=dev-token DATABASE_PATH=:memory: npm run dev
```

Expected: Fastify logs that it is listening on `127.0.0.1:8787`. Stop it with Ctrl-C after confirming startup.

- [ ] **Step 10: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/app.ts src/server/index.ts src/server/routes && git commit -m "feat: expose backend api and websocket"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 9: Mobile React UI

**Files:**
- Create: `index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/api.ts`
- Create: `src/client/styles.css`
- Create: `src/client/components/LoginView.tsx`
- Create: `src/client/components/ProjectList.tsx`
- Create: `src/client/components/SessionList.tsx`
- Create: `src/client/components/ChatView.tsx`
- Create: `src/client/components/MessageStream.tsx`
- Create: `src/client/components/PromptActions.tsx`

- [ ] **Step 1: Create Vite entry HTML**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Mobile Controller</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create API client**

Create `src/client/api.ts`:

```ts
import type { ClaudeSession, HistorySession, Project, WsClientMessage, WsServerMessage } from '../shared/types';

const tokenKey = 'webagent-token';

export function getToken(): string {
  return localStorage.getItem(tokenKey) ?? '';
}

export function setToken(token: string): void {
  localStorage.setItem(tokenKey, token);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function checkAuth(): Promise<boolean> {
  try {
    await apiGet<{ ok: boolean }>('/api/auth/check');
    return true;
  } catch {
    return false;
  }
}

export const api = {
  listProjects: () => apiGet<Project[]>('/api/projects'),
  listSessions: (projectId: string) => apiGet<ClaudeSession[]>(`/api/projects/${projectId}/sessions`),
  listHistory: () => apiGet<HistorySession[]>('/api/history'),
  createSession: (projectId: string) => apiPost<ClaudeSession>('/api/sessions', { projectId, mode: 'new' }),
  continueSession: (projectId: string) => apiPost<ClaudeSession>('/api/sessions', { projectId, mode: 'continue' }),
  resumeSession: (projectId: string, claudeSessionId: string, title: string) =>
    apiPost<ClaudeSession>('/api/sessions/resume', { projectId, claudeSessionId, title }),
};

export function openSessionSocket(onMessage: (message: WsServerMessage) => void): WebSocket {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/api/ws`);
  socket.addEventListener('message', (event) => onMessage(JSON.parse(event.data) as WsServerMessage));
  return socket;
}

export function sendWs(socket: WebSocket, message: WsClientMessage): void {
  socket.send(JSON.stringify(message));
}
```

- [ ] **Step 3: Create React entrypoint**

Create `src/client/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Create login component**

Create `src/client/components/LoginView.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { checkAuth, setToken } from '../api';

export function LoginView({ onLogin }: { onLogin: () => void }) {
  const [token, setLocalToken] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setToken(token.trim());
    if (await checkAuth()) onLogin();
    else setError('Token was rejected by the local server.');
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Private mobile access</p>
        <h1>Claude Code Controller</h1>
        <p>Enter the token configured on your PC.</p>
        <input value={token} onChange={(event) => setLocalToken(event.target.value)} placeholder="Access token" />
        {error && <div className="error">{error}</div>}
        <button type="submit">Connect</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Create project list component**

Create `src/client/components/ProjectList.tsx`:

```tsx
import type { Project } from '../../shared/types';

export function ProjectList({ projects, selectedId, onSelect }: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (project: Project) => void;
}) {
  return (
    <section className="panel project-panel">
      <h2>Projects</h2>
      {projects.map((project) => (
        <button
          className={project.id === selectedId ? 'list-item active' : 'list-item'}
          key={project.id}
          onClick={() => onSelect(project)}
          disabled={!project.available}
        >
          <span>{project.favorite ? '★ ' : ''}{project.name}</span>
          <small>{project.available ? project.path : 'Unavailable'}</small>
        </button>
      ))}
    </section>
  );
}
```

- [ ] **Step 6: Create session list component**

Create `src/client/components/SessionList.tsx`:

```tsx
import type { ClaudeSession, HistorySession } from '../../shared/types';

export function SessionList({ sessions, history, onNew, onContinue, onOpen, onResume }: {
  sessions: ClaudeSession[];
  history: HistorySession[];
  onNew: () => void;
  onContinue: () => void;
  onOpen: (session: ClaudeSession) => void;
  onResume: (history: HistorySession) => void;
}) {
  return (
    <section className="panel session-panel">
      <div className="panel-header">
        <h2>Sessions</h2>
        <div className="button-row">
          <button onClick={onNew}>New</button>
          <button onClick={onContinue}>Continue</button>
        </div>
      </div>
      {sessions.map((session) => (
        <button className="list-item" key={session.id} onClick={() => onOpen(session)}>
          <span>{session.title}</span>
          <small>{session.status} · {session.source}</small>
        </button>
      ))}
      <h3>Claude history</h3>
      {history.map((item) => (
        <button className="list-item" key={item.transcriptPath} onClick={() => onResume(item)}>
          <span>{item.title}</span>
          <small>{item.lastMessage || item.sessionId}</small>
        </button>
      ))}
    </section>
  );
}
```

- [ ] **Step 7: Create message stream and action components**

Create `src/client/components/MessageStream.tsx`:

```tsx
import type { ChatMessage } from '../../shared/types';

export function MessageStream({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="message-stream">
      {messages.map((message) => (
        <article className={`message ${message.role}`} key={message.id}>
          <div className="message-role">{message.role}</div>
          <pre>{message.text}</pre>
        </article>
      ))}
    </div>
  );
}
```

Create `src/client/components/PromptActions.tsx`:

```tsx
import type { ParsedInteraction } from '../../shared/types';

export function PromptActions({ interaction, onAction }: {
  interaction: ParsedInteraction | null;
  onAction: (input: string) => void;
}) {
  if (!interaction || interaction.actions.length === 0) return null;

  return (
    <div className="prompt-actions">
      {interaction.actions.map((action) => (
        <button className={`action ${action.variant}`} key={action.id} onClick={() => onAction(action.input)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Create chat component**

Create `src/client/components/ChatView.tsx`:

```tsx
import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClaudeSession, ParsedInteraction, WsServerMessage } from '../../shared/types';
import { openSessionSocket, sendWs } from '../api';
import { MessageStream } from './MessageStream';
import { PromptActions } from './PromptActions';

export function ChatView({ session }: { session: ClaudeSession | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(session?.status ?? 'stopped');
  const [interaction, setInteraction] = useState<ParsedInteraction | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setMessages([]);
    setInteraction(null);
    setStatus(session?.status ?? 'stopped');
    socketRef.current?.close();

    if (!session) return;
    const socket = openSessionSocket(handleMessage);
    socketRef.current = socket;
    socket.addEventListener('open', () => sendWs(socket, { type: 'attach', sessionId: session.id }));
    return () => socket.close();
  }, [session?.id]);

  function handleMessage(message: WsServerMessage) {
    if (message.type === 'attached') {
      setStatus(message.status);
      setMessages(message.replay);
    }
    if (message.type === 'output') {
      setMessages((current) => [...current, message.message]);
      setInteraction(message.interaction.kind === 'none' ? null : message.interaction);
    }
    if (message.type === 'status') setStatus(message.status);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !input.trim() || !socketRef.current) return;
    sendWs(socketRef.current, { type: 'input', sessionId: session.id, text: input.trim() });
    setInput('');
  }

  function sendAction(text: string) {
    if (!session || !socketRef.current) return;
    sendWs(socketRef.current, { type: 'action', sessionId: session.id, actionId: text, input: text });
    setInteraction(null);
  }

  if (!session) {
    return <section className="chat-empty">Select or create a session.</section>;
  }

  return (
    <section className="chat-view">
      <header className="chat-header">
        <div>
          <h2>{session.title}</h2>
          <small>{status}</small>
        </div>
      </header>
      <MessageStream messages={messages} />
      <PromptActions interaction={interaction} onAction={sendAction} />
      <form className="composer" onSubmit={submit}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message Claude Code or type /help" />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 9: Create main app component**

Create `src/client/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { ClaudeSession, HistorySession, Project } from '../shared/types';
import { api, checkAuth } from './api';
import { ChatView } from './components/ChatView';
import { LoginView } from './components/LoginView';
import { ProjectList } from './components/ProjectList';
import { SessionList } from './components/SessionList';

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ClaudeSession | null>(null);
  const projectHistory = useMemo(() => {
    if (!selectedProject) return [];
    return history.filter((item) => item.projectPath === selectedProject.path);
  }, [history, selectedProject]);

  useEffect(() => {
    checkAuth().then(setAuthenticated);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    refreshProjects();
    api.listHistory().then(setHistory).catch(() => setHistory([]));
  }, [authenticated]);

  async function refreshProjects() {
    setProjects(await api.listProjects());
  }

  async function selectProject(project: Project) {
    setSelectedProject(project);
    setSelectedSession(null);
    setSessions(await api.listSessions(project.id));
  }

  async function createSession() {
    if (!selectedProject) return;
    const session = await api.createSession(selectedProject.id);
    setSessions(await api.listSessions(selectedProject.id));
    setSelectedSession(session);
  }

  async function continueSession() {
    if (!selectedProject) return;
    const session = await api.continueSession(selectedProject.id);
    setSessions(await api.listSessions(selectedProject.id));
    setSelectedSession(session);
  }

  async function resumeHistory(item: HistorySession) {
    if (!selectedProject) return;
    const session = await api.resumeSession(selectedProject.id, item.sessionId, item.title);
    setSessions(await api.listSessions(selectedProject.id));
    setSelectedSession(session);
  }

  if (!authenticated) return <LoginView onLogin={() => setAuthenticated(true)} />;

  return (
    <main className="app-shell">
      <ProjectList projects={projects} selectedId={selectedProject?.id ?? null} onSelect={selectProject} />
      <SessionList
        sessions={sessions}
        history={projectHistory}
        onNew={createSession}
        onContinue={continueSession}
        onOpen={setSelectedSession}
        onResume={resumeHistory}
      />
      <ChatView session={selectedSession} />
    </main>
  );
}
```

- [ ] **Step 10: Create mobile-first styles**

Create `src/client/styles.css`:

```css
:root {
  color: #e5edf7;
  background: #08111f;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #08111f, #101827); }
button, input, textarea { font: inherit; }
button { border: 0; border-radius: 12px; padding: 10px 12px; background: #24344d; color: #e5edf7; }
button:disabled { opacity: 0.5; }

.login-screen { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card { width: min(420px, 100%); display: grid; gap: 14px; padding: 24px; border: 1px solid #25344a; border-radius: 24px; background: rgba(15, 23, 42, 0.88); }
.login-card input { padding: 12px; border-radius: 12px; border: 1px solid #334155; background: #0f172a; color: #e5edf7; }
.eyebrow { color: #8ab4ff; text-transform: uppercase; letter-spacing: 0.08em; font-size: 12px; }
.error { color: #fca5a5; }

.app-shell { height: 100vh; display: grid; grid-template-columns: 260px 320px 1fr; gap: 1px; background: #25344a; }
.panel, .chat-view, .chat-empty { min-height: 0; background: rgba(15, 23, 42, 0.96); }
.panel { overflow: auto; padding: 16px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.button-row { display: flex; gap: 8px; }
.list-item { width: 100%; display: grid; gap: 4px; margin: 8px 0; text-align: left; background: #111c2f; }
.list-item.active { outline: 2px solid #60a5fa; }
.list-item small { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.chat-view { display: grid; grid-template-rows: auto 1fr auto auto; min-width: 0; }
.chat-header { padding: 16px; border-bottom: 1px solid #25344a; }
.chat-header h2 { margin: 0; }
.chat-empty { display: grid; place-items: center; color: #94a3b8; }
.message-stream { overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.message { border-radius: 16px; padding: 12px; background: #111c2f; }
.message.user { background: #1e3a5f; align-self: flex-end; max-width: 88%; }
.message.assistant, .message.tool, .message.system { align-self: flex-start; max-width: 94%; }
.message-role { color: #8ab4ff; font-size: 12px; margin-bottom: 6px; text-transform: uppercase; }
.message pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.prompt-actions { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #25344a; }
.action.allow { background: #166534; }
.action.deny { background: #7f1d1d; }
.composer { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 16px; border-top: 1px solid #25344a; }
.composer textarea { min-height: 52px; max-height: 160px; resize: vertical; padding: 12px; border-radius: 14px; border: 1px solid #334155; background: #0f172a; color: #e5edf7; }

@media (max-width: 860px) {
  .app-shell { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; }
  .project-panel, .session-panel { max-height: 28vh; }
  .composer { grid-template-columns: 1fr; }
}
```

- [ ] **Step 11: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: PASS and Vite creates a production build.

- [ ] **Step 12: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add index.html src/client && git commit -m "feat: add mobile web interface"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Task 10: Serve Frontend and Run Manual MVP Test

**Files:**
- Modify: `src/server/app.ts`
- Modify: `.env.example`

- [ ] **Step 1: Modify app to serve built frontend**

Modify `src/server/app.ts` by adding imports near the top:

```ts
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
```

Then add this block after WebSocket registration and before API route registration:

```ts
  const distDir = resolve(process.cwd(), 'dist');
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }
```

- [ ] **Step 2: Update environment sample with Tailscale note**

Modify `.env.example` to:

```bash
# Use 127.0.0.1 for local-only development.
# Use your Tailscale/ZeroTier private address when testing from your phone.
HOST=127.0.0.1
PORT=8787
APP_TOKEN=replace-with-a-long-random-token
DATABASE_PATH=./webagent.db
CLAUDE_CONFIG_DIR=
CLAUDE_BIN=claude
SESSION_TTL_MS=1800000
```

- [ ] **Step 3: Run all automated checks**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 4: Start production-style server**

Run:

```bash
APP_TOKEN=dev-token DATABASE_PATH=./webagent-dev.db npm run dev
```

Expected: backend starts on `127.0.0.1:8787`.

- [ ] **Step 5: Add a project through the API**

In another terminal, run:

```bash
curl -s -X POST http://127.0.0.1:8787/api/projects \
  -H 'authorization: Bearer dev-token' \
  -H 'content-type: application/json' \
  -d '{"name":"Webagent","path":"/home/alvin/webagent","favorite":true}'
```

Expected: JSON response includes `"name":"Webagent"`, `"available":true`, and an `id`.

- [ ] **Step 6: Open local UI**

Open:

```text
http://127.0.0.1:8787
```

Expected: login screen appears. Enter `dev-token`, then project list appears.

- [ ] **Step 7: Test real Claude Code session**

From the UI:

1. Select the Webagent project.
2. Click `New`.
3. Send `/help`.
4. Confirm Claude Code output streams back into the chat.

Expected: output appears in the message stream. If Claude Code asks for interaction, buttons may appear for recognized prompts; otherwise raw text remains usable.

- [ ] **Step 8: Test history discovery**

Open the UI after at least one Claude Code session exists under `~/.claude/projects`.

Expected: the Claude history list shows matching sessions for whitelisted project paths where `projectPath` equals the project path.

- [ ] **Step 9: Test resume**

From the UI, click a history session.

Expected: backend starts `claude -r <session-id>` in the selected project directory, and output appears in the chat.

- [ ] **Step 10: Test reconnect**

With a running session open:

1. Send a message.
2. Refresh the browser page.
3. Reopen the same session from the session list.

Expected: recent output is replayed and new output continues streaming.

- [ ] **Step 11: Test phone over Tailscale/ZeroTier**

Set `HOST` to the PC's Tailscale or ZeroTier private IP and restart:

```bash
HOST=<private-overlay-ip> APP_TOKEN=dev-token DATABASE_PATH=./webagent-dev.db npm run dev
```

Open this URL from the phone while connected to the same overlay network:

```text
http://<private-overlay-ip>:8787
```

Expected: phone can log in, see projects, open a session, and send `/help`.

- [ ] **Step 12: Commit if in a git repository**

Run:

```bash
git rev-parse --is-inside-work-tree && git add src/server/app.ts .env.example && git commit -m "feat: serve app and verify mobile flow"
```

Expected: in a git repo, a commit is created. Outside a git repo, skip this step.

---

## Self-Review

### Spec Coverage

- Tailscale/ZeroTier private access: Task 10 documents binding to overlay IP and phone test.
- Token login: Task 2 and Task 9 implement token auth and login UI.
- Project whitelist: Task 3 and Task 8 implement registry and API.
- New Claude Code sessions: Task 6 and Task 8 start `claude` in project cwd.
- Native history discovery: Task 4 and Task 8 read `~/.claude/projects` in read-only mode.
- Resume historical sessions: Task 6 and Task 8 use `claude -r <session-id>`.
- Slash commands: Task 6 sends raw input to PTY, so `/` commands pass through.
- Permission buttons and fallback: Task 5 and Task 9 implement recognized action buttons and raw message display.
- Recent output replay: Task 3, Task 7, and Task 9 implement bounded cache and replay on attach.
- Mobile UI: Task 9 implements responsive layout.
- No generic shell: no route exposes shell execution; only Claude PTY input is supported.
- No history mutation: Task 4 only reads JSONL files.

### Placeholder Scan

No implementation step contains TBD, TODO, placeholder sections, or unspecified test instructions. Commands and expected outcomes are explicit.

### Type Consistency

The shared types in Task 1 are used consistently by registries, routes, realtime hub, and React components. Session statuses are restricted to `running`, `stopped`, and `failed`; session sources are restricted to `web-created` and `claude-history`.
