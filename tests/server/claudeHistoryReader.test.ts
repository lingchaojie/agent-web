import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_TRANSCRIPT_BYTES,
  readClaudeHistory,
  projectKeyToPath,
} from '../../src/server/services/claudeHistoryReader';

const fixtureRoot = join(process.cwd(), 'tests/fixtures/claude-projects');

function createTempHistoryRoot(): string {
  return mkdtempSync(join(tmpdir(), 'claude-history-reader-'));
}

function writeTranscript(projectDir: string, sessionId: string, lines: unknown[]): void {
  writeFileSync(
    join(projectDir, `${sessionId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
  );
}

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

  it('uses cwd from transcript entries for projectPath before falling back to project key decoding', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-tmp-encoded-key');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'cwd-session', [
      { type: 'summary', summary: 'Project cwd', timestamp: '2026-05-18T11:00:00.000Z' },
      {
        type: 'assistant',
        timestamp: '2026-05-18T11:01:00.000Z',
        cwd: '/home/alvin/my-app',
        message: { role: 'assistant', content: 'Used cwd field.' },
      },
    ]);

    expect(readClaudeHistory(root)[0]).toMatchObject({
      projectKey: '-tmp-encoded-key',
      projectPath: '/home/alvin/my-app',
      sessionId: 'cwd-session',
    });
  });

  it('skips symlinked project directories and symlinked JSONL files', () => {
    const root = createTempHistoryRoot();
    const outsideRoot = createTempHistoryRoot();
    const realProjectDir = join(root, '-home-alvin-real');
    const outsideProjectDir = join(outsideRoot, 'outside-project');
    mkdirSync(realProjectDir);
    mkdirSync(outsideProjectDir);

    writeTranscript(realProjectDir, 'real-session', [
      { type: 'summary', summary: 'Real session', timestamp: '2026-05-18T12:00:00.000Z' },
    ]);
    writeTranscript(outsideProjectDir, 'linked-dir-session', [
      { type: 'summary', summary: 'Linked directory session', timestamp: '2026-05-18T12:01:00.000Z' },
    ]);
    writeTranscript(outsideProjectDir, 'linked-file-session', [
      { type: 'summary', summary: 'Linked file session', timestamp: '2026-05-18T12:02:00.000Z' },
    ]);

    symlinkSync(outsideProjectDir, join(root, '-home-alvin-linked-dir'));
    symlinkSync(
      join(outsideProjectDir, 'linked-file-session.jsonl'),
      join(realProjectDir, 'linked-file-session.jsonl'),
    );

    const sessions = readClaudeHistory(root);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      projectKey: '-home-alvin-real',
      sessionId: 'real-session',
      title: 'Real session',
    });
  });

  it('returns an empty list when history root is not a directory', () => {
    const root = createTempHistoryRoot();
    const fileRoot = join(root, 'not-a-directory');
    writeFileSync(fileRoot, 'not a directory');

    expect(readClaudeHistory(fileRoot)).toEqual([]);
  });

  it('skips transcripts larger than MAX_TRANSCRIPT_BYTES', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-large');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'small-session', [
      { type: 'summary', summary: 'Small session', timestamp: '2026-05-18T13:00:00.000Z' },
    ]);
    writeFileSync(join(projectDir, 'large-session.jsonl'), `${' '.repeat(MAX_TRANSCRIPT_BYTES + 1)}\n`);

    const sessions = readClaudeHistory(root);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'small-session',
      title: 'Small session',
    });
  });
});
