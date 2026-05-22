import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverClaudeConfigProjects } from '../../src/server/services/claudeConfigProjects';
import { historyProjectId } from '../../src/server/services/projectDiscovery';

let root: string;
let claudeDir: string;
let configProject: string;
let homeConfigProject: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-claude-config-projects-'));
  claudeDir = join(root, '.claude');
  configProject = join(root, 'webagent');
  homeConfigProject = join(root, 'LangGraphCNC');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(configProject, { recursive: true });
  mkdirSync(homeConfigProject, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverClaudeConfigProjects', () => {
  it('discovers existing project paths from both Claude config locations', () => {
    writeFileSync(join(claudeDir, '.claude.json'), JSON.stringify({
      projects: {
        [configProject]: { allowedTools: [] },
        [join(root, 'missing')]: { allowedTools: [] },
      },
    }));
    writeFileSync(join(dirname(claudeDir), '.claude.json'), JSON.stringify({
      projects: {
        [homeConfigProject]: { allowedTools: [] },
      },
    }));

    const projects = discoverClaudeConfigProjects(claudeDir);

    expect(projects).toEqual([
      expect.objectContaining({
        id: historyProjectId(homeConfigProject),
        name: 'LangGraphCNC',
        path: homeConfigProject,
        source: 'claude-config',
        favorite: false,
        available: true,
      }),
      expect.objectContaining({
        id: historyProjectId(configProject),
        name: 'webagent',
        path: configProject,
        source: 'claude-config',
        favorite: false,
        available: true,
      }),
    ]);
  });

  it('keeps config projects even when the project contains a local .claude directory', () => {
    mkdirSync(join(configProject, '.claude'));
    writeFileSync(join(claudeDir, '.claude.json'), JSON.stringify({ projects: { [configProject]: {} } }));

    const projects = discoverClaudeConfigProjects(claudeDir);

    expect(projects).toEqual([
      expect.objectContaining({ path: configProject, source: 'claude-config', available: true }),
    ]);
  });

  it('returns an empty list when config files are missing or malformed', () => {
    writeFileSync(join(claudeDir, '.claude.json'), '{bad json');

    expect(discoverClaudeConfigProjects(claudeDir)).toEqual([]);
  });
});
