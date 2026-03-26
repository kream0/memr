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

function isV1Schema(database: Database): boolean {
  try {
    const row = database.query(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('beliefs') WHERE name = 'evidence_ids'"
    ).get() as { cnt: number } | null;
    return row !== null && row.cnt > 0;
  } catch {
    return false;
  }
}

function isV2Schema(database: Database): boolean {
  try {
    const row = database.query(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('beliefs') WHERE name = 'belief_type'"
    ).get() as { cnt: number } | null;
    return row !== null && row.cnt > 0;
  } catch {
    return false;
  }
}

function migrateV1toV2(database: Database): void {
  database.exec('BEGIN TRANSACTION');
  try {
    // Create v2 table
    database.exec(`
      CREATE TABLE beliefs_v2 (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL CHECK(length(text) <= 500),
        domain TEXT NOT NULL CHECK(domain IN (
          'handoff','watch','project','stakeholder','rule','pattern','infra','skill'
        )),
        belief_type TEXT NOT NULL DEFAULT 'fact' CHECK(belief_type IN (
          'directive','fact','handoff','watch','decision','pending'
        )),
        confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
        importance INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
        tags TEXT,

        project TEXT,
        stakeholder TEXT,
        verify_by INTEGER,
        expires_at INTEGER,
        action TEXT,
        source_session INTEGER,

        derived_at INTEGER NOT NULL,
        last_evaluated INTEGER NOT NULL,
        supersedes_id TEXT REFERENCES beliefs(id),
        invalidated_at INTEGER,
        invalidation_reason TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    // Migrate rows with domain reclassification
    const oldRows = database.query(
      'SELECT id, text, domain, confidence, derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, importance, tags, created_at FROM beliefs'
    ).all() as Array<{
      id: string;
      text: string;
      domain: string;
      confidence: number;
      derived_at: number;
      last_evaluated: number;
      supersedes_id: string | null;
      invalidated_at: number | null;
      invalidation_reason: string | null;
      importance: number | null;
      tags: string | null;
      created_at: number | null;
    }>;

    const insert = database.prepare(`
      INSERT INTO beliefs_v2 (
        id, text, domain, belief_type, confidence, importance, tags,
        derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of oldRows) {
      const { newDomain, newType } = reclassify(row.domain, row.text);
      const clampedImportance = Math.max(1, Math.min(5, row.importance ?? 3));
      const truncatedText = row.text.length > 500 ? row.text.slice(0, 497) + '...' : row.text;

      insert.run(
        row.id,
        truncatedText,
        newDomain,
        newType,
        row.confidence,
        clampedImportance,
        row.tags,
        row.derived_at,
        row.last_evaluated,
        row.supersedes_id,
        row.invalidated_at,
        row.invalidation_reason,
        row.created_at
      );
    }

    // Drop old triggers
    database.exec('DROP TRIGGER IF EXISTS beliefs_ai');
    database.exec('DROP TRIGGER IF EXISTS beliefs_ad');
    database.exec('DROP TRIGGER IF EXISTS beliefs_au');
    database.exec('DROP TRIGGER IF EXISTS events_ai');
    database.exec('DROP TRIGGER IF EXISTS events_ad');
    database.exec('DROP TRIGGER IF EXISTS events_au');

    // Drop old FTS tables
    database.exec('DROP TABLE IF EXISTS beliefs_fts');
    database.exec('DROP TABLE IF EXISTS events_fts');

    // Drop old tables that are no longer needed
    database.exec('DROP TABLE IF EXISTS predictions');
    database.exec('DROP TABLE IF EXISTS sessions');
    database.exec('DROP TABLE IF EXISTS events');

    // Rename tables
    database.exec('ALTER TABLE beliefs RENAME TO beliefs_legacy');
    database.exec('ALTER TABLE beliefs_v2 RENAME TO beliefs');

    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
}

function reclassify(oldDomain: string, text: string): { newDomain: string; newType: string } {
  const upper = text.toUpperCase();

  switch (oldDomain) {
    case 'constraint': {
      const isDirective = /\b(NEVER|MUST|ALWAYS)\b/.test(upper);
      return { newDomain: 'rule', newType: isDirective ? 'directive' : 'fact' };
    }
    case 'workflow': {
      if (/HANDOFF/i.test(text)) {
        return { newDomain: 'handoff', newType: 'handoff' };
      }
      return { newDomain: 'pattern', newType: 'fact' };
    }
    case 'decision':
      return { newDomain: 'pattern', newType: 'decision' };
    case 'project_structure':
      return { newDomain: 'infra', newType: 'fact' };
    case 'code_pattern':
      return { newDomain: 'pattern', newType: 'fact' };
    case 'user_preference':
      return { newDomain: 'rule', newType: 'fact' };
    default: {
      // Domains that already match v2 pass through; others default to pattern/fact
      const validDomains = ['handoff', 'watch', 'project', 'stakeholder', 'rule', 'pattern', 'infra', 'skill'];
      if (validDomains.includes(oldDomain)) {
        return { newDomain: oldDomain, newType: inferType(text) };
      }
      return { newDomain: 'pattern', newType: 'fact' };
    }
  }
}

function inferType(text: string): string {
  const upper = text.toUpperCase();
  if (/\b(NEVER|MUST|ALWAYS|SHALL NOT|REQUIRED)\b/.test(upper)) return 'directive';
  if (/\bHANDOFF\b/i.test(text)) return 'handoff';
  if (/\bWATCH\b/i.test(text)) return 'watch';
  if (/\bPENDING\b/i.test(text)) return 'pending';
  return 'fact';
}

function createV2Schema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS beliefs (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK(length(text) <= 500),
      domain TEXT NOT NULL CHECK(domain IN (
        'handoff','watch','project','stakeholder','rule','pattern','infra','skill'
      )),
      belief_type TEXT NOT NULL DEFAULT 'fact' CHECK(belief_type IN (
        'directive','fact','handoff','watch','decision','pending'
      )),
      confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
      importance INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
      tags TEXT,

      project TEXT,
      stakeholder TEXT,
      verify_by INTEGER,
      expires_at INTEGER,
      action TEXT,
      source_session INTEGER,

      derived_at INTEGER NOT NULL,
      last_evaluated INTEGER NOT NULL,
      supersedes_id TEXT REFERENCES beliefs(id),
      invalidated_at INTEGER,
      invalidation_reason TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);
}

function createIndexes(database: Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_active ON beliefs(invalidated_at) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_domain ON beliefs(domain) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_type ON beliefs(belief_type) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_importance ON beliefs(importance DESC) WHERE invalidated_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_project ON beliefs(project) WHERE invalidated_at IS NULL AND project IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_expires ON beliefs(expires_at) WHERE invalidated_at IS NULL AND expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_context ON beliefs(invalidated_at, belief_type, importance DESC) WHERE invalidated_at IS NULL;
  `);
}

function createFTS(database: Database): void {
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(
        text, tags, project, stakeholder,
        content='beliefs',
        content_rowid='rowid',
        tokenize="unicode61 tokenchars '-_.'"
      )
    `);
  } catch {
    // FTS table already exists
  }
}

