import type { ReactNode } from 'react';
import type { SessionStatuslineState } from '../../shared/types';

type SessionStatuslineProps = {
  statusline?: SessionStatuslineState;
};

type AnsiStyle = {
  foreground?: string;
  color?: string;
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
  if (style.color) return <span key={key} style={{ color: style.color }}>{text}</span>;
  if (style.foreground) return <span key={key} className={style.foreground}>{text}</span>;
  return <span key={key}>{text}</span>;
}

function parseCodes(raw: string): number[] {
  if (!raw) return [0];
  return raw.split(';').map((part) => Number(part || 0));
}

function applyCodes(style: AnsiStyle, codes: number[]): AnsiStyle {
  let next = { ...style };
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === 0) next = {};
    else if (code === 39) next = { ...next, foreground: undefined, color: undefined };
    else if (code === 38 && codes[index + 1] === 5 && codes[index + 2] !== undefined) {
      next = { ...next, foreground: undefined, color: ansi256Color(codes[index + 2]) };
      index += 2;
    } else if (FOREGROUND_CLASSES[code]) {
      next = { ...next, foreground: FOREGROUND_CLASSES[code], color: undefined };
    }
  }
  return next;
}

function ansi256Color(code: number): string | undefined {
  if (code < 0 || code > 255) return undefined;
  if (code < 16) return BASIC_ANSI_COLORS[code];
  if (code < 232) {
    const value = code - 16;
    const red = Math.floor(value / 36);
    const green = Math.floor((value % 36) / 6);
    const blue = value % 6;
    return `rgb(${ansi256CubeValue(red)}, ${ansi256CubeValue(green)}, ${ansi256CubeValue(blue)})`;
  }
  const gray = 8 + (code - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

function ansi256CubeValue(value: number): number {
  return value === 0 ? 0 : 55 + value * 40;
}

const BASIC_ANSI_COLORS = [
  '#000000',
  '#800000',
  '#008000',
  '#808000',
  '#000080',
  '#800080',
  '#008080',
  '#c0c0c0',
  '#808080',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#0000ff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
];
