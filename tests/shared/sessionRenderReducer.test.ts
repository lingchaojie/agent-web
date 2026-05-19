import { describe, expect, it } from 'vitest';
import { emptySessionRenderState, applyClaudeEventToRenderState } from '../../src/shared/sessionRender';
import type { ClaudeSemanticEvent } from '../../src/server/services/claudeEventSource';

describe('CLI-like session render reducer', () => {
  it('streams assistant text through one active region and finalizes once', () => {
    let state = emptySessionRenderState('session-1');

    for (const event of [
      claudeEvent({ type: 'assistant-message-started', messageId: 'msg-1', text: '' }),
      claudeEvent({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hel' }),
      claudeEvent({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hello' }),
    ]) {
      state = applyClaudeEventToRenderState(state, event);
    }

    expect(state.regions).toEqual([]);
    expect(state.activeRegion).toMatchObject({ id: 'msg-1', kind: 'assistant', text: 'Hello', status: 'streaming' });

    state = applyClaudeEventToRenderState(state, claudeEvent({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'Hello' }));

    expect(state.activeRegion).toBeNull();
    expect(state.regions).toEqual([expect.objectContaining({ id: 'msg-1', kind: 'assistant', text: 'Hello', status: 'final' })]);
  });

  it('renders tools and permission prompts as distinct non-prose regions', () => {
    let state = emptySessionRenderState('session-1');

    state = applyClaudeEventToRenderState(state, claudeEvent({ type: 'tool-use-completed', toolUseId: 'tool-1', name: 'Bash', input: { command: 'npm test' }, text: 'Bash\nnpm test' }));
    state = applyClaudeEventToRenderState(state, claudeEvent({
      type: 'permission-requested',
      promptId: 'permission-1',
      text: 'Allow Bash?',
      interaction: { kind: 'permission', raw: 'Allow Bash?', actions: [{ id: 'allow', label: 'Allow', input: '1', variant: 'allow' }] },
    }));

    expect(state.regions).toEqual([
      expect.objectContaining({ id: 'tool-1', kind: 'tool', text: 'Bash\nnpm test' }),
      expect.objectContaining({ id: 'permission-1', kind: 'interaction', text: 'Allow Bash?', interaction: expect.objectContaining({ kind: 'permission' }) }),
    ]);
    expect(state.activeRegion).toBeNull();
  });

  it('keeps status, thinking, usage, and unknown events out of visible transcript regions', () => {
    let state = emptySessionRenderState('session-1');

    for (const event of [
      claudeEvent({ type: 'usage-or-activity-updated', activity: 'working', activityLabel: 'requesting' }),
      claudeEvent({ type: 'unknown-structured-entry', originalType: 'future_event', text: 'raw future content' }),
      claudeEvent({ type: 'session-stopped', lifecycle: 'stopped', message: 'turn complete' }),
    ]) {
      state = applyClaudeEventToRenderState(state, event);
    }

    expect(state.regions).toEqual([]);
    expect(state.activeRegion).toBeNull();
    expect(state.transientStatus).toMatchObject({ activity: 'idle' });
    expect(state.diagnostics).toEqual([expect.objectContaining({ sourceType: 'future_event' })]);
  });
});

function claudeEvent(overrides: Record<string, unknown>): ClaudeSemanticEvent {
  return {
    sessionId: 'session-1',
    order: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ClaudeSemanticEvent;
}
