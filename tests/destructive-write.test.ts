/**
 * Regression tests for the destructive-write bug in the belief write path.
 *
 * `beliefs.text` carries `CHECK(length(text) <= 500)`. Before the fix nothing
 * validated length before the INSERT, and `create()` did its supersede and
 * invalidate work *before* that fallible insert with no transaction around the
 * pair. An oversize payload therefore destroyed existing beliefs and then
 * crashed, leaving the store strictly worse off than before the call — a
 * too-long `handoff` wiped session continuity outright.
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
function seedAndFire(command: 'handoff' | 'remember' | 'add-belief') {
  const dir = fixture();
  const seed =
    command === 'handoff'
      ? run(dir, ['handoff', 'Session 41: renolink quote flow wired, invoice PDF still pending'])
      : run(dir, ['add-belief', '-t', PENDING_SEED, '-d', 'project', '--type', 'pending']);
  expect(seed.exitCode).toBe(0);

  const before = beliefs(dir, 'WHERE invalidated_at IS NULL');
  expect(before).toHaveLength(1);

  const payload = longText(OVERSIZE, SUBJECT);
  expect(payload).toHaveLength(OVERSIZE);

  const args =
    command === 'handoff'
      ? ['handoff', payload]
      : command === 'remember'
        ? ['remember', payload, '-d', 'project']
        : ['add-belief', '-t', payload, '-d', 'project'];

  return { dir, seededId: before[0].id as string, res: run(dir, args) };
}

const COMMANDS = ['handoff', 'remember', 'add-belief'] as const;

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
    const { dir } = seedAndFire('handoff');
    for (const cmd of [['orient'], ['context'], ['check', 'Zephyr'], ['search', 'Zephyr'], ['curate', '--dry-run']]) {
      const res = run(dir, cmd);
      expect(res.exitCode).toBe(0);
    }
  });
});
