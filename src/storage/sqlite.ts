import { Database } from 'bun:sqlite';
import { join } from 'path';
import { ensureDataDir } from '../utils/config.js';

/**
 * Maximum length of `beliefs.text` for ordinary beliefs.
 *
 * This number is an editorial rule, not an external constraint: nothing in the
 * storage layer needs it (SQLite TEXT is unbounded, and v2 has no embeddings).
 * It exists to keep beliefs atomic, because every active belief competes for
 * the same context token budget at injection time (~len/4 + 15 tokens each,
 * against a default budget of 8000). Beliefs that ramble crowd out beliefs that
 * matter, so ordinary writes stay strict and fail loudly.
 */
export const MAX_BELIEF_TEXT_LENGTH = 500;

/**
 * Maximum length of `beliefs.text` for the `handoff` domain.
 *
 * Handoffs are the one domain where the reasoning above does not apply, so they
 * get their own ceiling:
 *   - only ever ONE is active (createHandoff supersedes all previous handoffs),
 *     so a long one crowds out nothing;
 *   - they expire after 2 days (DOMAIN_LIFECYCLES.handoff.ttlDays), so a long
 *     one is not a permanent tax;
 *   - they are written at end of session, under context pressure, when a hard
 *     rejection costs a full extra round trip — the friction this limit is
 *     meant to remove.
 *
 * 2000 chars is ~515 tokens, i.e. ~6% of the default context budget for the
 * single active handoff, and ~3x the length that was being hit in practice.
 * Past this the CLI trims rather than rejects; see utils/handoff-text.ts.
 */
export const MAX_HANDOFF_TEXT_LENGTH = 2000;

/** The text-length ceiling that applies to a given domain. */
export function limitForDomain(domain?: string): number {
  return domain === 'handoff' ? MAX_HANDOFF_TEXT_LENGTH : MAX_BELIEF_TEXT_LENGTH;
}

/**
 * The `beliefs.text` CHECK, shared by every schema path below — fresh
 * (createV2Schema), migrated (migrateV1toV2) and rebuilt (repairSupersedesFK,
 * migrateTextCheck) tables — so all of them stay in step.
 *
 * A column CHECK may read any column of the row it validates, so the ceiling is
 * chosen per row from `domain` and the DB stays the last line of defence for
 * both limits rather than deferring one of them to application code.
 *
 * The CHECK is the last line of defence, not the first: it fires inside the
 * INSERT, which in BeliefStore happens *after* older beliefs have been
 * superseded. Callers must therefore call assertBeliefTextLength() before doing
 * any destructive work. See BeliefStore.create().
 */
const TEXT_LENGTH_CHECK =
  `CHECK(length(text) <= CASE domain WHEN 'handoff' ` +
  `THEN ${MAX_HANDOFF_TEXT_LENGTH} ELSE ${MAX_BELIEF_TEXT_LENGTH} END)`;

/**
 * Substring identifying the domain-aware CHECK in `sqlite_master.sql`. A table
 * whose stored DDL lacks it predates the per-domain ceiling and is rebuilt by
 * migrateTextCheck().
 */
const TEXT_CHECK_MARKER = `CASE domain WHEN 'handoff'`;

/**
 * Length as SQLite's `length()` counts it: code points, not UTF-16 code units.
 * `'x'.length` would over-count astral characters (an emoji is 2 units but 1
 * code point) and reject text the CHECK would have accepted.
 */
export function beliefTextLength(text: string): number {
  return [...text].length;
}

/** Thrown when belief text exceeds the limit. Signals that nothing was written. */
export class BeliefTextTooLongError extends Error {
  readonly actualLength: number;
  readonly limit: number;

  constructor(actualLength: number, limit: number = MAX_BELIEF_TEXT_LENGTH) {
    super(
      // Keep this ASCII-only. The bundler emits a `// @bun` pragma that makes the
      // runtime read dist/index.js as latin-1, so raw non-ASCII in a template
      // literal reaches the terminal double-encoded.
      `belief text is ${actualLength} characters, which exceeds the ${limit}-character limit ` +
        `by ${actualLength - limit}. Nothing was modified. Shorten the text and retry.`
    );
    this.name = 'BeliefTextTooLongError';
    this.actualLength = actualLength;
    this.limit = limit;
  }
}

/**
 * Rejects text too long for `domain`. The domain must be the one the row will
 * actually be inserted with, or this validates against a different ceiling than
 * the CHECK will — see BeliefStore.resolveDomain().
 */
export function assertBeliefTextLength(text: string, domain?: string): void {
  const length = beliefTextLength(text);
  const limit = limitForDomain(domain);
  if (length > limit) {
    throw new BeliefTextTooLongError(length, limit);
  }
}

let db: Database | null = null;

