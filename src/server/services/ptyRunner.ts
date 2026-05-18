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

    proc.onExit(() => {
      if (this.processes.get(input.sessionId) === proc) {
        this.processes.delete(input.sessionId);
      }
    });

    this.processes.set(input.sessionId, proc);
  }

  onData(sessionId: string, callback: (data: string) => void): void {
    const proc = this.requireProcess(sessionId);
    proc.onData(callback);
  }

  onExit(sessionId: string, callback: (event: { exitCode: number; signal?: number }) => void): void {
    const proc = this.requireProcess(sessionId);
    proc.onExit(callback);
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
