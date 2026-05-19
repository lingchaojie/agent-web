import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('falls back safely when history is missing or malformed', () => {
    const missingDir = tempClaudeDir();
    const malformedDir = tempClaudeDir();
    writeFileSync(join(malformedDir, 'history.jsonl'), '{bad json}\n');

    expect(new ClaudeResumeTitleReader(missingDir).titleFor({ projectPath: '/tmp/demo', sessionId: 'missing', summary: 'Fallback' })).toBe('Fallback');
    expect(new ClaudeResumeTitleReader(malformedDir).titleFor({ projectPath: '/tmp/demo', sessionId: 'missing', summary: 'Fallback' })).toBe('Fallback');
  });

  it('ignores oversized history files and falls back', () => {
    const claudeDir = tempClaudeDir();
    writeFileSync(join(claudeDir, 'history.jsonl'), `${'x'.repeat(10 * 1024 * 1024 + 1)}\n`);

    const reader = new ClaudeResumeTitleReader(claudeDir);

    expect(reader.titleFor({ projectPath: '/tmp/demo', sessionId: 'session-1', summary: 'Fallback' })).toBe('Fallback');
  });
});
