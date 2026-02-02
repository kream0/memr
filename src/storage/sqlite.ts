import { Database } from 'bun:sqlite';
import { join } from 'path';
import { ensureDataDir } from '../utils/config.js';

let db: Database | null = null;

export function getDatabase(projectDir?: string): Database {
  if (db) return db;

  const dataDir = ensureDataDir(projectDir);
  const dbPath = join(dataDir, 'memory.db');

  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  initializeSchema(db);

  return db;
}

function initializeSchema(database: Database): void {
  database.exec(`
    -- Raw events (append-only)
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT NOT NULL,
      context TEXT,
      searchable_text TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed);

    -- Beliefs (mutable)
    CREATE TABLE IF NOT EXISTS beliefs (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      domain TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_ids TEXT NOT NULL,
      supporting_count INTEGER DEFAULT 0,
      contradicting_count INTEGER DEFAULT 0,
      derived_at INTEGER NOT NULL,
      last_evaluated INTEGER NOT NULL,
      supersedes_id TEXT,
      invalidated_at INTEGER,
      invalidation_reason TEXT,
      importance INTEGER DEFAULT 5,
      tags TEXT,
      embedding TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (supersedes_id) REFERENCES beliefs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_beliefs_domain ON beliefs(domain);
    CREATE INDEX IF NOT EXISTS idx_beliefs_active ON beliefs(invalidated_at) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_beliefs_confidence ON beliefs(confidence DESC);

    -- Predictions (for feedback loop)
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      generated_at INTEGER NOT NULL,
      context_hash TEXT NOT NULL,
      predictions TEXT NOT NULL,
      outcome TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      summary TEXT,
      event_count INTEGER DEFAULT 0
    );
  `);

  // Create FTS5 virtual tables (handle if they already exist)
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        searchable_text,
        content='events',
        content_rowid='rowid'
      );
    `);
  } catch {
    // FTS table already exists
  }

  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(
        text,
        tags,
        content='beliefs',
        content_rowid='rowid'
      );
    `);
  } catch {
    // FTS table already exists
  }

  // Create triggers for FTS sync (only if they don't exist)
  const triggers = [
    `CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, searchable_text) VALUES (NEW.rowid, NEW.searchable_text);
    END`,
    `CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, searchable_text) VALUES('delete', OLD.rowid, OLD.searchable_text);
    END`,
    `CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, searchable_text) VALUES('delete', OLD.rowid, OLD.searchable_text);
      INSERT INTO events_fts(rowid, searchable_text) VALUES (NEW.rowid, NEW.searchable_text);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_ai AFTER INSERT ON beliefs BEGIN
      INSERT INTO beliefs_fts(rowid, text, tags) VALUES (NEW.rowid, NEW.text, NEW.tags);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_ad AFTER DELETE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags) VALUES('delete', OLD.rowid, OLD.text, OLD.tags);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_au AFTER UPDATE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags) VALUES('delete', OLD.rowid, OLD.text, OLD.tags);
      INSERT INTO beliefs_fts(rowid, text, tags) VALUES (NEW.rowid, NEW.text, NEW.tags);
    END`,
  ];

  for (const trigger of triggers) {
    try {
      database.exec(trigger);
    } catch {
      // Trigger already exists
    }
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabase(): void {
  closeDatabase();
}
