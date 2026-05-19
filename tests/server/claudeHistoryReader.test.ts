import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_TRANSCRIPT_BYTES,
  readClaudeHistory,
  readClaudeTranscriptWindow,
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

  it('restores transcript messages as ordered history conversation blocks with stable metadata', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-blocks');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'block-session', [
      { type: 'summary', summary: 'Block session', timestamp: '2026-05-18T13:59:00.000Z' },
      { type: 'user', timestamp: '2026-05-18T14:00:00.000Z', message: { role: 'user', content: 'First prompt' } },
      { type: 'assistant', timestamp: '2026-05-18T14:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'First response' }] } },
      { type: 'user', timestamp: '2026-05-18T14:02:00.000Z', message: { role: 'user', content: 'Second prompt' } },
    ]);

    const sessions = readClaudeHistory(root);

    expect(sessions[0].blocks).toEqual([
      expect.objectContaining({
        id: 'history-block-session-1',
        sessionId: 'block-session',
        kind: 'user',
        text: 'First prompt',
        sequence: 1,
        status: 'final',
        source: 'history',
        createdAt: '2026-05-18T14:00:00.000Z',
        updatedAt: '2026-05-18T14:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'history-block-session-2',
        sessionId: 'block-session',
        kind: 'assistant',
        text: 'First response',
        sequence: 2,
        status: 'final',
        source: 'history',
        createdAt: '2026-05-18T14:01:00.000Z',
        updatedAt: '2026-05-18T14:01:00.000Z',
      }),
      expect.objectContaining({
        id: 'history-block-session-3',
        sessionId: 'block-session',
        kind: 'user',
        text: 'Second prompt',
        sequence: 3,
        status: 'final',
        source: 'history',
        createdAt: '2026-05-18T14:02:00.000Z',
        updatedAt: '2026-05-18T14:02:00.000Z',
      }),
    ]);
  });

  it('maps identifiable history transcript parts to distinct block kinds', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-kinds');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'kind-session', [
      { type: 'system', timestamp: '2026-05-18T14:59:00.000Z', content: 'System notice' },
      { type: 'user', timestamp: '2026-05-18T15:00:00.000Z', message: { role: 'user', content: 'Run tests' } },
      { type: 'assistant', timestamp: '2026-05-18T15:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'I will run the tests.' }] } },
      { type: 'assistant', timestamp: '2026-05-18T15:02:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
      { type: 'user', timestamp: '2026-05-18T15:03:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'All tests passed.' }] } },
    ]);

    expect(readClaudeHistory(root)[0].blocks).toEqual([
      expect.objectContaining({ kind: 'system', text: 'System notice' }),
      expect.objectContaining({ kind: 'user', text: 'Run tests' }),
      expect.objectContaining({ kind: 'assistant', text: 'I will run the tests.' }),
      expect.objectContaining({ kind: 'tool', text: 'Bash\nnpm test' }),
      expect.objectContaining({ kind: 'tool', text: 'All tests passed.' }),
    ]);
  });

  it('loads the latest transcript window in chronological order with an older cursor', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-window');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'window-session', [
      { type: 'summary', summary: 'Window session', timestamp: '2026-05-18T15:59:00.000Z' },
      { type: 'user', timestamp: '2026-05-18T16:00:00.000Z', message: { role: 'user', content: 'Prompt 1' } },
      { type: 'assistant', timestamp: '2026-05-18T16:01:00.000Z', message: { role: 'assistant', content: 'Response 1' } },
      { type: 'user', timestamp: '2026-05-18T16:02:00.000Z', message: { role: 'user', content: 'Prompt 2' } },
      { type: 'assistant', timestamp: '2026-05-18T16:03:00.000Z', message: { role: 'assistant', content: 'Response 2' } },
    ]);

    const window = readClaudeTranscriptWindow(root, { sessionId: 'window-session', limit: 2 });

    expect(window).toEqual(expect.objectContaining({ sessionId: 'window-session', hasMoreOlder: true, olderCursor: '2' }));
    expect(window?.regions).toEqual([
      expect.objectContaining({ id: 'history-window-session-3', kind: 'user', text: 'Prompt 2' }),
      expect.objectContaining({ id: 'history-window-session-4', kind: 'assistant', text: 'Response 2' }),
    ]);
  });

  it('loads older transcript windows until the beginning is reached', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-older');
    mkdirSync(projectDir);
    writeTranscript(projectDir, 'older-session', [
      { type: 'summary', summary: 'Older session', timestamp: '2026-05-18T16:59:00.000Z' },
      { type: 'user', timestamp: '2026-05-18T17:00:00.000Z', message: { role: 'user', content: 'Prompt 1' } },
      { type: 'assistant', timestamp: '2026-05-18T17:01:00.000Z', message: { role: 'assistant', content: 'Response 1' } },
      { type: 'user', timestamp: '2026-05-18T17:02:00.000Z', message: { role: 'user', content: 'Prompt 2' } },
    ]);

    const window = readClaudeTranscriptWindow(root, { sessionId: 'older-session', limit: 2, before: '2' });

    expect(window).toEqual(expect.objectContaining({ sessionId: 'older-session', hasMoreOlder: false, olderCursor: null }));
    expect(window?.regions).toEqual([
      expect.objectContaining({ id: 'history-older-session-1', kind: 'user', text: 'Prompt 1' }),
      expect.objectContaining({ id: 'history-older-session-2', kind: 'assistant', text: 'Response 1' }),
    ]);
  });

  it('returns null for missing, oversized, or symlinked transcript windows', () => {
    const root = createTempHistoryRoot();
    const projectDir = join(root, '-home-alvin-unsafe');
    const outsideRoot = createTempHistoryRoot();
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, 'large-session.jsonl'), `${' '.repeat(MAX_TRANSCRIPT_BYTES + 1)}\n`);
    writeTranscript(outsideRoot, 'linked-session', [
      { type: 'summary', summary: 'Linked session', timestamp: '2026-05-18T18:00:00.000Z' },
    ]);
    symlinkSync(join(outsideRoot, 'linked-session.jsonl'), join(projectDir, 'linked-session.jsonl'));

    expect(readClaudeTranscriptWindow(root, { sessionId: 'missing-session' })).toBeNull();
    expect(readClaudeTranscriptWindow(root, { sessionId: 'large-session' })).toBeNull();
    expect(readClaudeTranscriptWindow(root, { sessionId: 'linked-session' })).toBeNull();
  });
});
