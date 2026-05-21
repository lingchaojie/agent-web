# Tmux Browser Terminal MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MVP where a mobile browser can open a real terminal view attached to a tmux-hosted Claude Code session started by the web app.

**Architecture:** Web-created sessions run Claude Code inside a dedicated tmux session. A terminal WebSocket endpoint starts a backend PTY running `tmux attach-session`, streams PTY bytes to xterm.js, and writes browser input back to the PTY. The existing structured conversation UI remains available, while the MVP terminal view is an explicit mode for running sessions.

**Tech Stack:** TypeScript, Fastify, @fastify/websocket, node-pty, tmux CLI, React, Vite, @xterm/xterm, @xterm/addon-fit, Vitest, Testing Library.

---

## Implementation Rules

- Do not modify `start-prod.sh`.
- Do not commit during execution unless the user explicitly asks for commits in that implementation session.
- Use TDD for each task: write the failing test first, run it, implement the smallest passing change, then run the focused test again.
- Use the existing scripts:
  - Focused tests: `npx vitest run <test-file>`
  - Type check: `npm run typecheck`
  - Full test suite: `npm test`
  - Build: `npm run build`
- For manual UI verification, use `./start-dev.sh` or `npm run dev` on port 8787.

## File Structure

### Shared protocol

- Modify `src/shared/types.ts`
  - Add terminal takeover protocol types used by both server and client.
  - Keep them separate from `SessionStreamEvent`; terminal output is raw terminal transport, not durable transcript state.

### Client API

- Modify `src/client/api.ts`
  - Add `openTerminalSocket()` using `/api/terminal/ws` and the same subprotocol token auth pattern as `openSessionSocket()`.
  - Add `sendTerminalWs()` for terminal protocol messages.

### Server tmux session runner

- Create `src/server/services/tmuxClaudeRunner.ts`
  - Implements the existing `ClaudeEventSource` interface enough for session create/stop/list and existing route wiring.
  - Starts Claude Code in tmux using `tmux new-session -d`.
  - Provides `tmuxTarget(sessionId)` so the attach service can find the right tmux session.
  - Stops sessions with `tmux kill-session`.
  - Sends composer input to tmux with `tmux send-keys` for compatibility with the existing non-terminal composer.

### Server terminal attach runtime

- Create `src/server/services/terminalAttachService.ts`
  - Owns one active browser terminal attach per app session.
  - Spawns a PTY running `tmux attach-session -t <target>`.
  - Sends PTY output frames to the WebSocket route.
  - Writes terminal input back to the attach PTY.
  - Releases the active attach on WebSocket close or PTY exit without killing tmux.

### Server routes and app context

- Modify `src/server/app.ts`
  - Add terminal runtime to `RouteContext`.
  - Permit WebSocket protocol-token auth for both `/api/ws` and `/api/terminal/ws`.
  - Register terminal routes.

- Create `src/server/routes/terminalRoutes.ts`
  - Adds `/api/terminal/ws`.
  - Validates `attach`, `input`, `resize`, and `detach` messages with zod.
  - Checks session existence and running status before attaching.

- Modify `src/server/index.ts`
  - Instantiate `TmuxClaudeRunner` instead of `StreamJsonClaudeEventSource` for web-created runtime sessions.
  - Instantiate `TerminalAttachService` using the tmux target resolver.

### Browser terminal UI

- Modify `package.json` and `package-lock.json`
  - Add `@xterm/xterm` and `@xterm/addon-fit`.

- Create `src/client/components/TerminalView.tsx`
  - xterm.js wrapper with terminal WebSocket lifecycle.
  - Renders mobile shortcut key bar.
  - Handles status, output, input, resize, disconnect, and rejected states.

- Modify `src/client/components/ChatView.tsx`
  - Add a terminal-mode button for running real app sessions.
  - Render `TerminalView` when terminal mode is selected.
  - Keep structured conversation mode unchanged.

- Modify `src/client/styles.css`
  - Add mobile-first terminal view, xterm container, terminal status, and shortcut key bar styling.

### Tests

- Create `tests/server/tmuxClaudeRunner.test.ts`
- Create `tests/server/terminalAttachService.test.ts`
- Modify `tests/server/appRoutes.test.ts`
- Modify `tests/client/api.test.ts`
- Create `tests/client/TerminalView.test.tsx`
- Modify `tests/client/ChatViewStream.test.tsx`

---

## Task 1: Shared Terminal Protocol and Client Socket Helper

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/client/api.ts`
- Modify: `tests/client/api.test.ts`

- [ ] **Step 1: Write the failing API helper test**

Append these tests to `tests/client/api.test.ts` and extend the import list from `../../src/client/api` to include `openTerminalSocket` and `sendTerminalWs`:

```ts
it('opens terminal websocket with the same protocol token auth format', () => {
  setToken('test-token');
  const sockets: Array<{ url: string | URL; protocols?: string | string[] }> = [];
  class FakeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      sockets.push({ url, protocols });
    }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  Object.defineProperty(window, 'location', {
    value: { protocol: 'http:', host: 'localhost:8787' },
    configurable: true,
  });

  openTerminalSocket();

  expect(sockets).toEqual([{ url: 'ws://localhost:8787/api/terminal/ws', protocols: ['webagent', `token.${btoa('test-token')}`] }]);
});

it('sends terminal websocket messages as JSON only when connected', () => {
  const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

  sendTerminalWs(socket, { type: 'input', sessionId: 'session-1', data: '\x03' });

  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'input', sessionId: 'session-1', data: '\x03' }));
});

it('rejects terminal websocket sends when disconnected', () => {
  const socket = { readyState: WebSocket.CLOSED, send: vi.fn() } as unknown as WebSocket;

  expect(() => sendTerminalWs(socket, { type: 'detach', sessionId: 'session-1' })).toThrow('WebSocket is not connected');
});
```

- [ ] **Step 2: Run the focused API test and confirm it fails**

Run:

```bash
npx vitest run tests/client/api.test.ts
```

Expected: FAIL with TypeScript or runtime errors because `openTerminalSocket` and `sendTerminalWs` do not exist.

- [ ] **Step 3: Add terminal protocol types**

Append these types near the existing WebSocket types in `src/shared/types.ts`:

```ts
export type TerminalConnectionStatus = 'connecting' | 'attached' | 'detached' | 'stopped' | 'unavailable' | 'rejected' | 'error';

export type TerminalClientMessage =
  | { type: 'attach'; sessionId: string; cols?: number; rows?: number }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'detach'; sessionId: string };

export type TerminalServerMessage =
  | { type: 'status'; sessionId?: string; status: TerminalConnectionStatus; message?: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'error'; sessionId?: string; message: string };
