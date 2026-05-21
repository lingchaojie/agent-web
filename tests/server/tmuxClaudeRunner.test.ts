import { describe, expect, it, vi, afterEach } from 'vitest';
import { TmuxClaudeRunner } from '../../src/server/services/tmuxClaudeRunner';

const now = new Date('2026-01-01T00:00:00.000Z');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('node:child_process');
});

describe('TmuxClaudeRunner', () => {
  it('starts a web session by running Claude inside a dedicated tmux session', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', shellBin: '/bin/bash', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });

    expect(execFileSync).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      'new-session',
      '-d',
      '-s',
      'webagent-session-1',
      '-c',
      '/tmp/project',
      '--',
      '/bin/bash',
      '-lc',
      "'claude'",
    ]), { stdio: 'pipe' });
    expect(runner.isRunning('session-1')).toBe(true);
    expect(runner.tmuxTarget('session-1')).toBe('webagent-session-1');
    expect(runner.modeForSession('session-1')).toBe('pty-fallback');
  });

  it('defaults tmuxBin to tmux when only claudeBin and execFileSync are provided', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-default-tmux', cwd: '/tmp/project', mode: 'new' });

    expect(execFileSync).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      'new-session',
      '-d',
      '-s',
      'webagent-session-default-tmux',
      '-c',
      '/tmp/project',
      '--',
      process.env.SHELL ?? '/bin/sh',
      '-lc',
      "'claude'",
    ]), { stdio: 'pipe' });
  });

  it('uses node child_process execFileSync when no execFileSync is injected', async () => {
    const execFileSync = vi.fn(() => Buffer.from(''));
    vi.doMock('node:child_process', () => ({ execFileSync }));
    const { TmuxClaudeRunner: MockedTmuxClaudeRunner } = await import('../../src/server/services/tmuxClaudeRunner');
    const runner = new MockedTmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', now: () => now });

    runner.start({ sessionId: 'session-default-exec', cwd: '/tmp/project', mode: 'new' });

    expect(execFileSync).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      'new-session',
      '-d',
      '-s',
      'webagent-session-default-exec',
      '-c',
      '/tmp/project',
      '--',
      process.env.SHELL ?? '/bin/sh',
      '-lc',
      "'claude'",
    ]), { stdio: 'pipe' });
  });

  it('passes continue and resume arguments to Claude inside tmux', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-continue', cwd: '/tmp/project', mode: 'continue' });
    runner.start({ sessionId: 'session-resume', cwd: '/tmp/project', mode: 'resume', claudeSessionId: 'native-1' });

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'tmux', expect.arrayContaining(["'claude' '-c'"]), { stdio: 'pipe' });
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'tmux', expect.arrayContaining(["'claude' '-r' 'native-1'"]), { stdio: 'pipe' });
  });

  it('passes shell environment into the tmux session for statusline commands', () => {
    const execFileSync = vi.fn();
    vi.stubEnv('PATH', '/home/alvin/.local/bin:/usr/bin');
    vi.stubEnv('NVM_DIR', '/home/alvin/.nvm');
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', shellBin: '/bin/bash', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-env', cwd: '/tmp/project', mode: 'new' });

    expect(execFileSync).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      '-e',
      'PATH=/home/alvin/.local/bin:/usr/bin',
      '-e',
      'NVM_DIR=/home/alvin/.nvm',
    ]), { stdio: 'pipe' });
  });

  it('shell-quotes Claude path and resume ids before launching through the shell', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: "/opt/Claude Code/claude'bin", tmuxBin: 'tmux', shellBin: '/bin/bash', execFileSync, now: () => now });

    runner.start({ sessionId: 'session-quoted', cwd: '/tmp/project', mode: 'resume', claudeSessionId: "native ' one" });

    expect(execFileSync).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      "'/opt/Claude Code/claude'\"'\"'bin' '-r' 'native '\"'\"' one'",
    ]), { stdio: 'pipe' });
  });

  it('sanitizes tmux session names from app session ids', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });

    runner.start({ sessionId: 'session/with spaces', cwd: '/tmp/project', mode: 'new' });

    expect(runner.tmuxTarget('session/with spaces')).toBe('webagent-session-with-spaces');
  });

  it('rejects duplicate running session ids', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });

    expect(() => runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' })).toThrow('Session already running');
  });

  it('sends composer input to tmux and presses Enter', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });
    execFileSync.mockClear();

    runner.sendInput('session-1', '/help');

    expect(execFileSync).toHaveBeenCalledWith('tmux', ['send-keys', '-t', 'webagent-session-1', '-l', '--', '/help'], { stdio: 'pipe' });
    expect(execFileSync).toHaveBeenCalledWith('tmux', ['send-keys', '-t', 'webagent-session-1', 'Enter'], { stdio: 'pipe' });
  });

  it('sends leading-dash input lines as literal text', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });
    execFileSync.mockClear();

    runner.sendInput('session-1', '- item');

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'tmux', ['send-keys', '-t', 'webagent-session-1', '-l', '--', '- item'], { stdio: 'pipe' });
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'tmux', ['send-keys', '-t', 'webagent-session-1', 'Enter'], { stdio: 'pipe' });
  });

  it('kills tmux session on stop and notifies exit callbacks', () => {
    const execFileSync = vi.fn();
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync, now: () => now });
    const onExit = vi.fn();
    runner.start({ sessionId: 'session-1', cwd: '/tmp/project', mode: 'new' });
    runner.onExit('session-1', onExit);
    execFileSync.mockClear();

    runner.stop('session-1');

    expect(execFileSync).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'webagent-session-1'], { stdio: 'pipe' });
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 });
    expect(runner.isRunning('session-1')).toBe(false);
    expect(runner.tmuxTarget('session-1')).toBe(null);
  });

  it('throws when sending input to a stopped session', () => {
    const runner = new TmuxClaudeRunner({ claudeBin: 'claude', tmuxBin: 'tmux', execFileSync: vi.fn(), now: () => now });

    expect(() => runner.sendInput('missing', 'hello')).toThrow('Session is not running');
  });
});
