import { describe, expect, it, vi } from 'vitest';
import { TmuxPaneAdapter, diffPaneCapture } from '../../src/server/services/tmuxPaneAdapter';
import type { TmuxPane } from '../../src/server/services/tmuxPaneDiscovery';

const pane: TmuxPane = {
  paneId: '%12',
  sessionName: 'main',
  windowName: 'claude',
  paneTitle: 'webagent',
  cwd: '/tmp/demo',
  exposedFlag: '1',
  socketPath: '/tmp/tmux-1000/default',
};

describe('diffPaneCapture', () => {
  it('returns appended or replaced tmux pane text', () => {
    expect(diffPaneCapture('hello', 'hello\nworld')).toBe('world');
    expect(diffPaneCapture('', 'first')).toBe('first');
    expect(diffPaneCapture('old content', 'new screen')).toBe('new screen');
  });
});

describe('TmuxPaneAdapter', () => {
  it('captures pane output using tmux capture-pane', async () => {
    const run = vi.fn(async () => 'screen contents');
    const adapter = new TmuxPaneAdapter({ run });

    await expect(adapter.capture(pane)).resolves.toBe('screen contents');

    expect(run).toHaveBeenCalledWith('tmux', ['-S', '/tmp/tmux-1000/default', 'capture-pane', '-p', '-J', '-t', '%12']);
  });

  it('sends literal input and enter as separate tmux commands', async () => {
    const run = vi.fn(async () => '');
    const adapter = new TmuxPaneAdapter({ run });

    await adapter.sendInput(pane, 'C-c');

    expect(run).toHaveBeenNthCalledWith(1, 'tmux', ['-S', '/tmp/tmux-1000/default', 'send-keys', '-t', '%12', '-l', '--', 'C-c']);
    expect(run).toHaveBeenNthCalledWith(2, 'tmux', ['-S', '/tmp/tmux-1000/default', 'send-keys', '-t', '%12', 'Enter']);
  });
});
