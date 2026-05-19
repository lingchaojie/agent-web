import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ClaudeResumeIndexEntry = {
  display: string;
  pastedContents: Record<string, never>;
  timestamp: number;
  project: string;
  sessionId: string;
};

export class ClaudeResumeIndex {
  constructor(private readonly claudeConfigDir: string) {}

  record(input: { projectPath: string; sessionId: string; prompt: string; timestamp?: number }): void {
    const display = input.prompt.trim();
    if (!display) return;

    const entry: ClaudeResumeIndexEntry = {
      display,
      pastedContents: {},
      timestamp: input.timestamp ?? Date.now(),
      project: input.projectPath,
      sessionId: input.sessionId,
    };
    const historyPath = join(this.claudeConfigDir, 'history.jsonl');
    if (this.hasEntry(historyPath, entry.project, entry.sessionId, entry.display)) return;

    mkdirSync(dirname(historyPath), { recursive: true });
    appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
  }

  private hasEntry(historyPath: string, project: string, sessionId: string, display: string): boolean {
    try {
      const lines = readFileSync(historyPath, 'utf8').split('\n').filter(Boolean);
      return lines.some((line) => {
        try {
          const entry = JSON.parse(line) as Partial<ClaudeResumeIndexEntry>;
          return entry.project === project && entry.sessionId === sessionId && entry.display === display;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }
}
