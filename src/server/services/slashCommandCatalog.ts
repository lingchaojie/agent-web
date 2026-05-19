import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Project, SlashCommandCatalog, SlashCommandEntry } from '../../shared/types';

const MAX_DESCRIPTION_BYTES = 4096;

export function buildSlashCommandCatalog(input: { project: Project; claudeConfigDir: string }): SlashCommandCatalog {
  const commands = new Map<string, SlashCommandEntry>();
  addCommand(commands, {
    name: '/resume',
    title: 'Resume session',
    description: 'Resume a Claude Code history session for this project',
    scope: 'app',
    behavior: 'app-owned',
    support: 'supported',
    aliases: [],
  });

  for (const command of discoverCommands(join(input.claudeConfigDir, 'commands'), 'user')) addCommand(commands, command);
  for (const command of discoverSkills(join(input.claudeConfigDir, 'skills'), 'user')) addCommand(commands, command);
  for (const command of discoverCommands(join(input.project.path, '.claude', 'commands'), 'project')) addCommand(commands, command);
  for (const command of discoverSkills(join(input.project.path, '.claude', 'skills'), 'project')) addCommand(commands, command);

  return { projectId: input.project.id, commands: [...commands.values()] };
}

function discoverCommands(directory: string, scope: SlashCommandEntry['scope']): SlashCommandEntry[] {
  return safeListMarkdownFiles(directory).map((path) => {
    const name = slashCommandName(basename(path, '.md'));
    return {
      name,
      title: name,
      description: firstMeaningfulLine(path) || `${name} command`,
      scope,
      behavior: 'prompt-insert' as const,
      support: 'supported' as const,
      aliases: [],
    };
  });
}

function discoverSkills(directory: string, scope: SlashCommandEntry['scope']): SlashCommandEntry[] {
  return safeListDirectories(directory).flatMap((path) => {
    const skillPath = join(path, 'SKILL.md');
    if (!safeFileExists(skillPath)) return [];
    const metadata = readFrontmatterMetadata(skillPath);
    const name = slashCommandName(metadata.name || basename(path));
    return [{
      name,
      title: name,
      description: metadata.description || `${name} skill`,
      scope,
      behavior: 'prompt-insert' as const,
      support: 'supported' as const,
      aliases: [],
    }];
  });
}

function addCommand(commands: Map<string, SlashCommandEntry>, command: SlashCommandEntry): void {
  commands.set(command.name, command);
}

function slashCommandName(value: string): `/${string}` {
  return value.startsWith('/') ? value as `/${string}` : `/${value}`;
}

function safeListMarkdownFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

function safeListDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

function firstMeaningfulLine(path: string): string {
  const text = readBoundedText(path);
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== '---') ?? '';
}

function readFrontmatterMetadata(path: string): { name?: string; description?: string } {
  const text = readBoundedText(path);
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};

  const metadata: { name?: string; description?: string } = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const match = /^(name|description):\s*(.+)$/.exec(line.trim());
    if (match) metadata[match[1] as 'name' | 'description'] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return metadata;
}

function readBoundedText(path: string): string {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_DESCRIPTION_BYTES) return '';
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function safeFileExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}
