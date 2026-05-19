import { describe, expect, it } from 'vitest';
import { toolResultJsonlEntry } from '../fixtures/claudeStructuredEvents';
import { mapClaudeEventToSemantic, mapClaudeJsonlEntryToSemantic } from '../../src/server/services/claudeSemanticMapper';

describe('claude semantic mapper', () => {
  it('maps equivalent live structured and restored JSONL text semantics to the same block model', () => {
    const live = mapClaudeEventToSemantic({
      type: 'assistant-message-completed',
      sessionId: 'session-1',
      messageId: 'msg-1',
      text: 'Shared answer',
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const [history] = mapClaudeJsonlEntryToSemantic({
      type: 'assistant',
      uuid: 'msg-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Shared answer' }] },
    });

    expect(live.block).toMatchObject({ kind: history.kind, text: history.text, status: history.status });
    expect(live.block?.source).toBe('structured');
    expect(history.source).toBe('history');
  });

  it('maps equivalent tool semantics to distinct tool blocks', () => {
    const live = mapClaudeEventToSemantic({
      type: 'tool-use-completed',
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      name: 'Bash',
      input: { command: 'npm test' },
      text: 'Bash\nnpm test',
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const [history] = mapClaudeJsonlEntryToSemantic({
      type: 'assistant',
      uuid: 'tool-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    });

    expect(live.block).toMatchObject({ kind: 'tool', text: 'Bash\nnpm test', status: 'final' });
    expect(history).toMatchObject({ kind: 'tool', text: 'Bash\nnpm test', status: 'final' });
  });

  it('maps restored JSONL tool results to tool blocks', () => {
    expect(mapClaudeJsonlEntryToSemantic(toolResultJsonlEntry)).toEqual([
      expect.objectContaining({ kind: 'tool', text: 'tests passed', status: 'final', source: 'history' }),
    ]);
  });

  it('keeps unknown structured events out of assistant prose', () => {
    const mapped = mapClaudeEventToSemantic({
      type: 'unknown-structured-entry',
      sessionId: 'session-1',
      originalType: 'future_event',
      text: 'raw future content',
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(mapped.block).toMatchObject({ kind: 'system', text: 'Unsupported structured event: future_event' });
  });
});
