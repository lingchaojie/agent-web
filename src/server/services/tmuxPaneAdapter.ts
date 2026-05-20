import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TmuxPane } from './tmuxPaneDiscovery';

export type TmuxRun = (command: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

export class TmuxPaneAdapter {
  private readonly run: TmuxRun;

  constructor(options: { run?: TmuxRun } = {}) {
    this.run = options.run ?? defaultRun;
  }

  capture(pane: TmuxPane): Promise<string> {
    return this.run('tmux', [...socketArgs(pane), 'capture-pane', '-p', '-J', '-t', pane.paneId]);
  }

  async sendInput(pane: TmuxPane, text: string): Promise<void> {
    await this.run('tmux', [...socketArgs(pane), 'send-keys', '-t', pane.paneId, '-l', '--', text]);
    await this.run('tmux', [...socketArgs(pane), 'send-keys', '-t', pane.paneId, 'Enter']);
  }
}

export function diffPaneCapture(previous: string, next: string): string {
  if (!previous) return next.trim();
  if (next.startsWith(previous)) return next.slice(previous.length).trim();

  const previousLines = previous.split('\n');
  const nextLines = next.split('\n');
  const maxOverlap = Math.min(previousLines.length, nextLines.length);

  if (isSuffixSubsequence(previousLines, nextLines)) return '';

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previousLines.slice(-overlap).join('\n') === nextLines.slice(0, overlap).join('\n')) {
      return nextLines.slice(overlap).join('\n').trim();
    }
  }

  return next.trim();
}

function isSuffixSubsequence(previousLines: string[], nextLines: string[]): boolean {
  if (nextLines.length === 0 || nextLines.length > previousLines.length) return false;
  for (let index = 0; index <= previousLines.length - nextLines.length; index += 1) {
    if (previousLines.slice(index, index + nextLines.length).join('\n') === nextLines.join('\n')) return true;
  }
  return false;
}

async function defaultRun(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args);
  return stdout;
}

function socketArgs(pane: TmuxPane): string[] {
  return pane.socketPath ? ['-S', pane.socketPath] : [];
}
