import { describe, expect, it } from 'vitest';
import { applySessionStreamEvent, emptySessionStreamState } from '../../src/shared/sessionStream';
import type { ConversationBlock, SessionStatuslineState, SessionStreamEvent, SessionViewState } from '../../src/shared/types';

describe('session stream reducer', () => {
  it('applies a snapshot as the authoritative session view', () => {
    const session = sessionView({ lifecycle: 'running', activity: 'idle', latestSequence: 4 });
    const blocks = [block({ id: 'block-1', kind: 'assistant', text: 'hello', sequence: 3, status: 'final' })];

    const state = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: session.sessionId,
      sequence: 4,
      session,
      blocks,
    });

    expect(state.session).toEqual(session);
    expect(state.blocks).toEqual(blocks);
    expect(state.latestSequence).toBe(4);
  });

  it('ignores duplicate and older deltas without duplicating blocks or status', () => {
    const initial = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 10,
      session: sessionView({ latestSequence: 10 }),
      blocks: [block({ id: 'assistant-1', text: 'hello', sequence: 10 })],
    });

    const duplicate: SessionStreamEvent = {
      type: 'block-added',
      sessionId: 'session-1',
      sequence: 10,
      block: block({ id: 'assistant-1', text: 'hello again', sequence: 10 }),
    };

    expect(applySessionStreamEvent(initial, duplicate)).toEqual(initial);
  });

  it('updates an in-progress assistant block and finalizes it in place', () => {
    let state = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
    });

    state = applySessionStreamEvent(state, {
      type: 'block-added',
      sessionId: 'session-1',
      sequence: 2,
      block: block({ id: 'assistant-1', text: 'hel', sequence: 2, status: 'streaming' }),
    });
    state = applySessionStreamEvent(state, {
      type: 'block-updated',
      sessionId: 'session-1',
      sequence: 3,
      blockId: 'assistant-1',
      patch: { text: 'hello' },
    });
    state = applySessionStreamEvent(state, {
      type: 'block-finalized',
      sessionId: 'session-1',
      sequence: 4,
      blockId: 'assistant-1',
    });

    expect(state.blocks).toEqual([block({ id: 'assistant-1', text: 'hello', sequence: 2, status: 'final' })]);
    expect(state.latestSequence).toBe(4);
  });

  it('replaces stale state when a newer snapshot arrives', () => {
    const stale = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 5,
      session: sessionView({ latestSequence: 5 }),
      blocks: [block({ id: 'old', text: 'old', sequence: 5 })],
    });

    const replaced = applySessionStreamEvent(stale, {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 20,
      session: sessionView({ latestSequence: 20, activity: 'working' }),
      blocks: [block({ id: 'new', text: 'new', sequence: 20 })],
    });

    expect(replaced.blocks.map((item) => item.id)).toEqual(['new']);
    expect(replaced.session?.activity).toBe('working');
    expect(replaced.latestSequence).toBe(20);
  });

  it('applies render-state deltas without adding transcript blocks', () => {
    let state = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
    });

    state = applySessionStreamEvent(state, {
      type: 'render-changed',
      sessionId: 'session-1',
      sequence: 2,
      render: {
        sessionId: 'session-1',
        regions: [],
        activeRegion: { id: 'msg-1', kind: 'assistant', text: 'Hello', status: 'streaming', source: 'structured', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        transientStatus: { activity: 'working' },
        diagnostics: [],
        transcriptSource: 'structured',
        sequence: 2,
      },
    });

    expect(state.blocks).toEqual([]);
    expect(state.render?.activeRegion).toMatchObject({ id: 'msg-1', text: 'Hello', status: 'streaming' });
    expect(state.latestSequence).toBe(2);
  });

  it('applies activity and lifecycle deltas without adding transcript blocks', () => {
    let state = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 1,
      session: sessionView({ latestSequence: 1, lifecycle: 'idle', activity: 'idle' }),
      blocks: [],
    });

    state = applySessionStreamEvent(state, {
      type: 'activity-changed',
      sessionId: 'session-1',
      sequence: 2,
      activity: 'working',
      activityLabel: 'Thinking',
    });
    state = applySessionStreamEvent(state, {
      type: 'session-changed',
      sessionId: 'session-1',
      sequence: 3,
      patch: { lifecycle: 'waiting-for-input' },
    });

    expect(state.blocks).toEqual([]);
    expect(state.session).toMatchObject({ activity: 'working', activityLabel: 'Thinking', lifecycle: 'waiting-for-input' });
  });

  it('applies native identity deltas without resetting transcript blocks', () => {
    const initial = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 1,
      session: sessionView({ latestSequence: 1, claudeSessionId: null }),
      blocks: [block({ id: 'assistant-1', text: 'hello', sequence: 1 })],
    });

    const updated = applySessionStreamEvent(initial, {
      type: 'session-changed',
      sessionId: 'session-1',
      sequence: 2,
      patch: { claudeSessionId: 'native-session-1' },
    });
    const duplicate = applySessionStreamEvent(updated, {
      type: 'session-changed',
      sessionId: 'session-1',
      sequence: 2,
      patch: { claudeSessionId: 'native-session-1' },
    });

    expect(updated.blocks).toEqual(initial.blocks);
    expect(updated.session?.claudeSessionId).toBe('native-session-1');
    expect(duplicate).toEqual(updated);
  });

  it('stores statusline state from snapshots and ordered updates without transcript blocks', () => {
    const firstStatusline = statusline({ text: '[36mOpus 4.7[0m', sequence: 1 });
    let state = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 1,
      session: sessionView({ latestSequence: 1 }),
      blocks: [],
      statusline: firstStatusline,
    });

    expect(state.statusline).toEqual(firstStatusline);
    expect(state.blocks).toEqual([]);

    const nextStatusline = statusline({ text: '[32mGPT Usage[0m', sequence: 2 });
    state = applySessionStreamEvent(state, {
      type: 'statusline-changed',
      sessionId: 'session-1',
      sequence: 2,
      statusline: nextStatusline,
    });

    expect(state.statusline).toEqual(nextStatusline);
    expect(state.blocks).toEqual([]);
    expect(state.latestSequence).toBe(2);
  });

  it('ignores duplicate and older statusline updates', () => {
    const initialStatusline = statusline({ text: 'fresh', sequence: 3 });
    const initial = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 3,
      session: sessionView({ latestSequence: 3 }),
      blocks: [],
      statusline: initialStatusline,
    });

    const updated = applySessionStreamEvent(initial, {
      type: 'statusline-changed',
      sessionId: 'session-1',
      sequence: 2,
      statusline: statusline({ text: 'stale', sequence: 2 }),
    });

    expect(updated).toEqual(initial);
  });

  it('replaces statusline state when a different session snapshot arrives', () => {
    const sessionOne = applySessionStreamEvent(emptySessionStreamState(), {
      type: 'snapshot',
      sessionId: 'session-1',
      sequence: 1,
      session: sessionView({ sessionId: 'session-1', latestSequence: 1 }),
      blocks: [],
      statusline: statusline({ sessionId: 'session-1', text: 'session one', sequence: 1 }),
    });

    const sessionTwo = applySessionStreamEvent(sessionOne, {
      type: 'snapshot',
      sessionId: 'session-2',
      sequence: 1,
      session: sessionView({ sessionId: 'session-2', latestSequence: 1 }),
      blocks: [],
    });

    expect(sessionTwo.session?.sessionId).toBe('session-2');
    expect(sessionTwo.statusline).toBeUndefined();
  });
});

function sessionView(overrides: Partial<SessionViewState> = {}): SessionViewState {
  return {
    sessionId: 'session-1',
    projectId: 'project-1',
    title: 'Demo',
    lifecycle: 'running',
    activity: 'idle',
    connection: 'connected',
    transcriptSource: 'structured',
    claudeSessionId: null,
    latestSequence: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingInteraction: null,
    ...overrides,
  };
}

function block(overrides: Partial<ConversationBlock> = {}): ConversationBlock {
  return {
    id: 'block-1',
    sessionId: 'session-1',
    kind: 'assistant',
    text: '',
    sequence: 1,
    status: 'final',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'live',
    ...overrides,
  };
}

function statusline(overrides: Partial<SessionStatuslineState> = {}): SessionStatuslineState {
  return {
    sessionId: 'session-1',
    status: 'ready',
    text: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sequence: 1,
    ...overrides,
  };
}
