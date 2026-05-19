import type { SessionRegistry } from './sessionRegistry';
import { diffPaneCapture } from './tmuxPaneAdapter';
import { tmuxExternalKey, type TmuxPane } from './tmuxPaneDiscovery';

type Hub = {
  handleTmuxCapture(sessionId: string, text: string): void;
  disconnectExternalSession?(sessionId: string): unknown;
};

type TmuxSessionSyncOptions = {
  sessions: SessionRegistry;
  hub: Hub;
  listPanes(): Promise<TmuxPane[]>;
  capture(pane: TmuxPane): Promise<string>;
  sendInput?(pane: TmuxPane, text: string): Promise<void>;
  resolveProjectId(cwd: string): string | null;
  titleForPane(pane: TmuxPane): string;
  intervalMs?: number;
};

export class TmuxSessionSync {
  private readonly captures = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly options: TmuxSessionSyncOptions) {}

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.intervalMs ?? 1500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async sendInput(sessionId: string, text: string): Promise<void> {
    const session = this.options.sessions.getSession(sessionId);
    if (!session?.externalKey) throw new Error('External tmux session not found');

    const panes = await this.options.listPanes();
    const pane = panes.find((candidate) => tmuxExternalKey(candidate) === session.externalKey);
    if (!pane || this.options.resolveProjectId(pane.cwd) !== session.projectId) {
      this.disconnectExternalSession(sessionId);
      throw new Error('External tmux pane is not available');
    }

    if (this.options.sendInput) await this.options.sendInput(pane, text);
  }

  private async doRefresh(): Promise<void> {
    const panes = await this.options.listPanes();
    const seen = new Set<string>();

    for (const pane of panes) {
      const projectId = this.options.resolveProjectId(pane.cwd);
      if (!projectId) continue;

      const externalKey = tmuxExternalKey(pane);
      seen.add(externalKey);
      const session = this.options.sessions.upsertExternalSession({
        projectId,
        externalKey,
        title: this.options.titleForPane(pane),
        cwd: pane.cwd,
        paneId: pane.paneId,
      });

      try {
        const next = await this.options.capture(pane);
        const previous = this.captures.get(externalKey) ?? '';
        const delta = diffPaneCapture(previous, next);
        this.captures.set(externalKey, next);
        if (delta) this.options.hub.handleTmuxCapture(session.id, delta);
      } catch {
        seen.delete(externalKey);
      }
    }

    for (const session of this.options.sessions.listExternalSessions()) {
      if (!session.externalKey || seen.has(session.externalKey) || session.status !== 'running') continue;
      this.disconnectExternalSession(session.id);
    }
  }

  private disconnectExternalSession(sessionId: string): void {
    if (this.options.hub.disconnectExternalSession) {
      this.options.hub.disconnectExternalSession(sessionId);
      return;
    }
    this.options.sessions.markExternalDisconnected(sessionId);
  }
}
