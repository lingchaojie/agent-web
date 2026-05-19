import { describe, expect, it } from 'vitest';
import type { SlashCommandEntry } from '../../src/shared/types';
import {
  detectSlashCommandQuery,
  firstEnabledMatchIndex,
  matchSlashCommands,
  nextActiveMatchIndex,
} from '../../src/client/slashCommands';

const commands: SlashCommandEntry[] = [
  { name: '/resume', title: 'Resume session', description: 'Resume a Claude Code history session', scope: 'app', behavior: 'app-owned', support: 'supported', aliases: ['r'] },
  { name: '/deploy', title: 'Deploy', description: 'Ship the selected service', scope: 'project', behavior: 'prompt-insert', support: 'supported', aliases: [] },
  { name: '/doctor', title: 'Doctor', description: 'Check installation health', scope: 'user', behavior: 'unsupported', support: 'unsupported', aliases: [] },
];

describe('slash command matching', () => {
  it('detects leading slash command queries only at the start of composer text', () => {
    expect(detectSlashCommandQuery('/res')).toEqual({ query: 'res', token: '/res' });
    expect(detectSlashCommandQuery('/resume old session')).toEqual({ query: 'resume', token: '/resume' });
    expect(detectSlashCommandQuery('please inspect /tmp/demo')).toBeNull();
    expect(detectSlashCommandQuery('')).toBeNull();
  });

  it('ranks command matches by name, alias, then description', () => {
    expect(matchSlashCommands(commands, 'res').map((match) => match.entry.name)).toEqual(['/resume']);
    expect(matchSlashCommands(commands, 'r').map((match) => match.entry.name)[0]).toBe('/resume');
    expect(matchSlashCommands(commands, 'ship').map((match) => match.entry.name)).toEqual(['/deploy']);
  });

  it('returns empty matches for unknown queries', () => {
    expect(matchSlashCommands(commands, 'unknown')).toEqual([]);
  });

  it('selects the first supported match and skips unsupported matches while navigating', () => {
    const matches = matchSlashCommands(commands, 'do');

    expect(matches.map((match) => match.entry.name)).toEqual(['/doctor']);
    expect(firstEnabledMatchIndex(matches)).toBe(-1);
    const allMatches = matchSlashCommands(commands, '');
    expect(firstEnabledMatchIndex(allMatches)).toBe(0);
    expect(nextActiveMatchIndex(allMatches, 2, 1)).toBe(0);
  });
});
