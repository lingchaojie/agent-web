import { describe, expect, it } from 'vitest';
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

  it('maps history tool use, tool result, and thinking into collapsible non-direct blocks', () => {
    expect(mapClaudeJsonlEntryToSemantic({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'considering' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    })).toEqual([
      expect.objectContaining({ kind: 'system', text: 'Thinking\nconsidering' }),
      expect.objectContaining({ kind: 'tool', text: 'Bash\nnpm test' }),
    ]);

    expect(mapClaudeJsonlEntryToSemantic({
      type: 'user',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'passed' }] },
    })).toEqual([
      expect.objectContaining({ kind: 'tool', text: 'Tool result\npassed' }),
    ]);
  });

  it('maps synthetic skill loader user entries into collapsible system blocks', () => {
    expect(mapClaudeJsonlEntryToSemantic({
      type: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        role: 'user',
        content: 'Base directory for this skill: /home/alvin/.claude/plugins/cache/example/skills/brainstorming\n\n# Brainstorming Ideas Into Designs\n\nFull prompt text',
      },
    })).toEqual([
      expect.objectContaining({ kind: 'system', text: expect.stringContaining('Base directory for this skill:') }),
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
