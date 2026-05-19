import { useEffect, useState } from 'react';
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
  onOpenHistory(historySession: HistorySession): void;
  onStop(session: ClaudeSession): void;
  onBackToProjects(): void;
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
  onOpenHistory,
  onStop,
  onBackToProjects,
}: SessionListProps) {
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(20);
  const visibleHistory = history.slice(0, visibleHistoryCount);
  const remainingHistoryCount = Math.max(history.length - visibleHistoryCount, 0);

  useEffect(() => {
    setVisibleHistoryCount(20);
  }, [project?.id]);
  if (!project) {
    return (
      <section className="panel session-panel idle-panel">
        <p className="eyebrow">会话</p>
        <h2>选择工作区</h2>
        <p className="muted">选择可用项目后，可以新建、继续或恢复 Claude Code 会话。</p>
      </section>
    );
  }

  return (
    <section className="panel session-panel">
      <div className="mobile-panel-nav">
        <button className="secondary-button compact" type="button" onClick={onBackToProjects}>
          ← 项目
        </button>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">会话</p>
          <h2>{project.name}</h2>
        </div>
        <span className={`status-chip ${project.available ? 'available' : 'offline'}`}>
          {project.available ? '可用' : 'offline'}
        </span>
      </div>

      <div className="action-row">
        <button className="primary-button" type="button" onClick={onNew} disabled={!project.available || loading}>
          新建会话
        </button>
        <button className="secondary-button" type="button" onClick={onContinue} disabled={!project.available || loading}>
          继续会话
        </button>
      </div>

      {loading ? <p className="muted">正在加载会话...</p> : null}

      <div className="subsection">
        <h3>实时会话</h3>
        <div className="stack-list">
          {sessions.map((session) => (
            <div key={session.id} className={`list-card session-card ${session.id === selectedSessionId ? 'selected' : ''}`}>
              <button className="session-open-button" type="button" onClick={() => onOpen(session)}>
                <span className="list-card-main">
                  <span className="row-title">{session.title}</span>
                  <span className="row-subtitle">{formatDate(session.lastActiveAt)} · {session.source}</span>
                </span>
                <span className={`status-chip ${session.status}`}>{session.status}</span>
              </button>
              <button className="secondary-button compact danger-button" type="button" onClick={() => onStop(session)} aria-label={`关闭 ${session.title}`} disabled={loading}>
                关闭
              </button>
            </div>
          ))}
          {sessions.length === 0 ? <p className="empty-state">当前没有实时会话。</p> : null}
        </div>
      </div>

      <div className="subsection">
        <h3>Claude 历史</h3>
        <div className="stack-list">
          {visibleHistory.map((item) => (
            <article className="history-card" key={`${item.projectKey}:${item.sessionId}`}>
              <div>
                <h4>{item.title}</h4>
                <p>{item.lastMessage || '暂无预览。'}</p>
                <span>{formatDate(item.updatedAt)}</span>
              </div>
              <div className="history-actions">
                <button className="secondary-button compact" type="button" onClick={() => onOpenHistory(item)} disabled={loading}>
                  打开
                </button>
                <button className="secondary-button compact" type="button" onClick={() => item.appSession ? onOpen(item.appSession) : onResume(item)} disabled={loading}>
                  {item.appSession ? '打开实时会话' : '恢复'}
                </button>
              </div>
            </article>
          ))}
          {history.length === 0 ? <p className="empty-state">当前没有可恢复的历史会话。</p> : null}
          {remainingHistoryCount > 0 ? (
            <button
              className="secondary-button load-more-button"
              type="button"
              onClick={() => setVisibleHistoryCount((current) => current + 20)}
            >
              加载 {Math.min(remainingHistoryCount, 20)} 条更多
            </button>
          ) : null}
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
