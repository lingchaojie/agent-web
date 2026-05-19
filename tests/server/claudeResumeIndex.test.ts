import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeResumeIndex } from '../../src/server/services/claudeResumeIndex';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-resume-index-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ClaudeResumeIndex', () => {
  it('appends Claude Code history entries for native sessions', () => {
    const index = new ClaudeResumeIndex(root);

    index.record({ projectPath: '/tmp/demo', sessionId: 'native-session-1', prompt: '你好\n', timestamp: 123 });

    const entries = readHistory();
    expect(entries).toEqual([{
      display: '你好',
      pastedContents: {},
      timestamp: 123,
      project: '/tmp/demo',
      sessionId: 'native-session-1',
    }]);
  });

  it('does not duplicate existing project session prompt entries', () => {
    const index = new ClaudeResumeIndex(root);

    index.record({ projectPath: '/tmp/demo', sessionId: 'native-session-1', prompt: 'hello', timestamp: 123 });
    index.record({ projectPath: '/tmp/demo', sessionId: 'native-session-1', prompt: 'hello', timestamp: 456 });

    expect(readHistory()).toHaveLength(1);
  });

  it('ignores blank prompts', () => {
    const index = new ClaudeResumeIndex(root);

    index.record({ projectPath: '/tmp/demo', sessionId: 'native-session-1', prompt: '  \n' });

    expect(existsSync(join(root, 'history.jsonl'))).toBe(false);
  });
});

function readHistory() {
  return readFileSync(join(root, 'history.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}
