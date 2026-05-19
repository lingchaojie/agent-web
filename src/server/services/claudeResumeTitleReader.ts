import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type HistoryEntry = {
  project?: string;
  sessionId?: string;
  display?: string;
  timestamp?: number;
};

const MAX_HISTORY_BYTES = 10 * 1024 * 1024;

export class ClaudeResumeTitleReader {
  constructor(private readonly claudeConfigDir: string) {}

  titleFor(input: { projectPath: string | null; sessionId: string; summary?: string }): string {
    const nativeTitle = input.projectPath ? this.nativeDisplay(input.projectPath, input.sessionId) : null;
    const summary = input.summary?.trim();
    return nativeTitle ?? (summary || 'Untitled session');
  }

  private nativeDisplay(projectPath: string, sessionId: string): string | null {
    const historyPath = join(this.claudeConfigDir, 'history.jsonl');
    if (!existsSync(historyPath)) return null;

    try {
      const stat = statSync(historyPath);
      if (!stat.isFile() || stat.size > MAX_HISTORY_BYTES) return null;

      let latest: { display: string; timestamp: number } | null = null;
      for (const line of readFileSync(historyPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const entry = parseLine(line);
        if (!entry || entry.project !== projectPath || entry.sessionId !== sessionId) continue;

        const display = entry.display?.trim();
        if (!display) continue;

        const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : 0;
        if (!latest || timestamp >= latest.timestamp) latest = { display, timestamp };
      }

      return latest?.display ?? null;
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
