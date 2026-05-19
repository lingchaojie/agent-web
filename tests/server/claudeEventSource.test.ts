import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { activityStreamJsonLines, assistantStreamJsonLines, delayedNativeSessionIdLines, immediateNativeSessionIdLine, lifecycleStreamJsonLines, permissionFallbackBoundary, permissionPromptFixture, toolStreamJsonLines, transientThinkingStreamJsonLines, unknownStreamJsonLine } from '../fixtures/claudeStructuredEvents';
import { createStreamState, discoverClaudeEventSource, parseClaudeStreamJsonLine, StreamJsonClaudeEventSource } from '../../src/server/services/claudeEventSource';

describe('claude structured event source', () => {
  it('discovers Claude Code stream-json as the selected structured source', () => {
    const discovery = discoverClaudeEventSource('claude');

    expect(discovery.selected).toBe('structured');
    expect(discovery.capabilities[0]).toMatchObject({
      source: 'cli-stream-json',
      available: true,
      command: expect.arrayContaining(['claude', '-p', '--verbose', '--input-format=stream-json', '--output-format=stream-json']),
      supports: expect.objectContaining({
        stableSessionId: true,
        stableMessageId: true,
        orderedEvents: true,
        partialAssistantDeltas: true,
        toolUseEvents: true,
        permissionPromptEvents: false,
      }),
      permissionFallback: 'pty-interaction',
    });
  });

  it('records the PTY-only boundary for undocumented permission prompt events', () => {
    expect(permissionFallbackBoundary).toEqual({
      structuralPermissionEvents: false,
      fallback: expect.stringContaining('PTY interaction parsing is only allowed for permission or choice prompts'),
    });
    expect(permissionPromptFixture).toMatchObject({ source: 'pty-interaction', actions: ['Allow once', 'Deny'] });
  });

  it('maps assistant stream-json deltas into one ordered assistant lifecycle', () => {
    const state = createStreamState();
    const events = assistantStreamJsonLines.flatMap((line, index) => parseClaudeStreamJsonLine(line, 'web-session-1', index + 1, state));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session-started', sessionId: 'claude-session-1' }),
      expect.objectContaining({ type: 'assistant-message-started', messageId: 'msg-1' }),
      expect.objectContaining({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hello' }),
      expect.objectContaining({ type: 'assistant-message-delta', messageId: 'msg-1', text: 'Hello structured' }),
      expect.objectContaining({ type: 'assistant-message-completed', messageId: 'msg-1', text: 'Hello structured' }),
      expect.objectContaining({ type: 'usage-or-activity-updated', activity: 'idle' }),
    ]));
  });

  it('emits native session identity events from immediate and delayed stream-json session ids', () => {
    const immediate = parseClaudeStreamJsonLine(immediateNativeSessionIdLine, 'web-session-1', 1);
    const state = createStreamState();
    const delayed = delayedNativeSessionIdLines.flatMap((line, index) => parseClaudeStreamJsonLine(line, 'web-session-1', index + 1, state));

    expect(immediate).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session-identity-observed', claudeSessionId: 'native-session-immediate' }),
    ]));
    expect(delayed).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session-identity-observed', claudeSessionId: 'native-session-delayed' }),
    ]));
  });

  it('maps tool use events into structured tool lifecycle events', () => {
    const state = createStreamState();
    const events = toolStreamJsonLines.flatMap((line, index) => parseClaudeStreamJsonLine(line, 'web-session-1', index + 1, state));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-use-started', toolUseId: 'tool-1', name: 'Bash' }),
      expect.objectContaining({ type: 'tool-use-updated', toolUseId: 'tool-1', text: 'Bash\nnpm test' }),
      expect.objectContaining({ type: 'tool-use-completed', toolUseId: 'tool-1', text: 'Bash\nnpm test' }),
    ]));
  });

  it('maps structured activity updates without transcript text', () => {
    const state = createStreamState();
    const events = activityStreamJsonLines.flatMap((line, index) => parseClaudeStreamJsonLine(line, 'web-session-1', index + 1, state));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'usage-or-activity-updated', activity: 'working', activityLabel: 'hook started' }),
      expect.objectContaining({ type: 'usage-or-activity-updated', activity: 'working', activityLabel: 'Thinking' }),
      expect.objectContaining({ type: 'usage-or-activity-updated', activity: 'idle', activityLabel: '↑ 2 / ↓ 3' }),
    ]));
  });

  it('keeps top-level status and thinking block events transient', () => {
    const state = createStreamState();
    const events = transientThinkingStreamJsonLines.flatMap((line, index) => parseClaudeStreamJsonLine(line, 'web-session-1', index + 1, state));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'usage-or-activity-updated', activity: 'working', activityLabel: 'requesting' }),
      expect.objectContaining({ type: 'assistant-message-completed', messageId: 'msg-thinking', text: 'visible answer' }),
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unknown-structured-entry', originalType: 'status' }),
      expect.objectContaining({ type: 'unknown-structured-entry', originalType: 'content_block_delta' }),
      expect.objectContaining({ type: 'unknown-structured-entry', originalType: 'content_block_stop' }),
    ]));
  });

  it('maps structured lifecycle changes', () => {
    const events = lifecycleStreamJsonLines.flatMap((line, index) => parseClaudeStreamJsonLine(line, 'web-session-1', index + 1));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session-started', lifecycle: 'running' }),
      expect.objectContaining({ type: 'session-stopped', lifecycle: 'stopped', message: 'done' }),
      expect.objectContaining({ type: 'session-failed', lifecycle: 'failed', message: 'failed' }),
    ]));
  });

  it('maps unknown structured entries to diagnostics instead of assistant prose', () => {
    expect(parseClaudeStreamJsonLine(unknownStreamJsonLine, 'web-session-1', 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unknown-structured-entry', originalType: 'future_event', text: 'future_event' }),
    ]));
  });

  it('keeps successful print-mode result sessions reusable for the next turn', () => {
    const proc = fakeProcess();
    const spawn = vi.fn(() => proc as any);
    const source = new StreamJsonClaudeEventSource({ claudeBin: 'claude', spawn: spawn as any });
    const exits: Array<{ exitCode: number }> = [];
    source.start({ sessionId: 'web-session-1', cwd: '/tmp/project', mode: 'new' });
    source.onExit('web-session-1', (event) => exits.push(event));

    proc.emit('exit', 0, null);

    expect(exits).toEqual([{ exitCode: 0 }]);
    expect(source.isRunning('web-session-1')).toBe(true);
  });

  it('closes stream-json stdin after web input so Claude can flush resume metadata', () => {
    const proc = fakeProcess();
    const spawn = vi.fn(() => proc as any);
    const source = new StreamJsonClaudeEventSource({ claudeBin: 'claude', spawn: spawn as any });
    source.start({ sessionId: 'web-session-1', cwd: '/tmp/project', mode: 'new' });

    source.sendInput('web-session-1', 'hello');

    expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(proc.stdin.end).toHaveBeenCalledOnce();
  });

  it('starts a new stream-json process when sending a later turn after print-mode exit', () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const spawn = vi.fn()
      .mockReturnValueOnce(first as any)
      .mockReturnValueOnce(second as any);
    const source = new StreamJsonClaudeEventSource({ claudeBin: 'claude', spawn: spawn as any });
    source.start({ sessionId: 'web-session-1', cwd: '/tmp/project', mode: 'new' });
    first.emit('exit', 0, null);

    source.sendInput('web-session-1', 'follow-up');

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['-c']));
    expect(second.stdin.write).toHaveBeenCalledWith(expect.stringContaining('follow-up'));
  });

  it('resumes later turns with the observed native session id instead of most-recent continue', () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const spawn = vi.fn()
      .mockReturnValueOnce(first as any)
      .mockReturnValueOnce(second as any);
    const source = new StreamJsonClaudeEventSource({ claudeBin: 'claude', spawn: spawn as any });
    source.start({ sessionId: 'web-session-1', cwd: '/tmp/project', mode: 'new' });
    first.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'native-session-1' })}\n`);
    first.emit('exit', 0, null);

    source.sendInput('web-session-1', 'follow-up');

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['-r', 'native-session-1']));
    expect(spawn.mock.calls[1][1]).not.toContain('-c');
  });

  it('keeps resumed history sessions on the provided native session id before output arrives', () => {
    const first = fakeProcess();
    const second = fakeProcess();
    const spawn = vi.fn()
      .mockReturnValueOnce(first as any)
      .mockReturnValueOnce(second as any);
    const source = new StreamJsonClaudeEventSource({ claudeBin: 'claude', spawn: spawn as any });
    source.start({ sessionId: 'web-session-1', cwd: '/tmp/project', mode: 'resume', claudeSessionId: 'history-session-1' });
    first.emit('exit', 0, null);

    source.sendInput('web-session-1', 'follow-up');

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['-r', 'history-session-1']));
    expect(spawn.mock.calls[1][1]).not.toContain('-c');
  });
});

function fakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}
