/**
 * Regression tests for the destructive-write bug in the belief write path.
 *
 * `beliefs.text` carries a length CHECK. Before the fix nothing validated
 * length before the INSERT, and `create()` did its supersede and invalidate
 * work *before* that fallible insert with no transaction around the pair. An
 * oversize payload therefore destroyed existing beliefs and then crashed,
 * leaving the store strictly worse off than before the call — a too-long
 * `handoff` wiped session continuity outright.
 *
 * `handoff` no longer rejects over-long text at all (it is stored in full to
 * HANDOFF_LIMIT, and trimmed past it), so it can no longer reach the
 * destructive branch by that route. The data-loss contract is still asserted
 * for it below, from the other direction: whatever the length, the store must
 * never end up with the previous handoff invalidated and no replacement.
 *
 * These run the built CLI as a subprocess so they observe real exit codes and
 * stderr. Isolation is by cwd: getDataDir() resolves to
 * `join(process.cwd(), '.memorai')`, so every fixture is a fresh temp dir.
 *
 * Set MEMR_BUNDLE to point at another build (e.g. the pre-fix bundle) to
 * demonstrate the failure.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = process.env.MEMR_BUNDLE ?? join(import.meta.dir, '..', 'dist', 'index.js');
const FIXTURE_ROOT = join(import.meta.dir, '.fixtures');
const TEXT_LIMIT = 500;
const HANDOFF_LIMIT = 2000;
const OVERSIZE = 600;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

function fixture(): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  return mkdtempSync(join(FIXTURE_ROOT, 'memr-'));
}

function run(cwd: string, args: string[]): RunResult {
  const proc = Bun.spawnSync(['bun', BUNDLE, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { exitCode: proc.exitCode ?? -1, stdout, stderr, output: stdout + stderr };
}

function beliefs(cwd: string, where = ''): any[] {
  const db = new Database(join(cwd, '.memorai', 'memory.db'));
  try {
    return db.query(`SELECT id, text, domain, belief_type, invalidated_at FROM beliefs ${where}`).all();
  } finally {
    db.close();
  }
}

function activeCount(cwd: string): number {
  return beliefs(cwd, 'WHERE invalidated_at IS NULL').length;
}

/**
 * Builds a payload of exactly `len` chars that (a) shares its subject with the
 * seeded belief so the destructive branches engage, and (b) carries enough
 * unique filler that jaccard similarity stays far below the 0.5/0.25 dedup
 * thresholds — otherwise create() takes the early merge() return and never
 * reaches the insert being tested.
 */
function longText(len: number, subject: string): string {
  let s = `${subject} shipped `;
  for (let i = 0; s.length < len; i++) s += `zt${i.toString().padStart(3, '0')}qx `;
  return s.slice(0, len);
}

const SUBJECT = 'Zephyr migration Postgres analytics cluster';
const PENDING_SEED = 'Zephyr migration Postgres analytics cluster pending review';

/**
 * Seeds a fixture with one active belief the command under test would destroy,
 * then fires an oversize payload at it.
 *
 * `handoff` destroys via createHandoff's invalidate loop; `remember` and
 * `add-belief` destroy via create()'s pending auto-supersede, which is why
 * their seed is a `pending` belief sharing a subject with the payload.
 */
function seedAndFire(command: 'handoff' | 'remember' | 'add-belief', size = OVERSIZE) {
  const dir = fixture();
  const seed =
    command === 'handoff'
      ? run(dir, ['handoff', 'Session 41: renolink quote flow wired, invoice PDF still pending'])
      : run(dir, ['add-belief', '-t', PENDING_SEED, '-d', 'project', '--type', 'pending']);
  expect(seed.exitCode).toBe(0);

  const before = beliefs(dir, 'WHERE invalidated_at IS NULL');
  expect(before).toHaveLength(1);

  const payload = longText(size, SUBJECT);
  expect(payload).toHaveLength(size);

  const args =
    command === 'handoff'
      ? ['handoff', payload]
      : command === 'remember'
        ? ['remember', payload, '-d', 'project']
        : ['add-belief', '-t', payload, '-d', 'project'];

  return { dir, seededId: before[0].id as string, res: run(dir, args) };
}

/**
 * Commands that still reject over-long text outright. `handoff` is deliberately
 * absent: rejecting it is the friction this design removes, and its own
 * contract is asserted in the handoff describe blocks below.
 */
const COMMANDS = ['remember', 'add-belief'] as const;

