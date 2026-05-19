import type { SlashCommandEntry } from '../shared/types';

export type SlashCommandQuery = {
  token: string;
  query: string;
};

export type SlashCommandMatch = {
  entry: SlashCommandEntry;
  matchedText: string;
  score: number;
};

export function detectSlashCommandQuery(input: string): SlashCommandQuery | null {
  if (!input.startsWith('/')) return null;
  const token = input.split(/\s/, 1)[0] ?? '';
  if (!token.startsWith('/')) return null;
  return { token, query: token.slice(1).toLowerCase() };
}

export function matchSlashCommands(entries: SlashCommandEntry[], query: string): SlashCommandMatch[] {
  const normalized = query.toLowerCase();
  return entries
    .flatMap((entry) => {
      const match = scoreEntry(entry, normalized);
      return match ? [{ entry, ...match }] : [];
    })
    .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));
}

export function firstEnabledMatchIndex(matches: SlashCommandMatch[]): number {
  return matches.findIndex((match) => isEnabled(match.entry));
}

export function nextActiveMatchIndex(matches: SlashCommandMatch[], currentIndex: number, direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  for (let offset = 1; offset <= matches.length; offset += 1) {
    const index = (currentIndex + offset * direction + matches.length) % matches.length;
    if (isEnabled(matches[index].entry)) return index;
  }
  return -1;
}

export function isEnabled(entry: SlashCommandEntry): boolean {
  return entry.support === 'supported' && entry.behavior !== 'unsupported';
}

function scoreEntry(entry: SlashCommandEntry, query: string): Omit<SlashCommandMatch, 'entry'> | null {
  if (!query) return { matchedText: '', score: 0 };

  const commandName = entry.name.slice(1).toLowerCase();
  if (commandName.startsWith(query)) return { matchedText: entry.name.slice(1, 1 + query.length), score: 0 };
  if (entry.aliases.some((alias) => alias.toLowerCase().startsWith(query))) return { matchedText: query, score: 1 };
  const descriptionIndex = entry.description.toLowerCase().indexOf(query);
  if (descriptionIndex >= 0) return { matchedText: entry.description.slice(descriptionIndex, descriptionIndex + query.length), score: 2 };
  return null;
}
