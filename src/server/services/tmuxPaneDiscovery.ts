export type TmuxPane = {
  paneId: string;
  sessionName: string;
  windowName: string;
  paneTitle: string;
  cwd: string;
  exposedFlag: string;
  socketPath: string;
};

export function parseTmuxPaneList(output: string): TmuxPane[] {
  return output
    .trimEnd()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [paneId = '', sessionName = '', windowName = '', paneTitle = '', cwd = '', exposedFlag = '', socketPath = ''] = line.split('\t');
      return { paneId, sessionName, windowName, paneTitle, cwd, exposedFlag, socketPath };
    })
    .filter((pane) => pane.paneId && pane.cwd);
}

export function exposedTmuxPanes(panes: TmuxPane[]): TmuxPane[] {
  return panes.filter((pane) => {
    if (pane.exposedFlag === '1') return true;
    return [pane.sessionName, pane.windowName, pane.paneTitle]
      .join(' ')
      .toLowerCase()
      .includes('webagent');
  });
}

export function tmuxExternalKey(pane: TmuxPane): string {
  return `tmux:${pane.socketPath}:${pane.sessionName}:${pane.windowName}:${pane.paneId}`;
}

export function tmuxListPanesArgs(): string[] {
  return [
    'list-panes',
    '-a',
    '-F',
    '#{pane_id}\t#{session_name}\t#{window_name}\t#{pane_title}\t#{pane_current_path}\t#{pane_env:WEBAGENT_EXPOSE}\t#{socket_path}',
  ];
}
