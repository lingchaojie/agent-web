import { describe, expect, it, vi } from 'vitest';
import { PtyRunner } from '../../src/server/services/ptyRunner';

describe('PtyRunner', () => {
  it('starts a new Claude session in the project cwd', () => {
    const spawn = vi.fn(() => fakePty());
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    expect(spawn).toHaveBeenCalledWith('claude', [], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('continues the latest Claude session with -c', () => {
    const spawn = vi.fn(() => fakePty());
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'continue' });

    expect(spawn).toHaveBeenCalledWith('claude', ['-c'], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('resumes a specific Claude session with -r', () => {
    const spawn = vi.fn(() => fakePty());
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'resume', claudeSessionId: 'abc' });

    expect(spawn).toHaveBeenCalledWith('claude', ['-r', 'abc'], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('writes input with a newline', () => {
    const pty = fakePty();
    const runner = new PtyRunner({ claudeBin: 'claude', spawn: vi.fn(() => pty) });
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    runner.sendInput('web-1', '/help');

    expect(pty.write).toHaveBeenCalledWith('/help\r');
  });

  it('stops reporting a session as running after exit without public onExit registration', () => {
    const pty = fakePty();
    const runner = new PtyRunner({ claudeBin: 'claude', spawn: vi.fn(() => pty) });
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    pty.fireExit({ exitCode: 0 });

    expect(runner.isRunning('web-1')).toBe(false);
  });

  it('allows the same sessionId to start again after exit', () => {
    const firstPty = fakePty();
    const secondPty = fakePty();
    const spawn = vi.fn()
      .mockReturnValueOnce(firstPty)
      .mockReturnValueOnce(secondPty);
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });
    firstPty.fireExit({ exitCode: 0 });

    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(runner.isRunning('web-1')).toBe(true);
  });

  it('keeps a restarted session running when the old PTY exits after stop', () => {
    const oldPty = fakePty();
    const newPty = fakePty();
    const spawn = vi.fn()
      .mockReturnValueOnce(oldPty)
      .mockReturnValueOnce(newPty);
    const runner = new PtyRunner({ claudeBin: 'claude', spawn });
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });

    runner.stop('web-1');
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });
    oldPty.fireExit({ exitCode: 0 });

    expect(runner.isRunning('web-1')).toBe(true);
    runner.sendInput('web-1', '/help');
    expect(newPty.write).toHaveBeenCalledWith('/help\r');
  });

  it('calls a public onExit callback registered before exit', () => {
    const pty = fakePty();
    const runner = new PtyRunner({ claudeBin: 'claude', spawn: vi.fn(() => pty) });
    const onExit = vi.fn();
    runner.start({ sessionId: 'web-1', cwd: '/tmp/project', mode: 'new' });
    runner.onExit('web-1', onExit);

    pty.fireExit({ exitCode: 1, signal: 15 });

    expect(onExit).toHaveBeenCalledWith({ exitCode: 1, signal: 15 });
  });
});

type ExitEvent = { exitCode: number; signal?: number };

function fakePty() {
  const exitCallbacks: Array<(event: ExitEvent) => void> = [];

  return {
    write: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((callback: (event: ExitEvent) => void) => {
      exitCallbacks.push(callback);
    }),
    fireExit(event: ExitEvent) {
      for (const callback of exitCallbacks) callback(event);
    },
  };
}
