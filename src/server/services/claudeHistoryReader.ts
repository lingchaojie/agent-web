import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationBlock, HistorySession } from '../../shared/types';
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

function parseLine(line: string): ParsedLine | null {
  try {
    return JSON.parse(line) as ParsedLine;
  } catch {
    return null;
  }
}