```

- [ ] **Step 4: Add terminal socket helpers**

Modify the first import in `src/client/api.ts` so it includes terminal message types:

```ts
import type { ClaudeSession, HistorySession, Project, SlashCommandCatalog, TerminalClientMessage, TranscriptWindow, WsClientMessage } from '../shared/types';
```

Add these functions after `openSessionSocket()`:

```ts
export function openTerminalSocket(): WebSocket {
  return openWebSocket('/api/terminal/ws');
}
```

Replace the body of `openSessionSocket()` with this helper call and add `openWebSocket()` below it:

```ts
export function openSessionSocket(): WebSocket {
  return openWebSocket('/api/ws');
}

function openWebSocket(path: string): WebSocket {
  const token = getToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}${path}`;

  if (!token) return new WebSocket(url, ['webagent']);

  return new WebSocket(url, ['webagent', `token.${base64url(token)}`]);
}
```

Add the terminal send helper after `sendWs()`:

```ts
export function sendTerminalWs(socket: WebSocket, message: TerminalClientMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket is not connected');
  }
  socket.send(JSON.stringify(message));
}
```

- [ ] **Step 5: Run the focused API test and confirm it passes**

Run:

```bash
npx vitest run tests/client/api.test.ts
```

Expected: PASS.

---

## Task 2: Tmux Claude Runner

**Files:**
- Create: `src/server/services/tmuxClaudeRunner.ts`
- Create: `tests/server/tmuxClaudeRunner.test.ts`

- [ ] **Step 1: Write the failing tmux runner tests**

Create `tests/server/tmuxClaudeRunner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TmuxClaudeRunner } from '../../src/server/services/tmuxClaudeRunner';

const now = new Date('2026-01-01T00:00:00.000Z');

describe('TmuxClaudeRunner', () => {
  it('starts a web session by running Claude inside a dedicated tmux session', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });

    expect(execFileSync).toHaveBeenCalledWith('tmux', [
      'new-session',
      '-d',
      '-s',
      'webagent-session-1',
      '-c',
      '/tmp/project',
      '--',
      'claude',
    ], { stdio: 'pipe' });
    expect(runner.isRunning('session-1')).toBe(true);
    expect(runner.tmuxTarget('session-1')).toBe('webagent-session-1');
    expect(runner.modeForSession('session-1')).toBe('pty-fallback');
  });

  it('passes continue and resume arguments to Claude inside tmux', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-continue', cwd: '/tmp/project', mode: 'continue' });
    runner.start({ sessionId: 'session-resume', cwd: '/tmp/project', mode: 'resume', claudeSessionId: 'native-1' });

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'tmux', expect.arrayContaining(['claude', '-c']), { stdio: 'pipe' });
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'tmux', expect.arrayContaining(['claude', '-r', 'native-1']), { stdio: 'pipe' });
  });

  it('sanitizes tmux session names from app session ids', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });

    runner.start({ sessionId: 'session/with spaces', cwd: '/tmp/project', mode: 'new' });

    expect(runner.tmuxTarget('session/with spaces')).toBe('webagent-session-with-spaces');
  });

  it('rejects duplicate running session ids', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });

    expect(() => runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' })).toThrow('Session already running');
  });

  it('sends composer input to tmux and presses Enter', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });
    execFileSync.mockClear();

    runner.sendInput('session-1', '/help');

    expect(execFileSync).toHaveBeenCalledWith('tmux', ['send-keys', '-t', 'webagent-session-1', '-l', '/help'], { stdio: 'pipe' });
    expect(execFileSync).toHaveBeenCalledWith('tmux', ['send-keys', '-t', 'webagent-session-1', 'Enter'], { stdio: 'pipe' });
  });

  it('kills tmux session on stop and notifies exit callbacks', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    const onExit = vi.fn();
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });
    runner.onExit('session-1', onExit);
    execFileSync.mockClear();

    runner.stop('session-1');

    expect(execFileSync).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'webagent-session-1'], { stdio: 'pipe' });
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 });
    expect(runner.isRunning('session-1')).toBe(false);
    expect(runner.tmuxTarget('session-1')).toBe(null);
  });

  it('throws when sending input to a stopped session', () => {
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync: vi.fn(), now: () => now });

    expect(() => runner.sendInput('missing', 'hello')).toThrow('Session is not running');
  });
});
```

- [ ] **Step 2: Run the focused runner test and confirm it fails**

Run:

```bash
npx vitest run tests/server/tmuxClaudeRunner.test.ts
```

Expected: FAIL because `src/server/services/tmuxClaudeRunner.ts` does not exist.

- [ ] **Step 3: Implement `TmuxClaudeRunner`**

Create `src/server/services/tmuxClaudeRunner.ts`:

