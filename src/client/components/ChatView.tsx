import { useEffect, useRef, useState } from 'react';
import type { ClaudeSession, ConversationBlock, HistorySession, ParsedInteraction, SessionActivity, SessionStatus, SessionStreamEvent, SessionViewState, SlashCommandEntry, TranscriptWindow, WsServerMessage } from '../../shared/types';
import { applySessionStreamEvent, emptySessionStreamState } from '../../shared/sessionStream';
import { openSessionSocket, sendWs } from '../api';
import MessageStream from './MessageStream';
import PromptActions from './PromptActions';
import SessionRenderSurface from './SessionRenderSurface';
import TranscriptView from './TranscriptView';
import ChatComposer from './ChatComposer';
import SessionStatusline from './SessionStatusline';

type DisplaySession = Pick<ClaudeSession, 'id' | 'title' | 'status'> & Partial<ClaudeSession>;

type ChatViewProps = {
  session: DisplaySession | null;
  transcript?: TranscriptWindow | null;
  transcriptLoadingOlder?: boolean;
  commandEntries?: SlashCommandEntry[];
  resumeCandidates?: HistorySession[];
  onLoadOlderTranscript?(): void;
  onOpenHistorySession?(session: HistorySession): void;
  onStatusChange(sessionId: string, status: SessionStatus): void;
  onBackToSessions(): void;
  onStop(session: ClaudeSession): void;
};

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export default function ChatView({ session, transcript, transcriptLoadingOlder = false, commandEntries = [], resumeCandidates = [], onLoadOlderTranscript = () => undefined, onOpenHistorySession, onStatusChange, onBackToSessions, onStop }: ChatViewProps) {
  const [streamState, setStreamState] = useState(emptySessionStreamState);
  const [interaction, setInteraction] = useState<ParsedInteraction | null>(null);
  const [input, setInput] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [activity, setActivity] = useState<SessionActivity>('stopped');
  const [lifecycle, setLifecycle] = useState<SessionViewState['lifecycle'] | null>(null);
  const [visibleError, setVisibleError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const latestSequenceRef = useRef(0);

  useEffect(() => {
    setStreamState(emptySessionStreamState());
    setInteraction(null);
    setActivity(session?.status === 'running' ? 'idle' : 'stopped');
    setLifecycle(session?.status ?? null);
    setVisibleError('');
    latestSequenceRef.current = 0;

    if (!session) {
      setConnectionState('idle');
      return;
    }

    if (session.status !== 'running') {
      setConnectionState('disconnected');
      return;
    }

    let active = true;
    let reconnecting = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setConnectionState(reconnecting ? 'reconnecting' : 'connecting');
      const socket = openSessionSocket();
      socketRef.current = socket;
      const isActiveSocket = () => active && socketRef.current === socket;

      socket.addEventListener('open', () => {
        if (!isActiveSocket()) return;
        setConnectionState('connected');
        const afterSequence = latestSequenceRef.current;
        sendWs(socket, afterSequence > 0 ? { type: 'subscribe', sessionId: session.id, afterSequence } : { type: 'subscribe', sessionId: session.id });
      });

      socket.addEventListener('message', (event) => {
        if (!isActiveSocket()) return;
        const message = parseServerMessage(event.data);
        if (!message) return;
        if ('sessionId' in message && message.sessionId && message.sessionId !== session.id) return;

        if (message.type === 'error') {
          setVisibleError(message.message);
          return;
        }

        if (isSessionStreamEvent(message)) {
          latestSequenceRef.current = Math.max(latestSequenceRef.current, streamEventSequence(message));
          setStreamState((current) => applySessionStreamEvent(current, message));
          applyStreamSideEffects(message, setActivity, setLifecycle, setInteraction, onStatusChange);
          setVisibleError('');
        }
      });

      socket.addEventListener('error', () => {
        if (!isActiveSocket()) return;
        setVisibleError('实时连接异常。');
      });

      socket.addEventListener('close', () => {
        if (!isActiveSocket()) return;
        setConnectionState('disconnected');
        setVisibleError('实时会话已断开。');
        reconnecting = true;
        connect();
      });
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session?.id]);

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!session || !input.trim() || !socketRef.current) return;

    try {
      sendWs(socketRef.current, { type: 'input', sessionId: session.id, text: input });
      setInput('');
      setInteraction(null);
      setActivity('working');
    } catch (error) {
      setVisibleError(error instanceof Error ? error.message : '发送消息失败。');
    }
  }

  function handleAction(actionId: string) {
    if (!session || !socketRef.current) return;

    try {
      sendWs(socketRef.current, { type: 'action', sessionId: session.id, actionId, input: '' });
      setInteraction(null);
      setActivity('working');
    } catch (error) {
      setVisibleError(error instanceof Error ? error.message : '发送操作失败。');
    }
  }

  if (!session) {
    return (
      <section className="panel chat-panel idle-panel">
        <p className="eyebrow">实时控制</p>
        <h2>未打开会话</h2>
        <p className="muted">新建或打开会话后，可以在这里连接 Claude Code。</p>
      </section>
    );
  }

  return (
    <section className="panel chat-panel" data-native-shell="chat" data-reduced-motion={prefersReducedMotion()}>
      <div className="mobile-panel-nav">
        <button className="secondary-button compact" type="button" onClick={onBackToSessions}>
          ← 会话
        </button>
      </div>

      <header className="chat-header">
        <div>
          <p className="eyebrow">{session.status === 'running' ? '实时控制会话' : '历史会话'}</p>
          <h2>{transcript?.title ?? streamState.session?.title ?? session.title}</h2>
        </div>
        <div className="chat-status-actions">
          <span className={`activity-chip ${lifecycle === 'failed' ? 'failed' : activity}`} data-status-transition={prefersReducedMotion() ? 'reduced' : 'animated'}>{activityLabel(activity, lifecycle)}</span>
          <span className={`source-chip ${streamState.session?.transcriptSource === 'pty-fallback' ? 'degraded' : 'structured'}`}>{sourceLabel(streamState.session?.transcriptSource)}</span>
          <span className={`connection-chip ${connectionState}`}>{connectionState}</span>
          {isClaudeSession(session) ? (
            <button className="secondary-button compact danger-button" type="button" onClick={() => onStop(session)} disabled={session.status !== 'running'}>
              停止
            </button>
          ) : null}
        </div>
      </header>

      {visibleError ? <div className="error-banner">{visibleError}</div> : null}

      {transcript ? (
        <TranscriptView transcript={transcript} loadingOlder={transcriptLoadingOlder} onLoadOlder={onLoadOlderTranscript} />
      ) : streamState.render ? (
        <SessionRenderSurface render={streamState.render} disabled={connectionState !== 'connected'} onAction={handleAction} />
      ) : (
        <>
          <MessageStream blocks={streamState.blocks} />
          {activity === 'working' ? <div className="live-activity" role="status">Claude 正在处理…</div> : null}
          <PromptActions interaction={interaction} disabled={connectionState !== 'connected'} onAction={handleAction} />
        </>
      )}

      <SessionStatusline statusline={streamState.statusline} />

      <ChatComposer
        value={input}
        disabled={connectionState !== 'connected'}
        commandEntries={commandEntries}
        resumeCandidates={resumeCandidates}
        onChange={setInput}
        onSubmit={() => handleSubmit({ preventDefault: () => undefined })}
        onOpenHistorySession={onOpenHistorySession}
      />
    </section>
  );
}