// The data-loss contract. This is what regressed and caused the incident.
describe('oversize payload must not destroy existing beliefs', () => {
  for (const command of COMMANDS) {
    test(`${command}: the pre-existing belief is still active after the failure`, () => {
      const { dir, seededId, res } = seedAndFire(command);
      expect(res.exitCode).not.toBe(0);

      const after = beliefs(dir, `WHERE id = '${seededId}'`);
      expect(after[0].invalidated_at).toBeNull();

      // Nothing partial written either: still exactly the one seeded belief.
      expect(activeCount(dir)).toBe(1);
    });
  }
});

// The diagnostics contract: fail loudly but cleanly, never with a raw crash.
describe('oversize payload must fail cleanly', () => {
  for (const command of COMMANDS) {
    test(`${command}: reports the limit and the actual length, with no stack trace`, () => {
      const { res } = seedAndFire(command);

      expect(res.exitCode).not.toBe(0);
      // Must name the limit AND the actual length, so the caller can act on it.
      expect(res.output).toContain(String(TEXT_LIMIT));
      expect(res.output).toContain(String(OVERSIZE));
      // No raw crash: no stack frames, no SQLite internals, no sourcemap note.
      expect(res.output).not.toMatch(/^\s*at\s+/m);
      expect(res.output).not.toContain('SQLiteError');
      expect(res.output).not.toContain('--sourcemap');
    });
  }

  test('the text is never silently truncated to fit', () => {
    const { dir } = seedAndFire('add-belief');
    for (const b of beliefs(dir)) {
      expect(b.text.length).toBeLessThanOrEqual(TEXT_LIMIT);
      expect(b.text).not.toContain('zt0');
    }
  });
});

/**
 * The length check short-circuits before any writes, so on its own it does not
 * prove the transaction works. These use a payload that is *within* the limit
 * but violates a different CHECK, so the failure lands at the INSERT — after
 * the pending auto-supersede has already run.
 */
describe('a failure after the destructive step rolls back', () => {
  function seedThenFailAtInsert() {
    const dir = fixture();
    expect(run(dir, ['add-belief', '-t', PENDING_SEED, '-d', 'project', '--type', 'pending']).exitCode).toBe(0);
    const seededId = beliefs(dir, 'WHERE invalidated_at IS NULL')[0].id;

    // Under the limit, but long enough that dedup does not divert it to merge().
    const payload = longText(TEXT_LIMIT - 50, SUBJECT);
    const res = run(dir, ['add-belief', '-t', payload, '-d', 'project', '--type', 'bogus']);
    return { dir, seededId, res };
  }

  test('the superseded belief is restored when the insert fails', () => {
    const { dir, seededId, res } = seedThenFailAtInsert();
    expect(res.exitCode).not.toBe(0);

    const after = beliefs(dir, `WHERE id = '${seededId}'`);
    expect(after[0].invalidated_at).toBeNull();
    expect(beliefs(dir)).toHaveLength(1);
  });

  test('the rejection is reported cleanly, not as a raw crash', () => {
    const { res } = seedThenFailAtInsert();
    expect(res.output).not.toMatch(/^\s*at\s+/m);
    expect(res.output).not.toContain('Bun v');
    expect(res.output).toContain('Nothing was modified');
  });
});

/**
 * The handoff contract. A handoff is written at the end of a session, so a
 * rejection costs a full round trip to rewrite it: over-long text is accepted
 * instead. What must never happen is losing information without saying so.
 */
const STRUCTURED_STATE = 'renolink quote flow wired end to end, invoice PDF renderer landed behind a flag';
const STRUCTURED_NEXT = 'wire the Wave payment callback and backfill the June invoices';
const STRUCTURED_BLOCKER = 'OVH consumer key expired, DNS cutover is stuck until it is refreshed';

/**
 * A realistic STATE/NEXT/BLOCKERS handoff of exactly `len` characters.
 *
 * All padding goes into STATE and the length is made exact there, so NEXT and
 * BLOCKERS are always present verbatim. A fixture that padded the whole string
 * and sliced it to length would truncate BLOCKERS itself, and the tests would
 * be asserting against damage they caused rather than the trimmer's.
 */
function structuredHandoff(len: number): string {
  const head = `STATE: ${STRUCTURED_STATE}`;
  const tailParts = `\nNEXT: ${STRUCTURED_NEXT}\nBLOCKERS: ${STRUCTURED_BLOCKER}`;
  const padTarget = len - head.length - tailParts.length;
  if (padTarget < 0) throw new Error(`structuredHandoff: ${len} is shorter than the fixed sections`);

  let pad = '';
  for (let i = 0; pad.length < padTarget; i++) {
    pad += ` note${i.toString().padStart(3, '0')} detail;`;
  }

  return head + pad.slice(0, padTarget) + tailParts;
}

