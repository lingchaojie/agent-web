import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationBlock, HistorySession, RenderRegion, TranscriptWindow } from '../../shared/types';
import { mapClaudeJsonlEntryToSemantic, type ClaudeJsonlEntry } from './claudeSemanticMapper';

type ParsedLine = ClaudeJsonlEntry & {
  summary?: string;
  cwd?: string;
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

export function readClaudeTranscriptWindow(projectsRoot: string, input: { sessionId: string; limit?: number; before?: string }): TranscriptWindow | null {
  const located = findTranscript(projectsRoot, input.sessionId);
  if (!located) return null;
  const session = readTranscript(located.projectKey, located.transcriptPath);
  if (!session) return null;

  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const before = parseCursor(input.before, session.blocks.length + 1);
  const end = Math.min(before, session.blocks.length);
  const start = Math.max(0, end - limit);
  const blocks = session.blocks.slice(start, end);

  return {
    sessionId: session.sessionId,
    projectKey: session.projectKey,
    projectPath: session.projectPath,
    title: session.title,
    updatedAt: session.updatedAt,
    regions: blocks.map(blockToRegion),
    olderCursor: start > 0 ? String(start) : null,
    hasMoreOlder: start > 0,
  };
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

      const parts = mapClaudeJsonlEntryToSemantic(parsed);
      for (const part of parts) {
        lastMessage = part.text;
        const timestamp = part.createdAt ?? parsed.timestamp ?? updatedAt;
        blocks.push({
          id: `history-${sessionId}-${blocks.length + 1}`,
          sessionId,
          kind: part.kind,
          text: part.text,
          sequence: blocks.length + 1,
          status: part.status,
          source: 'history',
          interaction: part.interaction,
          createdAt: timestamp,
          updatedAt: timestamp,
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

function findTranscript(projectsRoot: string, sessionId: string): { projectKey: string; transcriptPath: string } | null {
  if (!existsSync(projectsRoot)) return null;
  try {
    if (!statSync(projectsRoot).isDirectory()) return null;
    for (const projectEntry of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue;
      const projectKey = projectEntry.name;
      const projectDir = join(projectsRoot, projectKey);
      if (lstatSync(projectDir).isSymbolicLink()) continue;
      const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
      if (!existsSync(transcriptPath) || lstatSync(transcriptPath).isSymbolicLink()) continue;
      const stat = statSync(transcriptPath);
      if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES) return null;
      return { projectKey, transcriptPath };
    }
  } catch {
    return null;
  }
  return null;
}

function parseCursor(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function blockToRegion(block: ConversationBlock): RenderRegion {
  return {
    id: block.id,
    kind: block.kind,
    text: block.text,
    status: block.status,
    source: 'history',
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    interaction: block.interaction,
  };
}

function parseLine(line: string): ParsedLine | null {
  try {
    return JSON.parse(line) as ParsedLine;
  } catch {
    return null;
  }
}

