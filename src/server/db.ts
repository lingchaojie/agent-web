import Database from 'better-sqlite3';

export type Db = Database.Database;

export function createDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  // Schema changes are additive so existing local databases are opened in place, not reset.
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL,
      claude_session_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recent_output (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_blocks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      interaction_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS stream_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS session_view_state (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      lifecycle TEXT NOT NULL,
      activity TEXT NOT NULL,
      activity_label TEXT,
      pending_interaction_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  addColumnIfMissing(db, 'session_view_state', 'transcript_source', "TEXT NOT NULL DEFAULT 'pty-fallback'");
  return db;
}

function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}
