import { existsSync, realpathSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Project } from '../../shared/types';
import type { Db } from '../db';

type ProjectRow = {
  id: string;
  name: string;
  path: string;
  favorite: number;
  created_at: string;
  updated_at: string;
};

export class ProjectRegistry {
  constructor(private readonly db: Db) {}

  addProject(input: { name: string; path: string; favorite: boolean }): Project {
    const path = normalizeProjectPath(input.path);
    const now = new Date().toISOString();
    const row: ProjectRow = {
      id: randomUUID(),
      name: input.name.trim(),
      path,
      favorite: input.favorite ? 1 : 0,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO projects (id, name, path, favorite, created_at, updated_at)
      VALUES (@id, @name, @path, @favorite, @created_at, @updated_at)
    `).run(row);

    return toProject(row);
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY favorite DESC, name ASC').all() as ProjectRow[];
    return rows.map(toProject);
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }
}

function normalizeProjectPath(path: string): string {
  if (!existsSync(path)) {
    throw new Error('Project path does not exist');
  }
  const real = realpathSync(path);
  if (!statSync(real).isDirectory()) {
    throw new Error('Project path must be a directory');
  }
  return real;
}

function isCanonicalAvailableDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && realpathSync(path) === path;
  } catch {
    return false;
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    favorite: row.favorite === 1,
    available: isCanonicalAvailableDirectory(row.path),
    source: 'whitelist',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