```ts
import { execFileSync as defaultExecFileSync } from 'node:child_process';
import type { ClaudeEventSink, ClaudeEventSource, ClaudeEventSourceDiscovery, ClaudeEventSourceMode, ClaudeEventSourceStartInput } from './claudeEventSource';

type ExecFileSyncFn = (file: string, args: string[], options: { stdio: 'pipe' }) => Buffer | string;

type RunningTmuxSession = {
  target: string;
  input: ClaudeEventSourceStartInput;
};

export class TmuxClaudeRunner implements ClaudeEventSource {
  private readonly sessions = new Map<string, RunningTmuxSession>();
  private readonly eventCallbacks = new Map<string, Set<ClaudeEventSink>>();
  private readonly fallbackCallbacks = new Map<string, Set<(data: string) => void>>();
  private readonly exitCallbacks = new Map<string, Set<(event: { exitCode: number; signal?: number }) => void>>();

  constructor(private readonly options: {
    claudeBin: string;
    tmuxBin?: string;
    execFileSync?: ExecFileSyncFn;
    now?: () => Date;
  }) {}

  discover(): ClaudeEventSourceDiscovery {
    return {
      selected: 'pty-fallback',
      capabilities: [{
        source: 'cli-stream-json',
        available: false,
        command: [this.options.claudeBin],
        supports: {
          stableSessionId: false,
          stableMessageId: false,
          orderedEvents: false,
          partialAssistantDeltas: false,
          toolUseEvents: false,
          hookEvents: false,
          permissionPromptEvents: false,
          streamingInput: true,
        },
        permissionFallback: 'pty-interaction',
        notes: ['Claude Code is running as an interactive TUI inside tmux for browser terminal takeover.'],
      }],
    };
  }

  start(input: ClaudeEventSourceStartInput): void {
    if (this.sessions.has(input.sessionId)) throw new Error('Session already running');

    const target = tmuxTargetForSession(input.sessionId);
    this.execTmux([
      'new-session',
      '-d',
      '-s',
      target,
      '-c',
      input.cwd,
      '--',
      this.options.claudeBin,
      ...claudeArgsFor(input),
    ]);
    this.sessions.set(input.sessionId, { target, input });
  }

  onEvent(sessionId: string, callback: ClaudeEventSink): void {
    const callbacks = this.eventCallbacks.get(sessionId) ?? new Set<ClaudeEventSink>();
    callbacks.add(callback);
    this.eventCallbacks.set(sessionId, callbacks);
  }

  onFallbackOutput(sessionId: string, callback: (data: string) => void): void {
    const callbacks = this.fallbackCallbacks.get(sessionId) ?? new Set<(data: string) => void>();
    callbacks.add(callback);
    this.fallbackCallbacks.set(sessionId, callbacks);
  }

  onExit(sessionId: string, callback: (event: { exitCode: number; signal?: number }) => void): void {
    const callbacks = this.exitCallbacks.get(sessionId) ?? new Set<(event: { exitCode: number; signal?: number }) => void>();
    callbacks.add(callback);
    this.exitCallbacks.set(sessionId, callbacks);
  }

  sendInput(sessionId: string, text: string): void {
    const target = this.requireTarget(sessionId);
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line) this.execTmux(['send-keys', '-t', target, '-l', line]);
      this.execTmux(['send-keys', '-t', target, 'Enter']);
    }
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      this.execTmux(['kill-session', '-t', session.target]);
    } finally {
      this.sessions.delete(sessionId);
      for (const callback of this.exitCallbacks.get(sessionId) ?? []) callback({ exitCode: 0 });
    }
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  modeForSession(_sessionId: string): ClaudeEventSourceMode {
    return 'pty-fallback';
  }

  tmuxTarget(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.target ?? null;
  }

  private requireTarget(sessionId: string): string {
    const target = this.tmuxTarget(sessionId);
    if (!target) throw new Error('Session is not running');
    return target;
  }

  private execTmux(args: string[]): Buffer | string {
    const execFileSync = this.options.execFileSync ?? defaultExecFileSync;
    return execFileSync(this.options.tmuxBin ?? 'tmux', args, { stdio: 'pipe' });
  }
}

export function tmuxTargetForSession(sessionId: string): string {
  return `webagent-${sessionId.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function claudeArgsFor(input: ClaudeEventSourceStartInput): string[] {
  if (input.mode === 'continue') return ['-c'];
  if (input.mode === 'resume') return ['-r', input.claudeSessionId];
  return [];
}
```

- [ ] **Step 4: Run the focused runner test and confirm it passes**

Run:

```bash
npx vitest run tests/server/tmuxClaudeRunner.test.ts
```

Expected: PASS.

---

## Task 3: Terminal Attach Service

**Files:**
- Create: `src/server/services/terminalAttachService.ts`
- Create: `tests/server/terminalAttachService.test.ts`

- [ ] **Step 1: Write the failing terminal attach service tests**

Create `tests/server/terminalAttachService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TerminalAttachService } from '../../src/server/services/terminalAttachService';
import type { TerminalServerMessage } from '../../src/shared/types';

describe('TerminalAttachService', () => {
  it('spawns tmux attach in a PTY and forwards output', () => {
    const pty = fakePty();
    const spawn = vi.fn(() => pty);
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });
    const sent: TerminalServerMessage[] = [];

    const attach = service.attach({ sessionId: 'session-1', cols: 90, rows: 28 }, (message) => sent.push(message));
    pty.fireData('hello terminal');

    expect(spawn).toHaveBeenCalledWith('tmux', ['attach-session', '-t', 'webagent-session-1'], expect.objectContaining({ name: 'xterm-256color', cols: 90, rows: 28 }));
    expect(attach).not.toBeNull();
    expect(sent).toEqual([
      { type: 'status', sessionId: 'session-1', status: 'attached' },
      { type: 'output', sessionId: 'session-1', data: 'hello terminal' },
    ]);
  });

  it('returns unavailable when the session has no tmux target', () => {
    const service = new TerminalAttachService({ spawn: vi.fn(), targetForSession: () => null });
    const sent: TerminalServerMessage[] = [];

    const attach = service.attach({ sessionId: 'session-1' }, (message) => sent.push(message));

    expect(attach).toBeNull();
    expect(sent).toEqual([{ type: 'status', sessionId: 'session-1', status: 'unavailable', message: 'Terminal session is unavailable.' }]);
  });

  it('rejects a second active attach to the same session', () => {
    const spawn = vi.fn(() => fakePty());
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });
    const firstMessages: TerminalServerMessage[] = [];
    const secondMessages: TerminalServerMessage[] = [];

    const first = service.attach({ sessionId: 'session-1' }, (message) => firstMessages.push(message));
    const second = service.attach({ sessionId: 'session-1' }, (message) => secondMessages.push(message));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(secondMessages).toEqual([{ type: 'status', sessionId: 'session-1', status: 'rejected', message: 'Terminal is already attached in another browser.' }]);
  });

  it('writes input and resizes the active attach PTY', () => {
    const pty = fakePty();
    const service = new TerminalAttachService({ spawn: vi.fn(() => pty), targetForSession: () => 'webagent-session-1' });
    const attach = service.attach({ sessionId: 'session-1' }, vi.fn());

    attach?.sendInput('\x03');
    attach?.resize(120, 40);

    expect(pty.write).toHaveBeenCalledWith('\x03');
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('releases active attach when detached without killing the tmux session', () => {
    const firstPty = fakePty();
    const secondPty = fakePty();
    const spawn = vi.fn().mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });

    const first = service.attach({ sessionId: 'session-1' }, vi.fn());
    first?.detach();
    const second = service.attach({ sessionId: 'session-1' }, vi.fn());

    expect(firstPty.kill).toHaveBeenCalled();
    expect(second).not.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('releases active attach when the PTY exits', () => {
    const firstPty = fakePty();
    const secondPty = fakePty();
    const spawn = vi.fn().mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });
    const sent: TerminalServerMessage[] = [];

    service.attach({ sessionId: 'session-1' }, (message) => sent.push(message));
    firstPty.fireExit({ exitCode: 0 });
    const second = service.attach({ sessionId: 'session-1' }, vi.fn());

    expect(second).not.toBeNull();
    expect(sent).toContainEqual({ type: 'status', sessionId: 'session-1', status: 'detached' });
  });
});

type ExitEvent = { exitCode: number; signal?: number };

function fakePty() {
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(event: ExitEvent) => void> = [];
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((callback: (data: string) => void) => dataCallbacks.push(callback)),
    onExit: vi.fn((callback: (event: ExitEvent) => void) => exitCallbacks.push(callback)),
    fireData(data: string) {
      for (const callback of dataCallbacks) callback(data);
    },
    fireExit(event: ExitEvent) {
      for (const callback of exitCallbacks) callback(event);
    },
  };
}
```

- [ ] **Step 2: Run the focused attach service test and confirm it fails**

Run:

```bash
npx vitest run tests/server/terminalAttachService.test.ts
```

Expected: FAIL because `src/server/services/terminalAttachService.ts` does not exist.

- [ ] **Step 3: Implement `TerminalAttachService`**

Create `src/server/services/terminalAttachService.ts`:

```ts
import pty from 'node-pty';
import type { TerminalServerMessage } from '../../shared/types';

