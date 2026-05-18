import type { ClaudeSession, HistorySession, Project } from '../../shared/types';

type SessionListProps = {
  project: Project | null;
  sessions: ClaudeSession[];
  history: HistorySession[];
  loading: boolean;
  selectedSessionId: string | null;
  onNew(): void;
  onContinue(): void;
  onResume(historySession: HistorySession): void;
  onOpen(session: ClaudeSession): void;
};

export default function SessionList({
  project,
  sessions,
  history,
  loading,
  selectedSessionId,
  onNew,
  onContinue,
  onResume,
  onOpen,
}: SessionListProps) {
  if (!project) {
    return (
      <section className="panel session-panel idle-panel">
        <p className="eyebrow">Sessions</p>
        <h2>Choose a workspace</h2>
        <p className="muted">Select an available project to create, continue, or resume Claude Code work.</p>
      </section>
    );
  }

  return (
    <section className="panel session-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Sessions</p>
          <h2>{project.name}</h2>
        </div>
        <span className={`status-chip ${project.available ? 'available' : 'offline'}`}>
          {project.available ? 'ready' : 'offline'}
        </span>
      </div>

      <div className="action-row">
        <button className="primary-button" type="button" onClick={onNew} disabled={!project.available || loading}>
          New
        </button>
        <button className="secondary-button" type="button" onClick={onContinue} disabled={!project.available || loading}>
          Continue
        </button>
      </div>

      {loading ? <p className="muted">Loading sessions...</p> : null}

      <div className="subsection">
        <h3>Live sessions</h3>
        <div className="stack-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`list-card ${session.id === selectedSessionId ? 'selected' : ''}`}
              type="button"
              onClick={() => onOpen(session)}
            >
              <span className="list-card-main">
                <span className="row-title">{session.title}</span>
                <span className="row-subtitle">{formatDate(session.lastActiveAt)} · {session.source}</span>
              </span>
              <span className={`status-chip ${session.status}`}>{session.status}</span>
            </button>
          ))}
          {sessions.length === 0 ? <p className="empty-state">No live sessions for this project.</p> : null}
        </div>
      </div>

      <div className="subsection">
        <h3>Claude history</h3>
        <div className="stack-list">
          {history.map((item) => (
            <article className="history-card" key={`${item.projectKey}:${item.sessionId}`}>
              <div>
                <h4>{item.title}</h4>
                <p>{item.lastMessage || 'No preview available.'}</p>
                <span>{formatDate(item.updatedAt)}</span>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => onResume(item)} disabled={loading}>
                Resume
              </button>
            </article>
          ))}
          {history.length === 0 ? <p className="empty-state">No resumable history for this project.</p> : null}
        </div>
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
