import type { ReactNode } from 'react';
import type { SessionStatuslineState } from '../../shared/types';

type SessionStatuslineProps = {
  statusline?: SessionStatuslineState;
};

type AnsiStyle = {
  foreground?: string;
};

const ANSI_PATTERN = /\x1b\[([0-9;]*)m/g;
const FOREGROUND_CLASSES: Record<number, string> = {
  30: 'ansi-fg-black',
  31: 'ansi-fg-red',
  32: 'ansi-fg-green',
  33: 'ansi-fg-yellow',
  34: 'ansi-fg-blue',
  35: 'ansi-fg-magenta',
  36: 'ansi-fg-cyan',
  37: 'ansi-fg-white',
  90: 'ansi-fg-bright-black',
  91: 'ansi-fg-bright-red',
  92: 'ansi-fg-bright-green',
  93: 'ansi-fg-bright-yellow',
  94: 'ansi-fg-bright-blue',
  95: 'ansi-fg-bright-magenta',
  96: 'ansi-fg-bright-cyan',
  97: 'ansi-fg-bright-white',
};

export default function SessionStatusline({ statusline }: SessionStatuslineProps) {
  const text = statusline?.status === 'ready' ? sanitizeStatuslineText(statusline.text) : '';
  const error = statusline?.status === 'error' ? statusline.error || 'Statusline unavailable' : '';

  return (
    <section className={`session-statusline ${statusline?.status ?? 'pending'}`} role="status" aria-label="Claude Code statusline">
      {text ? <pre>{renderAnsi(text)}</pre> : <p>{error || 'Statusline unavailable'}</p>}
    </section>
  );
}

export function renderAnsi(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let style: AnsiStyle = {};
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(ANSI_PATTERN)) {
    if (match.index > lastIndex) nodes.push(renderText(text.slice(lastIndex, match.index), style, key++));
    style = applyCodes(style, parseCodes(match[1]));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(renderText(text.slice(lastIndex), style, key++));
  return nodes;
}

function sanitizeStatuslineText(text: string): string {
  return text.replace(/\s*\(shift\+tab to cycle\)/gi, '').trimEnd();
}

function renderText(text: string, style: AnsiStyle, key: number): ReactNode {
  if (!style.foreground) return <span key={key}>{text}</span>;
  return <span key={key} className={style.foreground}>{text}</span>;
}

function parseCodes(raw: string): number[] {
  if (!raw) return [0];
  return raw.split(';').map((part) => Number(part || 0));
}

function applyCodes(style: AnsiStyle, codes: number[]): AnsiStyle {
  let next = { ...style };
  for (const code of codes) {
    if (code === 0) next = {};
    if (FOREGROUND_CLASSES[code]) next.foreground = FOREGROUND_CLASSES[code];
  }
  return next;
}
