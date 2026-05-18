import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HistorySession } from '../../shared/types';

type ParsedLine = {
  type?: string;
  summary?: string;
  timestamp?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
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

    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;

      if (parsed.timestamp) updatedAt = parsed.timestamp;
      if (parsed.cwd) cwd = parsed.cwd;
      if (parsed.type === 'summary' && parsed.summary) title = parsed.summary;

      const text = extractMessageText(parsed.message?.content);
      if (text) lastMessage = text;
    }

    return {
      projectKey,
      projectPath: cwd ?? projectKeyToPath(projectKey),
      sessionId,
      transcriptPath,
      title,
      lastMessage,
      updatedAt,
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

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
