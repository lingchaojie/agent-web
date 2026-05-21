import { describe, expect, it } from 'vitest';
import { parseTmuxPaneList, exposedTmuxPanes, tmuxExternalKey, tmuxListPanesArgs } from '../../src/server/services/tmuxPaneDiscovery';

const formatLine = ['%12', 'main', 'claude', 'webagent', '/tmp/demo', '1', '/tmp/tmux-1000/default'].join('\t');

describe('tmux pane discovery', () => {
  it('parses tab-separated tmux pane metadata', () => {
    expect(parseTmuxPaneList(formatLine)).toEqual([
      {
        paneId: '%12',
        sessionName: 'main',
        windowName: 'claude',
        paneTitle: 'webagent',
        cwd: '/tmp/demo',
        exposedFlag: '1',
        socketPath: '/tmp/tmux-1000/default',
      },
    ]);
  });

  it('keeps explicitly exposed panes and webagent-marked panes', () => {
    const panes = parseTmuxPaneList([
      formatLine,
      ['%13', 'main', 'shell', 'bash', '/tmp/demo', '0', '/tmp/tmux-1000/default'].join('\t'),
      ['%14', 'main', 'webagent-claude', 'bash', '/tmp/demo', '', '/tmp/tmux-1000/default'].join('\t'),
    ].join('\n'));

    expect(exposedTmuxPanes(panes).map((pane) => pane.paneId)).toEqual(['%12', '%14']);
  });

  it('excludes app-owned webagent tmux sessions from external discovery', () => {
    const panes = parseTmuxPaneList([
      ['%20', 'webagent-session-1', 'claude', 'claude', '/tmp/demo', '1', '/tmp/tmux-1000/default'].join('\t'),
      ['%21', 'main', 'webagent-claude', 'bash', '/tmp/demo', '', '/tmp/tmux-1000/default'].join('\t'),
    ].join('\n'));

    expect(exposedTmuxPanes(panes).map((pane) => pane.paneId)).toEqual(['%21']);
  });

  it('builds a stable external key', () => {
    const [pane] = parseTmuxPaneList(formatLine);

    expect(tmuxExternalKey(pane)).toBe('tmux:/tmp/tmux-1000/default:main:claude:%12');
  });

  it('uses the tmux format expression that reads WEBAGENT_EXPOSE from pane environment', () => {
    expect(tmuxListPanesArgs().at(-1)).toContain('#{pane_env:WEBAGENT_EXPOSE}');
  });
});