function handoffRow(dir: string): any {
  const rows = beliefs(dir, "WHERE domain = 'handoff' AND invalidated_at IS NULL");
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('handoff accepts over-long text instead of rejecting it', () => {
  test('a 700-char handoff is stored IN FULL, with a notice and no trimming', () => {
    const dir = fixture();
    const text = structuredHandoff(700);
    expect(text).toHaveLength(700);

    const res = run(dir, ['handoff', text]);
    expect(res.exitCode).toBe(0);

    // Stored verbatim: not one character lost.
    const row = handoffRow(dir);
    expect(row.text).toBe(text);
    expect(row.text).toHaveLength(700);

    // ...and said so, rather than passing silently over the belief guideline.
    expect(res.stderr).toContain('700');
    expect(res.stderr).toContain(String(TEXT_LIMIT));
    expect(res.stderr.toLowerCase()).toContain('full');

    // All three sections readable.
    expect(row.text).toContain(STRUCTURED_STATE);
    expect(row.text).toContain(STRUCTURED_NEXT);
    expect(row.text).toContain(STRUCTURED_BLOCKER);
  });

  test('the previous handoff is superseded and REPLACED, never left orphaned', () => {
    const dir = fixture();
    expect(run(dir, ['handoff', 'Session 41: quote flow wired, invoice PDF pending']).exitCode).toBe(0);
    const first = handoffRow(dir);

    expect(run(dir, ['handoff', structuredHandoff(700)]).exitCode).toBe(0);

    // The old one is invalidated (correct) AND a replacement is active (the
    // part that regressed: the old bug left the store with neither).
    const all = beliefs(dir, "WHERE domain = 'handoff'");
    expect(all).toHaveLength(2);
    expect(all.find((b) => b.id === first.id).invalidated_at).not.toBeNull();
    const current = handoffRow(dir);
    expect(current.id).not.toBe(first.id);
    expect(current.text).toContain(STRUCTURED_STATE);
  });

  test('exactly the belief limit passes silently; one over is stored in full with a notice', () => {
    const dir = fixture();

    const atLimit = structuredHandoff(TEXT_LIMIT);
    const at = run(dir, ['handoff', atLimit]);
    expect(at.exitCode).toBe(0);
    expect(at.stderr).toBe('');
    expect(handoffRow(dir).text).toBe(atLimit);

    const overLimit = structuredHandoff(TEXT_LIMIT + 1);
    const over = run(dir, ['handoff', overLimit]);
    expect(over.exitCode).toBe(0);
    expect(over.stderr).not.toBe('');
    // Still whole: past the guideline is a notice, not a cut.
    expect(handoffRow(dir).text).toBe(overLimit);
  });

  test('exactly the handoff limit is stored whole; one over is trimmed', () => {
    const dir = fixture();

    const atLimit = structuredHandoff(HANDOFF_LIMIT);
    expect(run(dir, ['handoff', atLimit]).exitCode).toBe(0);
    expect(handoffRow(dir).text).toBe(atLimit);

    const overLimit = structuredHandoff(HANDOFF_LIMIT + 1);
    const over = run(dir, ['handoff', overLimit]);
    expect(over.exitCode).toBe(0);
    expect(over.stderr).toContain('TRIMMED');
    expect(handoffRow(dir).text.length).toBeLessThanOrEqual(HANDOFF_LIMIT);
  });
});

describe('handoff trimming preserves structure and is never silent', () => {
  const HUGE = 2600;

  function trimmed() {
    const dir = fixture();
    const text = structuredHandoff(HUGE);
    expect(text).toHaveLength(HUGE);
    const res = run(dir, ['handoff', text]);
    expect(res.exitCode).toBe(0);
    return { dir, res, row: handoffRow(dir) };
  }

  test('the stored text fits the limit and the belief exists', () => {
    const { row } = trimmed();
    expect(row.text.length).toBeLessThanOrEqual(HANDOFF_LIMIT);
    expect(row.invalidated_at).toBeNull();
  });

  test('NEXT and BLOCKERS survive whole; STATE is what gives up the room', () => {
    const { row } = trimmed();

    // The whole point: the sections the next session cannot rediscover are the
    // ones kept. A naive tail-cut would have deleted BLOCKERS outright.
    expect(row.text).toContain('NEXT:');
    expect(row.text).toContain('BLOCKERS:');
    expect(row.text).toContain(STRUCTURED_NEXT);
    expect(row.text).toContain(STRUCTURED_BLOCKER);

    // STATE keeps its label and its opening, minus the padding.
    expect(row.text).toContain('STATE:');
    expect(row.text).toContain('renolink quote flow wired');
  });

  test('the trim is reported on stderr with the number of characters dropped', () => {
    const { res, row } = trimmed();

    expect(res.stderr).toContain('WARNING');
    expect(res.stderr).toContain(String(HUGE));
    expect(res.stderr).toContain(String(HANDOFF_LIMIT));

    // The reported count must be the real one, not a round number...
    const reported = res.stderr.match(/(\d+) characters were dropped/);
    expect(reported).not.toBeNull();
    const dropped = Number(reported![1]);
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThanOrEqual(HUGE - row.text.length);

    // ...and the headline must agree with the per-section breakdown. These
    // measure the same thing and disagreeing by the marker length would read
    // as a contradiction to whoever has to trust the number.
    const perSection = [...res.stderr.matchAll(/\(-(\d+)\)/g)].map((m) => Number(m[1]));
    expect(perSection.length).toBeGreaterThan(0);
    expect(perSection.reduce((a, b) => a + b, 0)).toBe(dropped);

    // And it must name where the loss happened.
    expect(res.stderr).toContain('STATE');
  });

  test('the cut lands on a word boundary and is marked in the stored text', () => {
    const { row } = trimmed();
    expect(row.text).toContain('...');
    // No half-word left at the cut: the marker follows a complete token.
    expect(row.text).not.toMatch(/\S{2,}\.\.\.[^.]/);
  });

  test('a handoff with no recognizable sections is still trimmed, not rejected', () => {
    const dir = fixture();
    const res = run(dir, ['handoff', longText(HUGE, 'Unstructured session dump')]);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain('WARNING');
    expect(handoffRow(dir).text.length).toBeLessThanOrEqual(HANDOFF_LIMIT);
  });
});

describe('the raised ceiling is enforced, not merely advisory', () => {
  test('add-belief -d handoff still rejects past the handoff limit, naming it', () => {
    const dir = fixture();
    const payload = longText(HANDOFF_LIMIT + 100, 'Ceiling check');
    const res = run(dir, ['add-belief', '-t', payload, '-d', 'handoff']);

    expect(res.exitCode).not.toBe(0);
    expect(res.output).toContain(String(HANDOFF_LIMIT));
    expect(res.output).not.toMatch(/^\s*at\s+/m);
  });

  test('the wider ceiling does not leak to other domains', () => {
    const dir = fixture();
    const payload = longText(TEXT_LIMIT + 100, 'Leak check');
    const res = run(dir, ['add-belief', '-t', payload, '-d', 'project']);

    expect(res.exitCode).not.toBe(0);
    expect(res.output).toContain(String(TEXT_LIMIT));
  });

  test('the schema CHECK enforces both ceilings, not just the application code', () => {
    const dir = fixture();
    expect(run(dir, ['handoff', 'seed']).exitCode).toBe(0);

    const db = new Database(join(dir, '.memorai', 'memory.db'));
    try {
      const insert = (domain: string, len: number) =>
        db.run(
          `INSERT INTO beliefs (id, text, domain, belief_type, confidence, importance, derived_at, last_evaluated)
           VALUES (?, ?, ?, 'fact', 0.5, 3, 0, 0)`,
          [`probe-${domain}-${len}`, 'x'.repeat(len), domain]
        );

      // Bypassing the CLI entirely: the DB itself must hold the line.
      expect(() => insert('handoff', HANDOFF_LIMIT)).not.toThrow();
      expect(() => insert('handoff', HANDOFF_LIMIT + 1)).toThrow(/CHECK/);
      expect(() => insert('project', TEXT_LIMIT)).not.toThrow();
      expect(() => insert('project', TEXT_LIMIT + 1)).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });
});

/**
 * Databases created before the per-domain ceiling carry a flat
 * `CHECK(length(text) <= 500)`. A CHECK cannot be altered in place, so opening
 * such a database has to rebuild the table — the risky kind of operation, on
 * the file that holds every belief the user has.
 */
describe('an existing database migrates to the per-domain ceiling', () => {
  /** Rewrites `beliefs` with the pre-migration flat CHECK. */
  function downgradeToFlatCheck(dir: string): void {
    const db = new Database(join(dir, '.memorai', 'memory.db'));
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN TRANSACTION');
      db.exec(`
        CREATE TABLE beliefs_old (
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
          supersedes_id TEXT REFERENCES beliefs_old(id),
          invalidated_at INTEGER,
          invalidation_reason TEXT,
          created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
        )
      `);
      db.exec(`
        INSERT INTO beliefs_old
        SELECT id, text, domain, belief_type, confidence, importance, tags,
               project, stakeholder, verify_by, expires_at, action, source_session,
               derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason, created_at
        FROM beliefs
      `);
      db.exec('DROP TABLE beliefs');
      db.exec('ALTER TABLE beliefs_old RENAME TO beliefs');
      db.exec('DROP TABLE IF EXISTS beliefs_fts');
      db.exec('COMMIT');
    } finally {
      db.close();
    }
  }

  function legacyFixture() {
    const dir = fixture();
    expect(run(dir, ['handoff', 'Session 40: legacy database, DNS cutover pending']).exitCode).toBe(0);
    expect(run(dir, ['add-belief', '-t', 'Wave payouts settle T+2', '-d', 'project']).exitCode).toBe(0);
    downgradeToFlatCheck(dir);
    return dir;
  }

  test('the flat CHECK is really in place before the migration runs', () => {
    const dir = legacyFixture();
    const db = new Database(join(dir, '.memorai', 'memory.db'));
    try {
      const sql = db.query(`SELECT sql FROM sqlite_master WHERE name = 'beliefs'`).get() as { sql: string };
      expect(sql.sql).toContain('length(text) <= 500');
      expect(sql.sql).not.toContain('CASE domain');
    } finally {
      db.close();
    }
  });

  test('a long handoff succeeds against a migrated database', () => {
    const dir = legacyFixture();
    const res = run(dir, ['handoff', structuredHandoff(700)]);
    expect(res.exitCode).toBe(0);
    expect(handoffRow(dir).text).toHaveLength(700);
  });

  test('the migration preserves every existing belief, active and invalidated', () => {
    const dir = legacyFixture();
    const before = beliefs(dir).map((b) => `${b.id}:${b.text}`).sort();

    expect(run(dir, ['status']).exitCode).toBe(0);

    const after = beliefs(dir).map((b) => `${b.id}:${b.text}`).sort();
    expect(after).toEqual(before);
  });

  test('search still works after the rebuild, so FTS was reindexed', () => {
    const dir = legacyFixture();
    const res = run(dir, ['search', 'Wave']);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('Wave payouts');
  });

  test('the migration is idempotent', () => {
    const dir = legacyFixture();
    for (let i = 0; i < 3; i++) expect(run(dir, ['status']).exitCode).toBe(0);
    expect(beliefs(dir)).toHaveLength(2);
  });
});

describe('happy path must keep working', () => {
  test('handoff: a normal-length handoff inserts and supersedes the previous one', () => {
    const dir = fixture();
    expect(run(dir, ['handoff', 'Session 41: renolink quote flow wired, invoice PDF still pending']).exitCode).toBe(0);
    const first = beliefs(dir, "WHERE domain = 'handoff'")[0];

    const res = run(dir, ['handoff', 'Session 42: invoice PDF rendering done, Wave payment callback next']);
    expect(res.exitCode).toBe(0);

    const all = beliefs(dir, "WHERE domain = 'handoff'");
    expect(all).toHaveLength(2);

    const previous = all.find((b) => b.id === first.id);
    const current = all.find((b) => b.id !== first.id);
    expect(previous.invalidated_at).not.toBeNull();
    expect(current.invalidated_at).toBeNull();
    expect(current.text).toContain('Session 42');
  });

  test('add-belief: a payload of exactly the limit is accepted', () => {
    const dir = fixture();
    const payload = longText(TEXT_LIMIT, 'Boundary check');
    expect(payload).toHaveLength(TEXT_LIMIT);

    const res = run(dir, ['add-belief', '-t', payload, '-d', 'project']);
    expect(res.exitCode).toBe(0);
    expect(activeCount(dir)).toBe(1);
  });

  test('read commands still work after a rejected write', () => {
    const { dir } = seedAndFire('add-belief');
    for (const cmd of [['orient'], ['context'], ['check', 'Zephyr'], ['search', 'Zephyr'], ['curate', '--dry-run']]) {
      const res = run(dir, cmd);
      expect(res.exitCode).toBe(0);
    }
  });
});