type PtyProcess = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
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
type SendFn = (message: TerminalServerMessage) => void;

type ActiveAttach = {
  proc: PtyProcess;
  send: SendFn;
};

export type TerminalAttach = {
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
  detach(): void;
};

export class TerminalAttachService {
  private readonly active = new Map<string, ActiveAttach>();

  constructor(private readonly options: {
    targetForSession(sessionId: string): string | null;
    spawn?: SpawnFn;
    tmuxBin?: string;
  }) {}

  attach(input: { sessionId: string; cols?: number; rows?: number }, send: SendFn): TerminalAttach | null {
    const target = this.options.targetForSession(input.sessionId);
    if (!target) {
      send({ type: 'status', sessionId: input.sessionId, status: 'unavailable', message: 'Terminal session is unavailable.' });
      return null;
    }

    if (this.active.has(input.sessionId)) {
      send({ type: 'status', sessionId: input.sessionId, status: 'rejected', message: 'Terminal is already attached in another browser.' });
      return null;
    }

    const spawn = this.options.spawn ?? defaultSpawn;
    const proc = spawn(this.options.tmuxBin ?? 'tmux', ['attach-session', '-t', target], {
      name: 'xterm-256color',
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
      cwd: process.cwd(),
      env: process.env,
    });
    const active: ActiveAttach = { proc, send };
    this.active.set(input.sessionId, active);
    send({ type: 'status', sessionId: input.sessionId, status: 'attached' });

    proc.onData((data) => {
      if (this.active.get(input.sessionId) !== active) return;
      send({ type: 'output', sessionId: input.sessionId, data });
    });

    proc.onExit(() => {
      if (this.active.get(input.sessionId) !== active) return;
      this.active.delete(input.sessionId);
      send({ type: 'status', sessionId: input.sessionId, status: 'detached' });
    });

    return {
      sendInput: (data) => {
        if (this.active.get(input.sessionId) !== active) return;
        proc.write(data);
      },
      resize: (cols, rows) => {
        if (this.active.get(input.sessionId) !== active) return;
        proc.resize(cols, rows);
      },
      detach: () => {
        if (this.active.get(input.sessionId) !== active) return;
        this.active.delete(input.sessionId);
        proc.kill();
      },
    };
  }
}

const defaultSpawn: SpawnFn = (file, args, options) => pty.spawn(file, args, {
  ...options,
  env: options.env as Record<string, string>,
});
```

- [ ] **Step 4: Run the focused attach service test and confirm it passes**

Run:

```bash
npx vitest run tests/server/terminalAttachService.test.ts
```

Expected: PASS.

---

## Task 4: Terminal WebSocket Route and Auth

**Files:**
- Modify: `src/server/app.ts`
- Create: `src/server/routes/terminalRoutes.ts`
- Modify: `tests/server/appRoutes.test.ts`

- [ ] **Step 1: Write failing route tests**

In `tests/server/appRoutes.test.ts`, extend the `fakeContext()` return object with a `terminals` field:

```ts
    terminals: {
      attach: vi.fn((_input, send) => {
        send({ type: 'status', sessionId: _input.sessionId, status: 'attached' });
        return { sendInput: vi.fn(), resize: vi.fn(), detach: vi.fn() };
      }),
    } as unknown as RouteContext['terminals'],
```

Then add these tests inside `describe('backend routes', () => { ... })`:

```ts
it('allows terminal websocket connections with a protocol token', async () => {
  const session = fakeSession({ id: 'session-1', status: 'running' });
  const context = fakeContext();
  context.sessions.getSession = vi.fn(() => session);
  const app = await createApp(context);
  await app.ready();
  const client = await app.injectWS('/api/terminal/ws', { headers: { host: 'localhost', 'sec-websocket-protocol': `webagent, ${protocolToken()}` } });
  const messages = collectWsMessages(client);

  client.send(JSON.stringify({ type: 'attach', sessionId: session.id, cols: 80, rows: 24 }));
  await waitUntil(() => messages.length > 0);

  expect(context.terminals.attach).toHaveBeenCalledWith({ sessionId: session.id, cols: 80, rows: 24 }, expect.any(Function));
  expect(messages).toEqual([{ type: 'status', sessionId: session.id, status: 'attached' }]);

  client.close();
  await app.close();
});

it('rejects terminal websocket connections without auth', async () => {
  const context = fakeContext();
  const app = await createApp(context);
  await app.ready();

  await expect(app.injectWS('/api/terminal/ws', { headers: { host: 'localhost' } })).rejects.toThrow('Unexpected server response: 401');

  await app.close();
});

it('rejects terminal attach for missing or stopped sessions', async () => {
  const stopped = fakeSession({ id: 'stopped-session', status: 'stopped' });
  const context = fakeContext();
  context.sessions.getSession = vi.fn((sessionId: string) => sessionId === stopped.id ? stopped : null);
  const app = await createApp(context);
  await app.ready();
  const client = await app.injectWS('/api/terminal/ws', { headers: { ...authHeaders(), host: 'localhost' } });
  const messages = collectWsMessages(client);

  client.send(JSON.stringify({ type: 'attach', sessionId: 'missing-session' }));
  await waitUntil(() => messages.length === 1);
  client.send(JSON.stringify({ type: 'attach', sessionId: stopped.id }));
  await waitUntil(() => messages.length === 2);

  expect(messages).toEqual([
    { type: 'status', sessionId: 'missing-session', status: 'unavailable', message: 'Session not found.' },
    { type: 'status', sessionId: stopped.id, status: 'stopped', message: 'Session is not running.' },
  ]);
  expect(context.terminals.attach).not.toHaveBeenCalled();

  client.close();
  await app.close();
});

it('forwards terminal input, resize, and close to the active attach', async () => {
  const session = fakeSession({ id: 'session-1', status: 'running' });
  const attach = { sendInput: vi.fn(), resize: vi.fn(), detach: vi.fn() };
  const context = fakeContext();
  context.sessions.getSession = vi.fn(() => session);
  context.terminals.attach = vi.fn((_input, send) => {
    send({ type: 'status', sessionId: _input.sessionId, status: 'attached' });
    return attach;
  });
  const app = await createApp(context);
  await app.ready();
  const client = await app.injectWS('/api/terminal/ws', { headers: { ...authHeaders(), host: 'localhost' } });
  const messages = collectWsMessages(client);

  client.send(JSON.stringify({ type: 'attach', sessionId: session.id }));
  await waitUntil(() => messages.length > 0);
  client.send(JSON.stringify({ type: 'input', sessionId: session.id, data: '\x03' }));
  client.send(JSON.stringify({ type: 'resize', sessionId: session.id, cols: 120, rows: 40 }));
  await waitUntil(() => attach.resize.mock.calls.length > 0);
  client.close();
  await waitUntil(() => attach.detach.mock.calls.length > 0);

  expect(attach.sendInput).toHaveBeenCalledWith('\x03');
  expect(attach.resize).toHaveBeenCalledWith(120, 40);

  await app.close();
});

