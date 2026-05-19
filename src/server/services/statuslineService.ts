import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ClaudeSession, Project, SessionRenderState, SessionStatuslineState, SessionViewState } from '../../shared/types';

export type StatuslineSettings = {
  command: string | null;
  padding: number;
  refreshIntervalSeconds: number;
};

type RawSettings = {
  statusLine?: {
    type?: string;
    command?: string;
    padding?: number;
    refreshInterval?: number;
  };
};

export type StatuslineInput = {
  session_id: string;
  session_name: string;
  cwd: string;
  workspace: {
    current_dir: string;
    project_dir: string;
    added_dirs: string[];
    git_worktree?: string;
  };
  model: {
    id?: string;
    display_name: string;
  };
  context_window: {
    used_percentage: number;
  };
  cost: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  output_style: {
    name: string;
  };
  vim: {
    mode: string;
  };
  agent: {
    name: string;
  };
  version: string;
  transcript_path?: string;
  webagent: {
    app_session_id: string;
    lifecycle: SessionViewState['lifecycle'];
    activity: SessionViewState['activity'];
    transcript_source: SessionViewState['transcriptSource'];
    render_sequence?: number;
    statusline_refresh_interval: number;
    generated_at: string;
  };
};

type BuildStatuslineInput = {
  session: ClaudeSession;
  project: Project;
  view: SessionViewState;
  render?: SessionRenderState;
  settings: StatuslineSettings;
  now?: Date;
};

export type ExecuteStatuslineCommandInput = {
  command: string;
  stdin: string;
  timeoutMs: number;
  cwd?: string;
};

export type ExecuteStatuslineCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ExecuteStatuslineCommand = (input: ExecuteStatuslineCommandInput) => Promise<ExecuteStatuslineCommandResult>;

type RunStatuslineCommandInput = {
  command: string | null;
  input: unknown;
  sessionId: string;
  sequence: number;
  execute?: ExecuteStatuslineCommand;
  now?: () => Date;
  cwd?: string;
  timeoutMs?: number;
};

type StatuslineServiceOptions = {
  settingsPath?: string;
  execute?: ExecuteStatuslineCommand;
  now?: () => Date;
  timeoutMs?: number;
};

type RenderStatuslineInput = {
  session: ClaudeSession;
  project: Project;
  view: SessionViewState;
  render?: SessionRenderState;
  sequence: number;
};

const DEFAULT_REFRESH_INTERVAL_SECONDS = 10;
const DEFAULT_PADDING = 0;
const DEFAULT_TIMEOUT_MS = 2_000;

export function loadStatuslineSettings(input: { settingsPath?: string } = {}): StatuslineSettings {
  const settingsPath = input.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as RawSettings;
    const statusLine = settings.statusLine;
    const command = statusLine?.type === 'command' && typeof statusLine.command === 'string' && statusLine.command.trim()
      ? statusLine.command.trim()
      : null;
    return {
      command,
      padding: typeof statusLine?.padding === 'number' ? statusLine.padding : DEFAULT_PADDING,
      refreshIntervalSeconds: Math.max(1, typeof statusLine?.refreshInterval === 'number' ? statusLine.refreshInterval : DEFAULT_REFRESH_INTERVAL_SECONDS),
    };
  } catch {
    return { command: null, padding: DEFAULT_PADDING, refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS };
  }
}

export function buildStatuslineInput(input: BuildStatuslineInput): StatuslineInput {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const nativeSessionId = input.session.claudeSessionId ?? input.view.claudeSessionId ?? input.session.id;
  const renderSequence = input.render?.sequence;

  return {
    session_id: nativeSessionId,
    session_name: input.session.title,
    cwd: input.project.path,
    workspace: {
      current_dir: input.project.path,
      project_dir: input.project.path,
      added_dirs: [],
      git_worktree: input.project.path,
    },
    model: {
      display_name: 'Claude',
    },
    context_window: {
      used_percentage: 0,
    },
    cost: {
      total_cost_usd: 0,
      total_duration_ms: 0,
      total_api_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
    },
    output_style: {
      name: 'default',
    },
    vim: {
      mode: 'normal',
    },
    agent: {
      name: 'webagent',
    },
    version: 'webagent',
    webagent: {
      app_session_id: input.session.id,
      lifecycle: input.view.lifecycle,
      activity: input.view.activity,
      transcript_source: input.view.transcriptSource,
      render_sequence: renderSequence,
      statusline_refresh_interval: input.settings.refreshIntervalSeconds,
      generated_at: generatedAt,
    },
  };
}

export async function runStatuslineCommand(input: RunStatuslineCommandInput): Promise<SessionStatuslineState> {
  const updatedAt = (input.now ?? (() => new Date()))().toISOString();
  if (!input.command) {
    return { sessionId: input.sessionId, status: 'error', text: '', error: 'Statusline command is not configured', updatedAt, sequence: input.sequence };
  }

  try {
    const execute = input.execute ?? executeShellCommand;
    const result = await execute({
      command: input.command,
      stdin: JSON.stringify(input.input),
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: input.cwd,
    });
    if (result.code !== 0) {
      return { sessionId: input.sessionId, status: 'error', text: '', error: compactError(result.stderr || result.stdout || `Statusline command exited with code ${result.code}`), updatedAt, sequence: input.sequence };
    }
    return { sessionId: input.sessionId, status: 'ready', text: sanitizeStatuslineOutput(result.stdout), updatedAt, sequence: input.sequence };
  } catch (error) {
    return { sessionId: input.sessionId, status: 'error', text: '', error: error instanceof Error ? error.message : 'Statusline command failed', updatedAt, sequence: input.sequence };
  }
}

export function sanitizeStatuslineOutput(output: string): string {
  return output
    .replace(/\s*\(shift\+tab to cycle\)/gi, '')
    .replace(/[\r\n]+$/g, '')
    .trimEnd();
}

export class StatuslineService {
  constructor(private readonly options: StatuslineServiceOptions = {}) {}

  settings(): StatuslineSettings {
    return loadStatuslineSettings({ settingsPath: this.options.settingsPath });
  }

  async render(input: RenderStatuslineInput): Promise<SessionStatuslineState> {
    const settings = this.settings();
    return runStatuslineCommand({
      command: settings.command,
      input: buildStatuslineInput({ ...input, settings, now: this.options.now?.() }),
      sessionId: input.session.id,
      sequence: input.sequence,
      execute: this.options.execute,
      now: this.options.now,
      cwd: input.project.path,
      timeoutMs: this.options.timeoutMs,
    });
  }
}

function executeShellCommand(input: ExecuteStatuslineCommandInput): Promise<ExecuteStatuslineCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, { cwd: input.cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Statusline command timed out'));
    }, input.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
    child.stdin.end(input.stdin);
  });
}

function compactError(text: string): string {
  return text.trim().split(/\r?\n/)[0] || 'Statusline command failed';
}