function createTriggers(database: Database): void {
  const triggers = [
    `CREATE TRIGGER IF NOT EXISTS beliefs_ai AFTER INSERT ON beliefs BEGIN
      INSERT INTO beliefs_fts(rowid, text, tags, project, stakeholder)
      VALUES (NEW.rowid, NEW.text, NEW.tags, NEW.project, NEW.stakeholder);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_ad AFTER DELETE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags, project, stakeholder)
      VALUES('delete', OLD.rowid, OLD.text, OLD.tags, OLD.project, OLD.stakeholder);
    END`,
    `CREATE TRIGGER IF NOT EXISTS beliefs_au AFTER UPDATE ON beliefs BEGIN
      INSERT INTO beliefs_fts(beliefs_fts, rowid, text, tags, project, stakeholder)
      VALUES('delete', OLD.rowid, OLD.text, OLD.tags, OLD.project, OLD.stakeholder);
      INSERT INTO beliefs_fts(rowid, text, tags, project, stakeholder)
      VALUES (NEW.rowid, NEW.text, NEW.tags, NEW.project, NEW.stakeholder);
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

function rebuildFTS(database: Database): void {
  try {
    database.exec("INSERT INTO beliefs_fts(beliefs_fts) VALUES('rebuild')");
  } catch {
    // FTS rebuild failed -- non-fatal, data still accessible
  }
}

function initializeSchema(database: Database): void {
  if (isV1Schema(database)) {
    // Migrate from v1 to v2
    migrateV1toV2(database);
    createIndexes(database);
    createFTS(database);
    createTriggers(database);
    rebuildFTS(database);
  } else if (isV2Schema(database)) {
    // Already v2 -- ensure indexes, FTS, and triggers are present
    createIndexes(database);
    createFTS(database);
    createTriggers(database);
  } else {
    // Fresh database -- create everything
    createV2Schema(database);
    createIndexes(database);
    createFTS(database);
    createTriggers(database);
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
