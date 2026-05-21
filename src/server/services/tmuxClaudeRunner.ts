import { execFileSync as defaultExecFileSync } from 'node:child_process';
import type {
  ClaudeEventSink,
  ClaudeEventSource,
  ClaudeEventSourceCapability,
  ClaudeEventSourceDiscovery,
  ClaudeEventSourceMode,
  ClaudeEventSourceStartInput,
} from './claudeEventSource';

type ExitEvent = { exitCode: number; signal?: number };

type ExecFileSyncFn = (file: string, args: readonly string[], options: { stdio: 'pipe' }) => unknown;

type TmuxClaudeRunnerOptions = {
  claudeBin: string;
  tmuxBin?: string;
  shellBin?: string;
  execFileSync?: ExecFileSyncFn;
  now?: () => Date;
};

type ResolvedTmuxClaudeRunnerOptions = {
  claudeBin: string;
  tmuxBin: string;
  shellBin: string;
  execFileSync: ExecFileSyncFn;
  now?: () => Date;
};

type RunningSession = {
  target: string;
  input: ClaudeEventSourceStartInput;
};

type CallbackSet<T> = Map<string, Set<T>>;

const TMUX_STDIO = { stdio: 'pipe' } as const;
const TMUX_ENV_KEYS = ['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NVM_DIR', 'VOLTA_HOME', 'PNPM_HOME', 'NODE_PATH', 'CLAUDE_CONFIG_DIR'] as const;

export function tmuxTargetForSession(sessionId: string): string {
  const sanitized = sessionId
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `webagent-${sanitized || 'session'}`;
}

export class TmuxClaudeRunner implements ClaudeEventSource {
  private readonly sessions = new Map<string, RunningSession>();
  private readonly eventCallbacks: CallbackSet<ClaudeEventSink> = new Map();
  private readonly fallbackCallbacks: CallbackSet<(data: string) => void> = new Map();
  private readonly exitCallbacks: CallbackSet<(event: ExitEvent) => void> = new Map();
  private readonly options: ResolvedTmuxClaudeRunnerOptions;

  constructor(options: TmuxClaudeRunnerOptions) {
    this.options = {
      claudeBin: options.claudeBin,
      tmuxBin: options.tmuxBin ?? 'tmux',
      shellBin: options.shellBin ?? process.env.SHELL ?? '/bin/sh',
      execFileSync: options.execFileSync ?? defaultExecFileSync,
      now: options.now,
    };
  }

  discover(): ClaudeEventSourceDiscovery {
    const capability: ClaudeEventSourceCapability = {
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
      notes: [
        'Tmux MVP launches Claude in a detached tmux session and relies on terminal fallback behavior.',
        'Structured Claude CLI stream-json events are not wired through this runner yet.',
      ],
    };

    return {
      selected: 'pty-fallback',
      capabilities: [capability],
    };
  }

  start(input: ClaudeEventSourceStartInput): void {
    if (this.sessions.has(input.sessionId)) throw new Error('Session already running');

    const target = tmuxTargetForSession(input.sessionId);
    this.execFileSync()(this.options.tmuxBin, [
      'new-session',
      '-d',
      ...tmuxEnvironmentArgs(process.env),
      '-s',
      target,
      '-c',
      input.cwd,
      '--',
      this.options.shellBin,
      '-lc',
      shellCommand([this.options.claudeBin, ...claudeArgsFor(input)]),
    ], TMUX_STDIO);

    this.sessions.set(input.sessionId, { target, input });
  }

  onEvent(sessionId: string, callback: ClaudeEventSink): void {
    this.registerCallback(this.eventCallbacks, sessionId, callback);
  }

  onFallbackOutput(sessionId: string, callback: (data: string) => void): void {
    this.registerCallback(this.fallbackCallbacks, sessionId, callback);
  }

  onExit(sessionId: string, callback: (event: ExitEvent) => void): void {
    this.registerCallback(this.exitCallbacks, sessionId, callback);
  }

  sendInput(sessionId: string, text: string): void {
    const target = this.requireTarget(sessionId);
    const lines = text.split(/\r\n|\n|\r/);

    for (const line of lines) {
      if (line) {
        this.execFileSync()(this.options.tmuxBin, ['send-keys', '-t', target, '-l', '--', line], TMUX_STDIO);
      }
      this.execFileSync()(this.options.tmuxBin, ['send-keys', '-t', target, 'Enter'], TMUX_STDIO);
    }
  }

  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      this.execFileSync()(this.options.tmuxBin, ['kill-session', '-t', session.target], TMUX_STDIO);
    } finally {
      this.sessions.delete(sessionId);
      this.emitExit(sessionId, { exitCode: 0 });
    }
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  modeForSession(sessionId: string): ClaudeEventSourceMode {
    if (!this.sessions.has(sessionId)) return 'pty-fallback';
    return 'pty-fallback';
  }

  tmuxTarget(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.target ?? null;
  }

  private execFileSync(): ExecFileSyncFn {
    return this.options.execFileSync;
  }

  private registerCallback<T>(callbacksBySession: CallbackSet<T>, sessionId: string, callback: T): void {
    const callbacks = callbacksBySession.get(sessionId) ?? new Set<T>();
    callbacks.add(callback);
    callbacksBySession.set(sessionId, callbacks);
  }

  private requireTarget(sessionId: string): string {
    const target = this.tmuxTarget(sessionId);
    if (!target) throw new Error('Session is not running');
    return target;
  }

  private emitExit(sessionId: string, event: ExitEvent): void {
    for (const callback of this.exitCallbacks.get(sessionId) ?? []) callback(event);
  }
}

function claudeArgsFor(input: ClaudeEventSourceStartInput): string[] {
  if (input.mode === 'continue') return ['-c'];
  if (input.mode === 'resume') return ['-r', input.claudeSessionId];
  return [];
}

function tmuxEnvironmentArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  for (const key of TMUX_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) args.push('-e', `${key}=${value}`);
  }
  return args;
}

function shellCommand(args: string[]): string {
  return args.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
