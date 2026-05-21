import type { ClaudeSession, TranscriptWindow } from '../../shared/types';
import TerminalView from './TerminalView';
import TranscriptView from './TranscriptView';

type DisplaySession = Pick<ClaudeSession, 'id' | 'title' | 'status'> & Partial<ClaudeSession> & { historySessionId?: string };

type ChatViewProps = {
  session: DisplaySession | null;
  transcript?: TranscriptWindow | null;
  transcriptLoadingOlder?: boolean;
  mobilePaneVisible?: boolean;
  onLoadOlderTranscript?(): void;
  onBackToSessions(): void;
  onStop(session: ClaudeSession): void;
  persistentTerminals?: ClaudeSession[];
};

export default function ChatView({ session, transcript, transcriptLoadingOlder = false, mobilePaneVisible = true, onLoadOlderTranscript = () => undefined, onBackToSessions, onStop, persistentTerminals = [] }: ChatViewProps) {
  const runningTerminals = persistentTerminals.filter((terminalSession) => terminalSession.status === 'running');

  if (!session) {
    return (
      <>
        {runningTerminals.length > 0 ? <TerminalStack sessions={runningTerminals} activeSessionId={null} mobilePaneVisible={mobilePaneVisible} onBack={onBackToSessions} /> : null}
        <section className="panel chat-panel idle-panel">
          <div className="mobile-panel-nav">
            <button className="secondary-button compact" type="button" onClick={onBackToSessions}>
              ← 会话
            </button>
          </div>
          <p className="eyebrow">Claude Code 终端</p>
          <h2>未打开会话</h2>
          <p className="muted">新建、打开或恢复会话后，会在这里显示 tmux 终端。</p>
        </section>
      </>
    );
  }

  const title = transcript?.title ?? session.title;
  const claudeSession = isClaudeSession(session) ? session : null;

  if (claudeSession?.status === 'running') {
    return <TerminalStack sessions={mergePersistentTerminals(persistentTerminals, claudeSession)} activeSessionId={claudeSession.id} activeTitle={title} mobilePaneVisible={mobilePaneVisible} onBack={onBackToSessions} />;
  }

  return (
    <>
      {runningTerminals.length > 0 ? <TerminalStack sessions={runningTerminals} activeSessionId={null} mobilePaneVisible={mobilePaneVisible} onBack={onBackToSessions} /> : null}

      <section className="panel chat-panel" data-native-shell="chat">
        <div className="mobile-panel-nav">
          <button className="secondary-button compact" type="button" onClick={onBackToSessions}>
            ← 会话
          </button>
        </div>

        <header className="chat-header">
          <div>
            <p className="eyebrow">{claudeSession ? 'Claude Code 终端' : '历史记录'}</p>
            <h2>{title}</h2>
          </div>
          {claudeSession ? (
            <div className="chat-status-actions">
              <span className={`activity-chip ${claudeSession.status === 'failed' ? 'failed' : 'stopped'}`}>{statusLabel(claudeSession.status)}</span>
              <button className="secondary-button compact danger-button" type="button" onClick={() => onStop(claudeSession)} disabled>
                {claudeSession.source === 'external-tmux' ? '断开' : '停止'}
              </button>
            </div>
          ) : null}
        </header>

        {transcript ? (
          <TranscriptView transcript={transcript} loadingOlder={transcriptLoadingOlder} onLoadOlder={onLoadOlderTranscript} />
        ) : (
          <div className="empty-state terminal-empty-state">
            <h3>{claudeSession ? '会话未运行' : '历史记录加载中'}</h3>
            <p>{claudeSession ? '这个会话已经停止。请从会话列表新建或恢复一个终端会话。' : '正在加载历史 transcript。'}</p>
          </div>
        )}
      </section>
    </>
  );
}

type TerminalStackProps = {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  activeTitle?: string;
  mobilePaneVisible: boolean;
  onBack(): void;
};

function TerminalStack({ sessions, activeSessionId, activeTitle, mobilePaneVisible, onBack }: TerminalStackProps) {
  return (
    <div className="terminal-stack">
      {sessions.map((terminalSession) => {
        const active = terminalSession.id === activeSessionId;
        return (
          <div className="terminal-stack-item" data-active={active ? 'true' : 'false'} key={terminalSession.id}>
            <TerminalView sessionId={terminalSession.id} title={active ? activeTitle ?? terminalSession.title : terminalSession.title} visible={mobilePaneVisible && active} onBack={onBack} />
          </div>
        );
      })}
    </div>
  );
}

function mergePersistentTerminals(sessions: ClaudeSession[], activeSession: ClaudeSession): ClaudeSession[] {
  return [activeSession, ...sessions.filter((session) => session.id !== activeSession.id && session.status === 'running')];
}

function isClaudeSession(session: DisplaySession): session is ClaudeSession {
  return typeof session.projectId === 'string' && typeof session.source === 'string' && typeof session.createdAt === 'string' && typeof session.lastActiveAt === 'string';
}

function statusLabel(status: ClaudeSession['status']): string {
  if (status === 'failed') return '失败';
  if (status === 'running') return '运行中';
  return '已停止';
}