it('sends terminal websocket error messages for invalid messages', async () => {
  const session = fakeSession({ id: 'session-1', status: 'running' });
  const context = fakeContext();
  context.sessions.getSession = vi.fn(() => session);
  const app = await createApp(context);
  await app.ready();
  const client = await app.injectWS('/api/terminal/ws', { headers: { ...authHeaders(), host: 'localhost' } });
  const messages = collectWsMessages(client);

  client.send('{not-json');
  await waitUntil(() => messages.length > 0);

  expect(messages).toEqual([{ type: 'error', message: 'Invalid JSON' }]);

  client.close();
  await app.close();
});
```

- [ ] **Step 2: Run the route test and confirm it fails**

Run:

```bash
npx vitest run tests/server/appRoutes.test.ts
```

Expected: FAIL because `RouteContext` has no `terminals` field and `/api/terminal/ws` does not exist.

- [ ] **Step 3: Add route context and auth support**

Modify imports in `src/server/app.ts`:

```ts
import { registerTerminalRoutes } from './routes/terminalRoutes';
import type { TerminalAttachService } from './services/terminalAttachService';
```

Add this field to `RouteContext`:

```ts
  terminals: Pick<TerminalAttachService, 'attach'>;
```

Replace the WebSocket authorization expression in the preHandler hook with:

```ts
    const isWebSocketApi = pathname === '/api/ws' || pathname === '/api/terminal/ws';
    const authorized = isWebSocketApi
      ? isAuthorized(request.headers.authorization, context.config.appToken) || isWebSocketProtocolAuthorized(request.headers['sec-websocket-protocol'], context.config.appToken)
      : isAuthorized(request.headers.authorization, context.config.appToken);
```

Register terminal routes after session routes:

```ts
  registerSessionRoutes(app, context);
  registerTerminalRoutes(app, context);
```

- [ ] **Step 4: Implement terminal routes**

Create `src/server/routes/terminalRoutes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TerminalClientMessage, TerminalServerMessage } from '../../shared/types';
import type { RouteContext } from '../app';

const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('attach'), sessionId: z.string().min(1), cols: z.number().int().positive().optional(), rows: z.number().int().positive().optional() }),
  z.object({ type: z.literal('input'), sessionId: z.string().min(1), data: z.string() }),
  z.object({ type: z.literal('resize'), sessionId: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() }),
  z.object({ type: z.literal('detach'), sessionId: z.string().min(1) }),
]);

export function registerTerminalRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/terminal/ws', { websocket: true }, (socket) => {
    let attach: ReturnType<RouteContext['terminals']['attach']> | null = null;
    let attachedSessionId: string | null = null;

    const send = (message: TerminalServerMessage) => socket.send(JSON.stringify(message));

    socket.on('message', (raw: Buffer) => {
      try {
        const message = parseClientMessage(raw);
        if (!message) {
          send({ type: 'error', message: 'Invalid websocket message' });
          return;
        }

        if (message.type === 'attach') {
          attach?.detach();
          attach = null;
          attachedSessionId = null;
          const session = context.sessions.getSession(message.sessionId);
          if (!session) {
            send({ type: 'status', sessionId: message.sessionId, status: 'unavailable', message: 'Session not found.' });
            return;
          }
          if (session.status !== 'running') {
            send({ type: 'status', sessionId: message.sessionId, status: 'stopped', message: 'Session is not running.' });
            return;
          }
          attach = context.terminals.attach({ sessionId: message.sessionId, cols: message.cols, rows: message.rows }, send);
          attachedSessionId = attach ? message.sessionId : null;
          return;
        }

        if (!attach || attachedSessionId !== message.sessionId) {
          send({ type: 'status', sessionId: message.sessionId, status: 'unavailable', message: 'Terminal is not attached.' });
          return;
        }

        if (message.type === 'input') attach.sendInput(message.data);
        if (message.type === 'resize') attach.resize(message.cols, message.rows);
        if (message.type === 'detach') {
          attach.detach();
          attach = null;
          attachedSessionId = null;
          send({ type: 'status', sessionId: message.sessionId, status: 'detached' });
        }
      } catch (error) {
        send({ type: 'error', message: error instanceof SyntaxError ? 'Invalid JSON' : errorMessage(error) });
      }
    });

    socket.on('close', () => {
      attach?.detach();
      attach = null;
      attachedSessionId = null;
    });
  });
}

