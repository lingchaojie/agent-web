import type { ConversationBlock } from '../../shared/types';
import { stripTerminalControlSequences, toolOutputLabel } from '../../shared/terminalText';

type MessageStreamProps = {
  blocks: ConversationBlock[];
};

export default function MessageStream({ blocks }: MessageStreamProps) {
  const visibleBlocks = cleanBlocks(blocks);

  return (
    <div className="message-stream" aria-live="polite">
      {visibleBlocks.map((block) => (
        <MessageBlock block={block} key={block.id} />
      ))}
      {visibleBlocks.length === 0 ? (
        <div className="empty-chat">
          <p className="eyebrow">已连接</p>
          <h3>等待输出</h3>
          <p className="muted">在下方输入消息，或等待 Claude Code 输出下一行。</p>
        </div>
      ) : null}
    </div>
  );
}

function cleanBlocks(blocks: ConversationBlock[]): ConversationBlock[] {
  return blocks
    .map((block) => ({ ...block, text: stripTerminalControlSequences(block.text) }))
    .filter((block) => block.text.length > 0);
}

function MessageBlock({ block }: { block: ConversationBlock }) {
  if (block.kind === 'tool' || block.kind === 'system') {
    return (
      <details className={`message-bubble ${block.kind} tool-message`} data-block-kind={block.kind} data-block-status={block.status}>
        <summary>
          <span>{collapsedBlockLabel(block.kind, block.text)}</span>
          <time dateTime={block.createdAt}>{formatTime(block.createdAt)}</time>
        </summary>
        <pre>{block.text}</pre>
      </details>
    );
  }

  return (
    <article className={`message-bubble ${block.kind}`} data-block-kind={block.kind} data-block-status={block.status}>
      <header>
        <span>{block.kind}</span>
        <time dateTime={block.createdAt}>{formatTime(block.createdAt)}</time>
      </header>
      <pre>{block.text}</pre>
    </article>
  );
}

function collapsedBlockLabel(kind: ConversationBlock['kind'], text: string): string {
  const name = text.split(/\r?\n/)[0]?.trim();
  if (kind === 'tool') return name ? `工具调用 · ${name}` : toolOutputLabel(text);
  if (kind === 'system') return name ? `系统信息 · ${name}` : '系统信息';
  return name || kind;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}