function isClaudeSession(session: DisplaySession): session is ClaudeSession {
  return typeof session.projectId === 'string' && typeof session.source === 'string' && typeof session.createdAt === 'string' && typeof session.lastActiveAt === 'string';
}

function activityLabel(activity: SessionActivity, lifecycle: SessionViewState['lifecycle'] | null): string {
  if (lifecycle === 'failed') return '失败';
  if (lifecycle === 'degraded-fallback') return '降级模式';
  if (activity === 'working') return '工作中';
  if (activity === 'idle') return '等待输入';
  return '已停止';
}

function sourceLabel(source: SessionViewState['transcriptSource'] | undefined): string {
  return source === 'pty-fallback' ? 'PTY fallback' : 'structured';
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function parseServerMessage(raw: unknown): WsServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as WsServerMessage;
  } catch {
    return null;
  }
}

function isSessionStreamEvent(message: WsServerMessage): message is SessionStreamEvent {
  return message.type === 'snapshot' || message.type === 'block-added' || message.type === 'block-updated' || message.type === 'block-finalized' || message.type === 'activity-changed' || message.type === 'session-changed' || message.type === 'render-changed' || message.type === 'statusline-changed';
}

function streamEventSequence(event: SessionStreamEvent): number {
  return 'sequence' in event && typeof event.sequence === 'number' ? event.sequence : 0;
}

function applyStreamSideEffects(
  event: SessionStreamEvent,
  setActivity: (activity: SessionActivity) => void,
  setLifecycle: (lifecycle: SessionViewState['lifecycle']) => void,
  setInteraction: (interaction: ParsedInteraction | null) => void,
  onStatusChange: (sessionId: string, status: SessionStatus) => void,
): void {
  if (event.type === 'snapshot') {
    setActivity(event.session.activity);
    setLifecycle(event.session.lifecycle);
    setInteraction(latestInteraction(event.blocks));
    const status = statusFromLifecycle(event.session.lifecycle);
    if (status) onStatusChange(event.sessionId, status);
    return;
  }

  if (event.type === 'activity-changed') {
    setActivity(event.activity);
    return;
  }

  if (event.type === 'block-added' && event.block.kind === 'interaction') {
    setInteraction(event.block.interaction ?? null);
    return;
  }

  if (event.type === 'block-updated' && event.patch.interaction) {
    setInteraction(event.patch.interaction.kind === 'none' ? null : event.patch.interaction);
    return;
  }

  if (event.type === 'session-changed') {
    if (event.patch.activity) setActivity(event.patch.activity);
    if (event.patch.lifecycle) setLifecycle(event.patch.lifecycle);
    const status = event.patch.lifecycle ? statusFromLifecycle(event.patch.lifecycle) : null;
    if (status) onStatusChange(event.sessionId, status);
  }
}

function latestInteraction(blocks: ConversationBlock[]): ParsedInteraction | null {
  const block = [...blocks].reverse().find((candidate) => candidate.kind === 'interaction' && candidate.interaction && candidate.interaction.kind !== 'none');
  return block?.interaction ?? null;
}

function statusFromLifecycle(lifecycle: SessionViewState['lifecycle']): SessionStatus | null {
  if (lifecycle === 'running' || lifecycle === 'stopped' || lifecycle === 'failed') return lifecycle;
  return null;
}