function parseClientMessage(raw: Buffer): TerminalClientMessage | null {
  const decoded: unknown = JSON.parse(raw.toString());
  const parsed = terminalClientMessageSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
```

- [ ] **Step 5: Run the route test and confirm it passes**

Run:

```bash
npx vitest run tests/server/appRoutes.test.ts
```

Expected: PASS.

---

## Task 5: Wire Production Runtime to Tmux and Terminal Attach

**Files:**
- Modify: `src/server/index.ts`
- Modify: `tests/server/appRoutes.test.ts`

- [ ] **Step 1: Write the failing route expectation for tmux-backed creation**

In the existing `starts new sessions in available projects` test in `tests/server/appRoutes.test.ts`, keep the current expectation that `context.runner.start` is called. Add this assertion after it:

```ts
    expect(context.terminals.attach).not.toHaveBeenCalled();
```

This confirms session creation starts tmux runtime but does not attach a browser terminal until `/api/terminal/ws` is opened.

- [ ] **Step 2: Run the route test and confirm it still passes**

Run:

```bash
npx vitest run tests/server/appRoutes.test.ts
```

Expected: PASS. This is a regression guard, not a failing test.

- [ ] **Step 3: Wire `index.ts` to tmux runtime**

Modify `src/server/index.ts` imports:

```ts
import { TmuxClaudeRunner } from './services/tmuxClaudeRunner';
import { TerminalAttachService } from './services/terminalAttachService';
```

Remove the `StreamJsonClaudeEventSource` import from `src/server/index.ts`.

Replace the runner construction:

```ts
const runner = new TmuxClaudeRunner({ claudeBin: config.claudeBin });
```

Add the terminal attach service after runner construction:

```ts
const terminals = new TerminalAttachService({ targetForSession: (sessionId) => runner.tmuxTarget(sessionId) });
```

Pass `terminals` to `createApp`:

```ts
const app = await createApp({ config, projects, sessions, runner, hub, resumeIndex, transcripts, terminals });
```

- [ ] **Step 4: Run server tests touched so far**

Run:

```bash
npx vitest run tests/server/tmuxClaudeRunner.test.ts tests/server/terminalAttachService.test.ts tests/server/appRoutes.test.ts
```

Expected: PASS.

---

## Task 6: Add xterm.js Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install terminal emulator packages**

Run:

```bash
npm install @xterm/xterm @xterm/addon-fit
```

Expected: `package.json` gains dependencies for `@xterm/xterm` and `@xterm/addon-fit`, and `package-lock.json` updates.

- [ ] **Step 2: Verify dependency types are available**

Run:

```bash
npm run typecheck
```

Expected: Type checking may still fail because `TerminalView` is not implemented yet only if imports were added prematurely. If no terminal imports exist yet, expected result is PASS.

---

## Task 7: Browser Terminal View Component

**Files:**
- Create: `src/client/components/TerminalView.tsx`
- Create: `tests/client/TerminalView.test.tsx`

- [ ] **Step 1: Write the failing TerminalView tests**

Create `tests/client/TerminalView.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalView from '../../src/client/components/TerminalView';

const terminalInstances: FakeTerminal[] = [];

vi.mock('@xterm/xterm', () => ({
  Terminal: FakeTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: FakeFitAddon,
}));

vi.mock('../../src/client/api', () => ({
  openTerminalSocket: vi.fn(),
  sendTerminalWs: vi.fn(),
}));

import { openTerminalSocket, sendTerminalWs } from '../../src/client/api';

class FakeWebSocket extends EventTarget {
  readyState = WebSocket.OPEN;
  close = vi.fn();
}

class FakeTerminal {
  cols = 100;
  rows = 30;
  opened: HTMLElement | null = null;
  writes: string[] = [];
  disposed = false;
  private dataCallbacks: Array<(data: string) => void> = [];

  constructor(public options: unknown) {
    terminalInstances.push(this);
  }

  loadAddon = vi.fn();
  open = vi.fn((element: HTMLElement) => {
    this.opened = element;
  });
  write = vi.fn((data: string) => {
    this.writes.push(data);
  });
  focus = vi.fn();
  dispose = vi.fn(() => {
    this.disposed = true;
  });
  onData = vi.fn((callback: (data: string) => void) => {
    this.dataCallbacks.push(callback);
    return { dispose: vi.fn() };
  });

  fireData(data: string) {
    for (const callback of this.dataCallbacks) callback(data);
  }
}

class FakeFitAddon {
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
  dispose = vi.fn();
}

describe('TerminalView', () => {
  let socket: FakeWebSocket;

  beforeEach(() => {
    terminalInstances.length = 0;
    socket = new FakeWebSocket();
    vi.mocked(openTerminalSocket).mockReset();
    vi.mocked(sendTerminalWs).mockReset();
    vi.mocked(openTerminalSocket).mockReturnValue(socket as unknown as WebSocket);
    class FakeResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  it('attaches the terminal websocket when opened', async () => {
    render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);

    socket.dispatchEvent(new Event('open'));

    await waitFor(() => expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'attach', sessionId: 'session-1', cols: 100, rows: 30 }));
    expect(screen.getByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
  });

  it('writes terminal output messages into xterm', async () => {
    render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));

    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'output', sessionId: 'session-1', data: 'slash menu' }) }));

    await waitFor(() => expect(terminalInstances[0].write).toHaveBeenCalledWith('slash menu'));
  });

  it('sends xterm input and shortcut key input to the terminal websocket', async () => {
    render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));
    vi.mocked(sendTerminalWs).mockClear();

    terminalInstances[0].fireData('/help');
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }));
    fireEvent.click(screen.getByRole('button', { name: '↑' }));

    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '/help' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\x03' });
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '\x1b[A' });
  });

  it('shows rejected and disconnected states without leaving terminal mode', async () => {
    render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);
    socket.dispatchEvent(new Event('open'));

    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'status', sessionId: 'session-1', status: 'rejected', message: 'Terminal is already attached in another browser.' }) }));
    expect(await screen.findByText('Terminal is already attached in another browser.')).toBeInTheDocument();

    socket.dispatchEvent(new Event('close'));
    expect(await screen.findByText('终端连接已断开。')).toBeInTheDocument();
  });

  it('cleans up socket and terminal on unmount', () => {
    const { unmount } = render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);

    unmount();

    expect(socket.close).toHaveBeenCalled();
    expect(terminalInstances[0].dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused TerminalView test and confirm it fails**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx
```

Expected: FAIL because `TerminalView.tsx` does not exist.

- [ ] **Step 3: Implement `TerminalView`**

Create `src/client/components/TerminalView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalServerMessage } from '../../shared/types';
import { openTerminalSocket, sendTerminalWs } from '../api';

type TerminalViewProps = {
  sessionId: string;
  title: string;
  onBack(): void;
};

type TerminalUiStatus = 'connecting' | 'attached' | 'detached' | 'stopped' | 'unavailable' | 'rejected' | 'error' | 'disconnected';

const shortcuts = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Enter', data: '\r' },
];

