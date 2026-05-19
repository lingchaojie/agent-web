import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeTranscriptNormalizer } from '../../src/server/services/claudeTranscriptNormalizer';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-transcript-normalizer-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ClaudeTranscriptNormalizer', () => {
  it('normalizes sdk-cli transcript entries for the target native session', () => {
    const projectPath = join(root, 'demo_project with spaces');
    const projectKey = projectPath.replace(/[^A-Za-z0-9]/g, '-');
    const projectRoot = join(root, 'projects', projectKey);
    mkdirSync(projectRoot, { recursive: true });
    const transcriptPath = join(projectRoot, 'native-session-1.jsonl');
    writeFileSync(transcriptPath, [
      JSON.stringify({ type: 'user', sessionId: 'native-session-1', entrypoint: 'sdk-cli', cwd: projectPath, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', sessionId: 'native-session-1', entrypoint: 'sdk-cli', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'last-prompt', sessionId: 'native-session-1', lastPrompt: 'hello' }),
      '',
    ].join('\n'));
    writeFileSync(join(projectRoot, 'other-session.jsonl'), `${JSON.stringify({ type: 'user', sessionId: 'other-session', entrypoint: 'sdk-cli' })}\n`);

    new ClaudeTranscriptNormalizer(root).normalizeEntrypoint({ projectPath, sessionId: 'native-session-1' });

    const normalized = readFileSync(transcriptPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(normalized[0]).toMatchObject({ entrypoint: 'cli' });
    expect(normalized[1]).toMatchObject({ entrypoint: 'cli' });
    expect(normalized[2]).not.toHaveProperty('entrypoint');
    expect(readFileSync(join(projectRoot, 'other-session.jsonl'), 'utf8')).toContain('"entrypoint":"sdk-cli"');
  });
});
