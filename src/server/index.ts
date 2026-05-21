import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { createDatabase } from './db';
import { loadConfig } from './config';
import { createApp } from './app';
import { ProjectRegistry } from './services/projectRegistry';
import { SessionRegistry } from './services/sessionRegistry';
import { TmuxClaudeRunner } from './services/tmuxClaudeRunner';
import { RealtimeHub } from './services/realtimeHub';
import { StatuslineService } from './services/statuslineService';
import { ClaudeResumeIndex } from './services/claudeResumeIndex';
import { ClaudeTranscriptNormalizer } from './services/claudeTranscriptNormalizer';
import { historyProjectId, isAvailableProjectPath } from './services/projectDiscovery';
import { TmuxPaneAdapter } from './services/tmuxPaneAdapter';
import { exposedTmuxPanes, parseTmuxPaneList, tmuxListPanesArgs, type TmuxPane } from './services/tmuxPaneDiscovery';
import { TmuxSessionSync } from './services/tmuxSessionSync';
import { TerminalAttachService } from './services/terminalAttachService';

const execFileAsync = promisify(execFile);

const config = loadConfig();
const db = createDatabase(config.databasePath);
const projects = new ProjectRegistry(db);
const sessions = new SessionRegistry(db);
sessions.stopRunningSessions();
const runner = new TmuxClaudeRunner({ claudeBin: config.claudeBin });
const statuslines = new StatuslineService();
const hub = new RealtimeHub(sessions, runner, { projects, statuslines });
const resumeIndex = new ClaudeResumeIndex(config.claudeConfigDir);
const transcripts = new ClaudeTranscriptNormalizer(config.claudeConfigDir);
const tmuxAdapter = new TmuxPaneAdapter();
const tmuxSync = new TmuxSessionSync({
  sessions,
  hub,
  listPanes: listExposedTmuxPanes,
  capture: (pane) => tmuxAdapter.capture(pane),
  sendInput: (pane, text) => tmuxAdapter.sendInput(pane, text),
  resolveProjectId: (cwd) => {
    const project = projects.listProjects().find((item) => item.path === cwd && item.available);
    if (project) return project.id;
    return isAvailableProjectPath(cwd) ? historyProjectId(cwd) : null;
  },
  titleForPane,
});
const terminals = new TerminalAttachService({
  targetForSession: (sessionId) => {
    const session = sessions.getSession(sessionId);
    if (session?.source === 'external-tmux' && session.externalKey) {
      const [, socketPath, sessionName] = session.externalKey.split(':');
      return {
        args: ['-S', socketPath, 'attach-session', '-t', sessionName],
        cwd: session.externalCwd ?? undefined,
      };
    }
    return runner.tmuxTarget(sessionId);
  },
});
tmuxSync.start();

const app = await createApp({ config, projects, sessions, runner, hub, resumeIndex, transcripts, terminals, tmuxSync });
await app.listen({ host: config.host, port: config.port });

async function listExposedTmuxPanes(): Promise<TmuxPane[]> {
  try {
    const { stdout } = await execFileAsync('tmux', tmuxListPanesArgs(), { maxBuffer: 1024 * 1024 });
    return exposedTmuxPanes(parseTmuxPaneList(stdout));
  } catch {
    return [];
  }
}

function titleForPane(pane: TmuxPane): string {
  const useful = [pane.windowName, pane.paneTitle]
    .map((value) => value.trim())
    .find((value) => value && !['bash', 'zsh'].includes(value.toLowerCase()));
  return (useful ?? basename(pane.cwd)) || 'Claude tmux';
}