export default function TerminalView({ sessionId, title, onBack }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<TerminalUiStatus>('connecting');
  const [message, setMessage] = useState('正在连接终端...');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      scrollback: 2000,
      convertEol: false,
      theme: {
        background: '#050505',
        foreground: '#f4f4f5',
        cursor: '#facc15',
        selectionBackground: '#334155',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();
    fitAddon.fit();
    terminalRef.current = terminal;

    const socket = openTerminalSocket();
    socketRef.current = socket;
    let attached = false;

    const sendInput = (data: string) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      sendTerminalWs(socketRef.current, { type: 'input', sessionId, data });
    };

    const inputDisposable = terminal.onData(sendInput);

    const sendResize = () => {
      const dims = fitAddon.proposeDimensions();
      if (!dims || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      const messageType = attached ? 'resize' : 'attach';
      sendTerminalWs(socketRef.current, { type: messageType, sessionId, cols: dims.cols, rows: dims.rows });
    };

    socket.addEventListener('open', () => {
      setStatus('connecting');
      setMessage('正在附加 tmux 终端...');
      sendResize();
    });

    socket.addEventListener('message', (event) => {
      const parsed = parseTerminalMessage(event.data);
      if (!parsed) return;
      if ('sessionId' in parsed && parsed.sessionId && parsed.sessionId !== sessionId) return;

      if (parsed.type === 'output') {
        terminal.write(parsed.data);
        return;
      }

      if (parsed.type === 'status') {
        setStatus(parsed.status);
        setMessage(parsed.message ?? statusText(parsed.status));
        attached = parsed.status === 'attached';
        return;
      }

      if (parsed.type === 'error') {
        setStatus('error');
        setMessage(parsed.message);
      }
    });

    socket.addEventListener('error', () => {
      setStatus('error');
      setMessage('终端连接异常。');
    });

    socket.addEventListener('close', () => {
      setStatus('disconnected');
      setMessage('终端连接已断开。');
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (attached) sendResize();
    });
    resizeObserver.observe(container);

    return () => {
      inputDisposable.dispose();
      resizeObserver.disconnect();
      socket.close();
      socketRef.current = null;
      terminal.dispose();
      fitAddon.dispose();
      terminalRef.current = null;
    };
  }, [sessionId]);

  function sendShortcut(data: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    sendTerminalWs(socket, { type: 'input', sessionId, data });
    terminalRef.current?.focus();
  }

  return (
    <section className="terminal-view" aria-label="Claude Code terminal">
      <header className="terminal-header">
        <div>
          <p className="eyebrow">Terminal takeover</p>
          <h2>{title}</h2>
          <p className={`terminal-status ${status}`}>{message}</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={onBack}>
          返回对话
        </button>
      </header>

      <div ref={containerRef} className="terminal-container" />

      <div className="terminal-shortcut-bar" aria-label="Terminal shortcuts">
        {shortcuts.map((shortcut) => (
          <button key={shortcut.label} className="terminal-key" type="button" onClick={() => sendShortcut(shortcut.data)}>
            {shortcut.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function parseTerminalMessage(raw: unknown): TerminalServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as TerminalServerMessage;
  } catch {
    return null;
  }
}

function statusText(status: TerminalUiStatus): string {
  if (status === 'attached') return '终端已连接。';
  if (status === 'detached') return '终端已分离。';
  if (status === 'stopped') return '会话已停止。';
  if (status === 'unavailable') return '终端会话不可用。';
  if (status === 'rejected') return '此终端正在被另一个浏览器控制。';
  if (status === 'error') return '终端连接失败。';
  if (status === 'disconnected') return '终端连接已断开。';
  return '正在连接终端...';
}
```

- [ ] **Step 4: Run the focused TerminalView test and confirm it passes**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx
```

Expected: PASS.

---

## Task 8: Integrate Terminal Mode into ChatView

**Files:**
- Modify: `src/client/components/ChatView.tsx`
- Modify: `tests/client/ChatViewStream.test.tsx`

- [ ] **Step 1: Mock TerminalView in ChatView tests and add terminal mode test**

In `tests/client/ChatViewStream.test.tsx`, add this mock after the API mock:

```ts
vi.mock('../../src/client/components/TerminalView', () => ({
  default: ({ sessionId, title, onBack }: { sessionId: string; title: string; onBack(): void }) => (
    <section aria-label="Claude Code terminal">
      <h3>{title}</h3>
      <p>terminal session: {sessionId}</p>
      <button type="button" onClick={onBack}>返回对话</button>
    </section>
  ),
}));
```

Add this test inside the existing `describe` block:

```tsx
it('opens terminal mode for a running Claude session without sending slash commands through the web composer', async () => {
  render(<ChatView session={session} commandEntries={slashCommands()} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
  socket.dispatchEvent(new Event('open'));

  fireEvent.click(await screen.findByRole('button', { name: '终端模式' }));

  expect(await screen.findByRole('region', { name: 'Claude Code terminal' })).toBeInTheDocument();
  expect(screen.getByText(`terminal session: ${session.id}`)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('输入要发送给 Claude Code 的内容...')).not.toBeInTheDocument();
  expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();
});

it('returns from terminal mode to the existing structured conversation view', async () => {
  render(<ChatView session={session} onStatusChange={vi.fn()} onBackToSessions={vi.fn()} onStop={vi.fn()} />);
  socket.dispatchEvent(new Event('open'));

  fireEvent.click(await screen.findByRole('button', { name: '终端模式' }));
  fireEvent.click(await screen.findByRole('button', { name: '返回对话' }));

  expect(await screen.findByPlaceholderText('输入要发送给 Claude Code 的内容...')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused ChatView test and confirm it fails**

Run:

```bash
npx vitest run tests/client/ChatViewStream.test.tsx
```

Expected: FAIL because ChatView does not expose terminal mode.

- [ ] **Step 3: Add TerminalView import and mode state**

Modify imports in `src/client/components/ChatView.tsx`:

```ts
import TerminalView from './TerminalView';
```

Add state near existing state declarations:

```ts
  const [viewMode, setViewMode] = useState<'conversation' | 'terminal'>('conversation');
```

In the `useEffect` that resets session state, add this reset after `setVisibleError('');`:

```ts
    setViewMode('conversation');
```

- [ ] **Step 4: Add terminal mode action button**

Inside the `chat-status-actions` div in `ChatView.tsx`, before the stop button, add:

```tsx
          {isClaudeSession(session) && session.status === 'running' ? (
            <button className="secondary-button compact" type="button" onClick={() => setViewMode(viewMode === 'terminal' ? 'conversation' : 'terminal')}>
              {viewMode === 'terminal' ? '对话模式' : '终端模式'}
            </button>
          ) : null}
```

- [ ] **Step 5: Render TerminalView instead of composer and structured stream in terminal mode**

After the visible error banner and before the transcript/render/message conditional, add:

```tsx
      {viewMode === 'terminal' && isClaudeSession(session) ? (
        <TerminalView sessionId={session.id} title={transcript?.title ?? streamState.session?.title ?? session.title} onBack={() => setViewMode('conversation')} />
      ) : (
        <>
```

Wrap the existing transcript/render/message block, `SessionStatusline`, and `ChatComposer` in that fragment. Close it before the closing `</section>`:

```tsx
        </>
      )}
```

The resulting structure should be:

```tsx
      {visibleError ? <div className="error-banner">{visibleError}</div> : null}

      {viewMode === 'terminal' && isClaudeSession(session) ? (
        <TerminalView sessionId={session.id} title={transcript?.title ?? streamState.session?.title ?? session.title} onBack={() => setViewMode('conversation')} />
      ) : (
        <>
          {transcript ? (
            <TranscriptView transcript={transcript} loadingOlder={transcriptLoadingOlder} onLoadOlder={onLoadOlderTranscript} />
          ) : streamState.render ? (
            <SessionRenderSurface render={streamState.render} disabled={connectionState !== 'connected'} onAction={handleAction} />
          ) : (
            <>
              <MessageStream blocks={streamState.blocks} />
              {activity === 'working' ? <div className="live-activity" role="status">Claude 正在处理…</div> : null}
              <PromptActions interaction={interaction} disabled={connectionState !== 'connected'} onAction={handleAction} />
            </>
          )}

          <SessionStatusline statusline={streamState.statusline} />

          <ChatComposer
            value={input}
            disabled={connectionState !== 'connected'}
            commandEntries={commandEntries}
            resumeCandidates={resumeCandidates}
            onChange={setInput}
            onSubmit={() => handleSubmit({ preventDefault: () => undefined })}
            onOpenHistorySession={onOpenHistorySession}
          />
        </>
      )}
```

- [ ] **Step 6: Run the focused ChatView test and confirm it passes**

Run:

```bash
npx vitest run tests/client/ChatViewStream.test.tsx
```

Expected: PASS.

---

## Task 9: Terminal Styling for Mobile

**Files:**
- Modify: `src/client/styles.css`
- Modify: `tests/client/TerminalView.test.tsx`

- [ ] **Step 1: Add a test for terminal layout classes**

Add this test to `tests/client/TerminalView.test.tsx`:

```tsx
it('renders mobile terminal layout and shortcut bar classes', () => {
  const { container } = render(<TerminalView sessionId="session-1" title="New session" onBack={vi.fn()} />);

  expect(container.querySelector('.terminal-view')).toBeInTheDocument();
  expect(container.querySelector('.terminal-container')).toBeInTheDocument();
  expect(container.querySelector('.terminal-shortcut-bar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Esc' })).toHaveClass('terminal-key');
});
```

- [ ] **Step 2: Run the focused TerminalView test**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx
```

Expected: PASS, because the classes already exist from Task 7. This guards the selectors used by CSS.

- [ ] **Step 3: Add terminal CSS**

Append this CSS to `src/client/styles.css`:

```css
.terminal-view {
  display: grid;
  grid-template-rows: auto minmax(320px, 1fr) auto;
  min-height: min(720px, calc(100vh - 220px));
  gap: 0.75rem;
}

.terminal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.terminal-header h2 {
  margin: 0.15rem 0;
}

.terminal-status {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.terminal-status.attached {
  color: #86efac;
}

.terminal-status.rejected,
.terminal-status.unavailable,
.terminal-status.error,
.terminal-status.disconnected,
.terminal-status.stopped {
  color: #fca5a5;
}

.terminal-container {
  min-height: 320px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 18px;
  background: #050505;
  padding: 0.5rem;
}

.terminal-container .xterm {
  height: 100%;
}

.terminal-shortcut-bar {
  display: flex;
  gap: 0.45rem;
  overflow-x: auto;
  padding: 0.35rem 0.1rem 0.1rem;
  scrollbar-width: thin;
}

.terminal-key {
  flex: 0 0 auto;
  min-width: 3rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.92);
  color: var(--text);
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.86rem;
}

.terminal-key:active {
  transform: translateY(1px);
  background: rgba(30, 41, 59, 0.98);
}

@media (max-width: 720px) {
  .terminal-view {
    min-height: calc(100vh - 170px);
  }

  .terminal-header {
    align-items: center;
  }

  .terminal-container {
    min-height: calc(100vh - 310px);
    border-radius: 14px;
    padding: 0.35rem;
  }

  .terminal-shortcut-bar {
    margin-inline: -0.25rem;
    padding-bottom: 0.35rem;
  }
}
```

- [ ] **Step 4: Run client terminal tests**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx tests/client/ChatViewStream.test.tsx
```

Expected: PASS.

---

## Task 10: End-to-End Route and Runtime Type Safety

**Files:**
- Modify only files needed to fix issues found by typecheck or tests.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If it fails, fix only the reported type errors in the files touched by this plan.

- [ ] **Step 2: Run focused server and client test set**

Run:

```bash
npx vitest run tests/server/tmuxClaudeRunner.test.ts tests/server/terminalAttachService.test.ts tests/server/appRoutes.test.ts tests/client/api.test.ts tests/client/TerminalView.test.tsx tests/client/ChatViewStream.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Build the app**

Run:

```bash
npm run build
```

Expected: PASS.

---

## Task 11: Manual Mobile Verification

**Files:**
- No source files changed in this task.

- [ ] **Step 1: Confirm tmux exists in the environment**

Run:

```bash
tmux -V
```

Expected: prints tmux version. If tmux is missing, install it in the development environment before manual verification.

- [ ] **Step 2: Start the dev server**

Run:

```bash
./start-dev.sh
```

Expected: server listens on port 8787 and uses `./webagent-dev.db`.

- [ ] **Step 3: Open the app on desktop browser first**

Open the local app at the dev server URL shown by the script. Authenticate with the configured app token. Select a project and create a new session.

Expected: the live session appears in the session list and the chat view shows a `终端模式` button.

- [ ] **Step 4: Verify terminal mode on desktop**

Click `终端模式`.

Expected:
- The terminal panel opens.
- Claude Code native TUI renders inside the black terminal area.
- Typing ordinary text into the terminal sends input to Claude Code.
- The shortcut bar buttons are visible.

- [ ] **Step 5: Verify slash command rendering**

In terminal mode, type `/`.

Expected:
- Claude Code's native slash command menu renders inside the terminal.
- The web app does not show the old React slash command listbox.
- `↑`, `↓`, `Tab`, `Enter`, and `Esc` shortcut buttons operate the terminal menu.

- [ ] **Step 6: Verify mobile browser interaction**

Open the dev server from a phone using the configured Tailscale/portproxy route for port 8787. Select the same project, open the running session, and click `终端模式`.

Expected:
- Terminal output is readable on the phone.
- Soft keyboard input reaches Claude Code.
- `Ctrl+C` sends interrupt.
- `Ctrl+D` sends EOF.
- Arrow keys and `Esc` work from the shortcut bar.

- [ ] **Step 7: Verify reconnect behavior**

Close the phone browser tab, wait a few seconds, then reopen the app and open terminal mode for the same running session.

Expected:
- Claude Code is still alive inside tmux.
- Browser reconnect starts a new `tmux attach-session` PTY.
- The previous browser disconnect did not stop the tmux session.

- [ ] **Step 8: Verify single-controller behavior**

Open terminal mode for the same session in one browser, then try to open terminal mode for the same session in another browser.

Expected: the second browser shows the rejected state: `Terminal is already attached in another browser.`

- [ ] **Step 9: Verify stop behavior**

Click the existing `停止` button for the session.

Expected:
- The tmux session is killed.
- The app session is marked stopped.
- Reopening terminal mode for that session shows stopped or unavailable state.

---

## Self-Review Checklist

**Spec coverage:**
- Web-created sessions run in tmux: Task 2 and Task 5.
- Browser PTY attach to tmux: Task 3 and Task 4.
- Raw terminal stream to xterm.js: Task 7.
- Mobile shortcut key bar for slash and control input: Task 7 and Task 11.
- Single active controller per app session: Task 3, Task 4, and Task 11.
- Browser detach does not kill tmux: Task 3 and Task 11.
- Stop kills tmux: Task 2 and Task 11.
- Existing structured UI remains available: Task 8 keeps conversation mode and adds terminal mode as explicit toggle.

**Placeholder scan:** This plan contains no unresolved implementation placeholders. The only variable examples are concrete runtime identifiers such as `sessionId`, `webagent-${sessionId}`, and `session-1`.

**Type consistency:**
- `TerminalClientMessage` and `TerminalServerMessage` are defined in Task 1 and used consistently in Tasks 3, 4, and 7.
- `TerminalAttachService.attach()` returns an object with `sendInput`, `resize`, and `detach`, used consistently by the route tests and route implementation.
- `TmuxClaudeRunner.tmuxTarget(sessionId)` returns `string | null`, used by `TerminalAttachService` construction in Task 5.
