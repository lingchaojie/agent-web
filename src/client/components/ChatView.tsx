import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClaudeSession, ParsedInteraction, SessionStatus, WsServerMessage } from '../../shared/types';
import { openSessionSocket, sendWs } from '../api';
import MessageStream from './MessageStream';
import PromptActions from './PromptActions';

type ChatViewProps = {
  session: ClaudeSession | null;
  onStatusChange(sessionId: string, status: SessionStatus): void;
};

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

export default function ChatView({ session, onStatusChange }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interaction, setInteraction] = useState<ParsedInteraction | null>(null);
  const [input, setInput] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [visibleError, setVisibleError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setMessages([]);
    setInteraction(null);
    setVisibleError('');

    if (!session) {
      setConnectionState('idle');
      return;
    }

    setConnectionState('connecting');
    let active = true;
    const socket = openSessionSocket();
    socketRef.current = socket;
    const isActiveSocket = () => active && socketRef.current === socket;

    socket.addEventListener('open', () => {
      if (!isActiveSocket()) return;
      setConnectionState('connected');
      sendWs(socket, { type: 'attach', sessionId: session.id });
    });

    socket.addEventListener('message', (event) => {
      if (!isActiveSocket()) return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      if ('sessionId' in message && message.sessionId && message.sessionId !== session.id) return;

      if (message.type === 'attached') {
        setMessages(message.replay);
        onStatusChange(message.sessionId, message.status);
        setVisibleError('');
      } else if (message.type === 'output') {
        setMessages((current) => [...current, message.message]);
        setInteraction(message.interaction.kind === 'none' ? null : message.interaction);
      } else if (message.type === 'status') {
        onStatusChange(message.sessionId, message.status);
      } else if (message.type === 'error') {
        setVisibleError(message.message);
        setMessages((current) => [...current, systemMessage(session.id, message.message)]);
      }
    });

    socket.addEventListener('error', () => {
      if (!isActiveSocket()) return;
      setVisibleError('WebSocket connection error.');
    });

    socket.addEventListener('close', () => {
      if (!isActiveSocket()) return;
      setConnectionState('disconnected');
      setVisibleError('Disconnected from realtime session.');
    });

    return () => {
      active = false;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
    };
  }, [session?.id]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !input.trim() || !socketRef.current) return;

    try {
      sendWs(socketRef.current, { type: 'input', sessionId: session.id, text: input });
      setInput('');
      setInteraction(null);
    } catch (error) {
      setVisibleError(error instanceof Error ? error.message : 'Failed to send input.');
    }
  }

  function handleAction(actionId: string) {
    if (!session || !socketRef.current) return;

    try {
      sendWs(socketRef.current, { type: 'action', sessionId: session.id, actionId, input: '' });
      setInteraction(null);
    } catch (error) {
      setVisibleError(error instanceof Error ? error.message : 'Failed to send action.');
    }
  }

  if (!session) {
    return (
      <section className="panel chat-panel idle-panel">
        <p className="eyebrow">Realtime</p>
        <h2>No session open</h2>
        <p className="muted">Start or open a session to attach the mobile console.</p>
      </section>
    );
  }

  return (
    <section className="panel chat-panel">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Realtime session</p>
          <h2>{session.title}</h2>
        </div>
        <span className={`connection-chip ${connectionState}`}>{connectionState}</span>
      </header>

      {visibleError ? <div className="error-banner">{visibleError}</div> : null}

      <MessageStream messages={messages} />
      <PromptActions interaction={interaction} disabled={connectionState !== 'connected'} onAction={handleAction} />

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Message Claude Code..."
          rows={3}
          disabled={connectionState !== 'connected'}
        />
        <button className="primary-button" type="submit" disabled={connectionState !== 'connected' || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function parseServerMessage(raw: unknown): WsServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as WsServerMessage;
  } catch {
    return null;
  }
}

function systemMessage(sessionId: string, text: string): ChatMessage {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    role: 'system',
    text,
    createdAt: new Date().toISOString(),
  };
}