export function getDatabase(projectDir?: string): Database {
  if (db) return db;

  const dataDir = ensureDataDir(projectDir);
  const dbPath = join(dataDir, 'memory.db');

  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  // busy_timeout: block up to 5s waiting for a locked DB instead of failing
  // immediately. Without this, bun:sqlite defaults to 0 and any two concurrent
  // writers race; the loser returns SQLITE_BUSY, callers often catch and drop
  // the write silently. With WAL + this timeout, serialization is transparent.
  db.exec('PRAGMA busy_timeout = 5000');
  // synchronous=NORMAL: fsync at commit + WAL checkpoint boundaries (not every
  // page write). Combined with WAL, this is the recommended durability level —
  // it prevents the partial-page-flush class of corruption that has repeatedly
  // truncated project .memorai/memory.db files under abrupt session shutdown.
  db.exec('PRAGMA synchronous = NORMAL');
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
        text TEXT NOT NULL ${TEXT_LENGTH_CHECK},
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
        supersedes_id TEXT REFERENCES beliefs_v2(id),
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
      // Ceiling depends on the domain the row is being reclassified INTO, and is
      // measured the way the CHECK measures it (code points, not UTF-16 units).
      const limit = limitForDomain(newDomain);
      const truncatedText =
        beliefTextLength(row.text) > limit
          ? [...row.text].slice(0, limit - 3).join('') + '...'
          : row.text;

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
      text TEXT NOT NULL ${TEXT_LENGTH_CHECK},
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

function hasBrokenSupersedesFK(database: Database): boolean {
  try {
    const row = database.query(
      `SELECT "table" as target FROM pragma_foreign_key_list('beliefs') WHERE "from" = 'supersedes_id'`
    ).get() as { target: string } | null;
    return row !== null && row.target !== 'beliefs';
  } catch {
    return false;
  }
}

function repairSupersedesFK(database: Database): void {
  const run = (sql: string) => database.exec(sql);
  run('PRAGMA foreign_keys = OFF');
  run('BEGIN TRANSACTION');
  try {
    run('DROP TRIGGER IF EXISTS beliefs_ai');
    run('DROP TRIGGER IF EXISTS beliefs_ad');
    run('DROP TRIGGER IF EXISTS beliefs_au');

    run(`
      CREATE TABLE beliefs_fixed (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL ${TEXT_LENGTH_CHECK},
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
        supersedes_id TEXT REFERENCES beliefs_fixed(id),
        invalidated_at INTEGER,
        invalidation_reason TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    run(`
      INSERT INTO beliefs_fixed
      SELECT id, text, domain, belief_type, confidence, importance, tags,
             project, stakeholder, verify_by, expires_at, action, source_session,
             derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, created_at
      FROM beliefs
    `);

    run('DROP TABLE beliefs');
    run('ALTER TABLE beliefs_fixed RENAME TO beliefs');
    run('DROP TABLE IF EXISTS beliefs_fts');

    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
  run('PRAGMA foreign_keys = ON');
}

/**
 * True when `beliefs` still carries a flat `CHECK(length(text) <= N)` instead of
 * the domain-aware one, i.e. the table was created before handoffs got their own
 * ceiling.
 */
function needsTextCheckMigration(database: Database): boolean {
  try {
    const row = database.query(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'beliefs'`
    ).get() as { sql: string | null } | null;
    if (!row?.sql) return false;
    return !row.sql.includes(TEXT_CHECK_MARKER);
  } catch {
    return false;
  }
}

/**
 * Rebuilds `beliefs` so its text CHECK becomes domain-aware. A CHECK cannot be
 * altered in place, so this is the standard table-rebuild dance, same shape as
 * repairSupersedesFK().
 *
 * Widening only: the new ceiling is >= the old one for every domain, so no
 * existing row can fail the copy. Rows are moved verbatim — this migration
 * never rewrites belief text.
 */
function migrateTextCheck(database: Database): void {
  const run = (sql: string) => database.exec(sql);
  run('PRAGMA foreign_keys = OFF');
  run('BEGIN TRANSACTION');
  try {
    run('DROP TRIGGER IF EXISTS beliefs_ai');
    run('DROP TRIGGER IF EXISTS beliefs_ad');
    run('DROP TRIGGER IF EXISTS beliefs_au');

    run(`
      CREATE TABLE beliefs_relimited (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL ${TEXT_LENGTH_CHECK},
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
        supersedes_id TEXT REFERENCES beliefs_relimited(id),
        invalidated_at INTEGER,
        invalidation_reason TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);

    run(`
      INSERT INTO beliefs_relimited
      SELECT id, text, domain, belief_type, confidence, importance, tags,
             project, stakeholder, verify_by, expires_at, action, source_session,
             derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, created_at
      FROM beliefs
    `);

    run('DROP TABLE beliefs');
    run('ALTER TABLE beliefs_relimited RENAME TO beliefs');
    run('DROP TABLE IF EXISTS beliefs_fts');

    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
  run('PRAGMA foreign_keys = ON');
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
    // Already v2 -- apply any pending table rebuilds, then ensure indexes/FTS/triggers.
    // Both rebuilds recreate `beliefs` from TEXT_LENGTH_CHECK, so repairing the FK
    // already brings the text CHECK forward; re-test rather than assume.
    let rebuilt = false;

    if (hasBrokenSupersedesFK(database)) {
      repairSupersedesFK(database);
      rebuilt = true;
    }
    if (needsTextCheckMigration(database)) {
      migrateTextCheck(database);
      rebuilt = true;
    }

    createIndexes(database);
    createFTS(database);
    createTriggers(database);
    // A rebuild drops beliefs_fts; its contents must be reindexed from the table.
    if (rebuilt) rebuildFTS(database);
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
