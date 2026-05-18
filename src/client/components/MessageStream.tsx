import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../shared/types';

type MessageStreamProps = {
  messages: ChatMessage[];
};

export default function MessageStream({ messages }: MessageStreamProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div className="message-stream" aria-live="polite">
      {messages.map((message) => (
        <article className={`message-bubble ${message.role}`} key={message.id}>
          <header>
            <span>{message.role}</span>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </header>
          <pre>{message.text}</pre>
        </article>
      ))}
      {messages.length === 0 ? (
        <div className="empty-chat">
          <p className="eyebrow">Attached</p>
          <h3>Awaiting output</h3>
          <p className="muted">Send a prompt below or wait for Claude Code to write the next line.</p>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}
