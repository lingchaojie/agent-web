import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class ClaudeTranscriptNormalizer {
  constructor(private readonly claudeConfigDir: string) {}

  normalizeEntrypoint(input: { projectPath: string; sessionId: string }): void {
    const transcriptPath = join(this.claudeConfigDir, 'projects', projectPathToKey(input.projectPath), `${input.sessionId}.jsonl`);
    if (!existsSync(transcriptPath)) return;

    const original = readFileSync(transcriptPath, 'utf8');
    const normalized = original.split('\n').map((line) => normalizeLine(line, input.sessionId)).join('\n');
    if (normalized === original) return;

    const tmpPath = join(dirname(transcriptPath), `.${input.sessionId}.jsonl.tmp-${process.pid}`);
    writeFileSync(tmpPath, normalized);
    renameSync(tmpPath, transcriptPath);
  }
}

function normalizeLine(line: string, sessionId: string): string {
  if (!line.trim() || !line.includes('"entrypoint":"sdk-cli"')) return line;
  try {
    const parsed = JSON.parse(line) as { sessionId?: string; entrypoint?: string };
    if (parsed.sessionId !== sessionId || parsed.entrypoint !== 'sdk-cli') return line;
    parsed.entrypoint = 'cli';
    return JSON.stringify(parsed);
  } catch {
    return line;
  }
}

function projectPathToKey(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}
