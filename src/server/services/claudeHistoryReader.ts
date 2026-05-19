import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationBlock, ConversationBlockKind, HistorySession } from '../../shared/types';

type ParsedLine = {
  type?: string;
  summary?: string;
  timestamp?: string;
  cwd?: string;
  content?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type HistoryBlockPart = {
  kind: ConversationBlockKind;
  text: string;
};

export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

export function readClaudeHistory(projectsRoot: string): HistorySession[] {
  if (!existsSync(projectsRoot)) return [];

  let projectEntries;
  try {
    if (!statSync(projectsRoot).isDirectory()) return [];
    projectEntries = readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: HistorySession[] = [];
  for (const projectEntry of projectEntries) {
    try {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue;
      const projectKey = projectEntry.name;
      const projectDir = join(projectsRoot, projectKey);
      if (lstatSync(projectDir).isSymbolicLink()) continue;

      let transcriptEntries;
      try {
        transcriptEntries = readdirSync(projectDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const transcriptEntry of transcriptEntries) {
        try {
          if (!transcriptEntry.isFile() || transcriptEntry.isSymbolicLink()) continue;
          const fileName = transcriptEntry.name;
          if (!fileName.endsWith('.jsonl')) continue;
          const transcriptPath = join(projectDir, fileName);
          if (lstatSync(transcriptPath).isSymbolicLink()) continue;
          const session = readTranscript(projectKey, transcriptPath);
          if (session) sessions.push(session);
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function projectKeyToPath(projectKey: string): string | null {
  if (!projectKey.startsWith('-')) return null;
  return projectKey.replace(/-/g, '/');
}

function readTranscript(projectKey: string, transcriptPath: string): HistorySession | null {
  try {
    const sessionId = transcriptPath.split('/').at(-1)?.replace(/\.jsonl$/, '');
    if (!sessionId) return null;

    const stat = statSync(transcriptPath);
    if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES) return null;

    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    let title = 'Untitled session';
    let lastMessage = '';
    let updatedAt = stat.mtime.toISOString();
    let cwd: string | null = null;
    const blocks: ConversationBlock[] = [];

    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;

      if (parsed.timestamp) updatedAt = parsed.timestamp;
      if (parsed.cwd) cwd = parsed.cwd;
      if (parsed.type === 'summary' && parsed.summary) title = parsed.summary;

      const parts = extractBlockParts(parsed);
      for (const part of parts) {
        lastMessage = part.text;
        blocks.push({
          id: `history-${sessionId}-${blocks.length + 1}`,
          sessionId,
          kind: part.kind,
          text: part.text,
          sequence: blocks.length + 1,
          status: 'final',
          source: 'history',
          createdAt: parsed.timestamp ?? updatedAt,
          updatedAt: parsed.timestamp ?? updatedAt,
        });
      }
    }

    return {
      projectKey,
      projectPath: cwd ?? projectKeyToPath(projectKey),
      sessionId,
      transcriptPath,
      title,
      lastMessage,
      updatedAt,
      blocks,
    };
  } catch {
    return null;
  }
}

function parseLine(line: string): ParsedLine | null {
  try {
    return JSON.parse(line) as ParsedLine;
  } catch {
    return null;
  }
}

function extractBlockParts(parsed: ParsedLine): HistoryBlockPart[] {
  if (parsed.type === 'system') return textToBlockParts('system', extractText(parsed.content));

  const role = parsed.message?.role;
  const content = parsed.message?.content;
  if (Array.isArray(content)) return content.flatMap((part) => extractContentPart(role, part));

  const kind = messageRoleToBlockKind(role);
  if (!kind) return [];
  return textToBlockParts(kind, extractText(content));
}

function extractContentPart(role: string | undefined, part: unknown): HistoryBlockPart[] {
  if (!part || typeof part !== 'object') return [];
  const type = 'type' in part && typeof part.type === 'string' ? part.type : '';

  if (type === 'tool_use') return textToBlockParts('tool', extractToolUseText(part));
  if (type === 'tool_result') return textToBlockParts('tool', extractText('content' in part ? part.content : undefined));

  const kind = messageRoleToBlockKind(role);
  if (!kind) return [];
  return textToBlockParts(kind, extractText(part));
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(extractText).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

function extractToolUseText(part: object): string {
  const name = 'name' in part && typeof part.name === 'string' ? part.name : 'Tool';
  const input = 'input' in part ? part.input : undefined;
  const command = input && typeof input === 'object' && 'command' in input && typeof input.command === 'string' ? input.command : '';
  return [name, command].filter(Boolean).join('\n');
}

function textToBlockParts(kind: ConversationBlockKind, text: string): HistoryBlockPart[] {
  return text ? [{ kind, text }] : [];
}

function messageRoleToBlockKind(role: string | undefined): ConversationBlockKind | null {
  if (role === 'user' || role === 'assistant') return role;
  if (role === 'system' || role === 'tool') return role;
  return null;
}
