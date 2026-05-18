import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/server/db';
import { ProjectRegistry } from '../../src/server/services/projectRegistry';

let root: string;
let cleanupPaths: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webagent-projects-'));
  cleanupPaths = [root];
});

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('ProjectRegistry', () => {
  it('adds and lists whitelisted projects', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);

    const project = registry.addProject({ name: 'Demo', path: root, favorite: true });
    const projects = registry.listProjects();

    expect(project.name).toBe('Demo');
    expect(project.path).toBe(root);
    expect(project.favorite).toBe(true);
    expect(project.available).toBe(true);
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(project.id);
  });

  it('rejects paths that do not exist', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);

    expect(() => registry.addProject({ name: 'Missing', path: join(root, 'missing'), favorite: false })).toThrow('Project path does not exist');
  });

  it('resolves availability when listing projects', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);
    const project = registry.addProject({ name: 'Demo', path: root, favorite: false });

    rmSync(root, { recursive: true, force: true });

    const listed = registry.getProject(project.id);
    expect(listed?.available).toBe(false);
  });

  it('marks projects unavailable when the canonical directory is replaced by a symlink', () => {
    const db = createDatabase(':memory:');
    const registry = new ProjectRegistry(db);
    const project = registry.addProject({ name: 'Demo', path: root, favorite: false });
    const target = mkdtempSync(join(tmpdir(), 'webagent-project-target-'));
    cleanupPaths.push(target);

    rmSync(root, { recursive: true, force: true });
    symlinkSync(target, root, 'dir');

    expect(registry.getProject(project.id)?.available).toBe(false);
  });
});
