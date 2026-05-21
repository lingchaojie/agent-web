import pty from 'node-pty';
import type { TerminalServerMessage } from '../../shared/types';

type ExitEvent = { exitCode: number; signal?: number };

type PtyProcess = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: ExitEvent) => void): void;
};

type SpawnOptions = {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

type SpawnFn = (file: string, args: string[], options: SpawnOptions) => PtyProcess;

export type TerminalAttachTarget = string | { args: string[]; cwd?: string };

type AttachInput = {
  sessionId: string;
  cols?: number;
  rows?: number;
};
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
  private readonly spawn: SpawnFn;
  private readonly tmuxBin: string;

  constructor(private readonly options: { targetForSession(sessionId: string): TerminalAttachTarget | null; spawn?: SpawnFn; tmuxBin?: string }) {
    this.spawn = options.spawn ?? defaultSpawn;
    this.tmuxBin = options.tmuxBin ?? 'tmux';
  }

  attach(input: AttachInput, send: SendFn): TerminalAttach | null {
    const target = this.options.targetForSession(input.sessionId);
    if (!target) {
      send({ type: 'status', sessionId: input.sessionId, status: 'unavailable', message: 'Terminal session is unavailable.' });
      return null;
    }

    if (this.active.has(input.sessionId)) {
      send({ type: 'status', sessionId: input.sessionId, status: 'rejected', message: 'Terminal is already attached in another browser.' });
      return null;
    }

    const attachArgs = attachArgsForTarget(target);
    const proc = this.spawn(this.tmuxBin, attachArgs.args, {
      name: 'xterm-256color',
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
      cwd: attachArgs.cwd ?? process.cwd(),
      env: process.env,
    });

    this.active.set(input.sessionId, { proc, send });
    send({ type: 'status', sessionId: input.sessionId, status: 'attached' });

    proc.onData((data) => {
      if (this.active.get(input.sessionId)?.proc !== proc) return;
      send({ type: 'output', sessionId: input.sessionId, data });
    });

    proc.onExit(() => {
      if (this.active.get(input.sessionId)?.proc !== proc) return;
      this.active.delete(input.sessionId);
      send({ type: 'status', sessionId: input.sessionId, status: 'detached' });
    });

    return {
      sendInput: (data: string) => {
        if (this.active.get(input.sessionId)?.proc !== proc) return;
        proc.write(data);
      },
      resize: (cols: number, rows: number) => {
        if (this.active.get(input.sessionId)?.proc !== proc) return;
        proc.resize(cols, rows);
      },
      detach: () => {
        if (this.active.get(input.sessionId)?.proc !== proc) return;
        this.active.delete(input.sessionId);
        proc.kill();
      },
    };
  }
}

function attachArgsForTarget(target: TerminalAttachTarget): { args: string[]; cwd?: string } {
  if (typeof target === 'string') return { args: ['attach-session', '-t', target] };
  return target;
}

const defaultSpawn: SpawnFn = (file, args, options) => pty.spawn(file, args, {
  ...options,
  env: options.env as Record<string, string>,
});
