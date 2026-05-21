import { describe, expect, it, vi } from 'vitest';
import { TerminalAttachService } from '../../src/server/services/terminalAttachService';
import type { TerminalServerMessage } from '../../src/shared/types';

describe('TerminalAttachService', () => {
  it('spawns tmux attach in a PTY and forwards output', () => {
    const pty = fakePty();
    const spawn = vi.fn(() => pty);
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });
    const sent: TerminalServerMessage[] = [];

    const attach = service.attach({ sessionId: 'session-1', cols: 90, rows: 28 }, (message) => sent.push(message));
    pty.fireData('hello terminal');

    expect(spawn).toHaveBeenCalledWith('tmux', ['attach-session', '-t', 'webagent-session-1'], {
      name: 'xterm-256color',
      cols: 90,
      rows: 28,
      cwd: process.cwd(),
      env: process.env,
    });
    expect(attach).not.toBeNull();
    expect(sent).toEqual([
      { type: 'status', sessionId: 'session-1', status: 'attached' },
      { type: 'output', sessionId: 'session-1', data: 'hello terminal' },
    ]);
  });

  it('spawns tmux attach with custom target args and cwd', () => {
    const pty = fakePty();
    const spawn = vi.fn(() => pty);
    const service = new TerminalAttachService({
      spawn,
      targetForSession: () => ({ args: ['-S', '/tmp/tmux/default', 'attach-session', '-t', 'external'], cwd: '/tmp/project' }),
    });

    service.attach({ sessionId: 'external-session', cols: 80, rows: 24 }, vi.fn());

    expect(spawn).toHaveBeenCalledWith('tmux', ['-S', '/tmp/tmux/default', 'attach-session', '-t', 'external'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp/project',
      env: process.env,
    });
  });

  it('returns unavailable when the session has no tmux target', () => {
    const service = new TerminalAttachService({ spawn: vi.fn(), targetForSession: () => null });
    const sent: TerminalServerMessage[] = [];

    const attach = service.attach({ sessionId: 'session-1' }, (message) => sent.push(message));

    expect(attach).toBeNull();
    expect(sent).toEqual([{ type: 'status', sessionId: 'session-1', status: 'unavailable', message: 'Terminal session is unavailable.' }]);
  });

  it('rejects a second active attach to the same session', () => {
    const spawn = vi.fn(() => fakePty());
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });
    const firstMessages: TerminalServerMessage[] = [];
    const secondMessages: TerminalServerMessage[] = [];

    const first = service.attach({ sessionId: 'session-1' }, (message) => firstMessages.push(message));
    const second = service.attach({ sessionId: 'session-1' }, (message) => secondMessages.push(message));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(secondMessages).toEqual([{ type: 'status', sessionId: 'session-1', status: 'rejected', message: 'Terminal is already attached in another browser.' }]);
  });

  it('writes input and resizes the active attach PTY', () => {
    const pty = fakePty();
    const service = new TerminalAttachService({ spawn: vi.fn(() => pty), targetForSession: () => 'webagent-session-1' });
    const attach = service.attach({ sessionId: 'session-1' }, vi.fn());

    attach?.sendInput('\x03');
    attach?.resize(120, 40);

    expect(pty.write).toHaveBeenCalledWith('\x03');
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('detaches only the active attach PTY and releases the slot', () => {
    const firstPty = fakePty();
    const secondPty = fakePty();
    const spawn = vi.fn().mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });

    const first = service.attach({ sessionId: 'session-1' }, vi.fn());
    first?.detach();
    const second = service.attach({ sessionId: 'session-1' }, vi.fn());

    expect(firstPty.kill).toHaveBeenCalledTimes(1);
    expect(secondPty.kill).not.toHaveBeenCalled();
    expect(second).not.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('releases active attach when the PTY exits', () => {
    const firstPty = fakePty();
    const secondPty = fakePty();
    const spawn = vi.fn().mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    const service = new TerminalAttachService({ spawn, targetForSession: () => 'webagent-session-1' });
    const sent: TerminalServerMessage[] = [];

    service.attach({ sessionId: 'session-1' }, (message) => sent.push(message));
    firstPty.fireExit({ exitCode: 0 });
    const second = service.attach({ sessionId: 'session-1' }, vi.fn());

    expect(second).not.toBeNull();
    expect(sent).toContainEqual({ type: 'status', sessionId: 'session-1', status: 'detached' });
  });
});

type ExitEvent = { exitCode: number; signal?: number };

function fakePty() {
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(event: ExitEvent) => void> = [];
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((callback: (data: string) => void) => dataCallbacks.push(callback)),
    onExit: vi.fn((callback: (event: ExitEvent) => void) => exitCallbacks.push(callback)),
    fireData(data: string) {
      for (const callback of dataCallbacks) callback(data);
    },
    fireExit(event: ExitEvent) {
      for (const callback of exitCallbacks) callback(event);
    },
  };
}
