/**
 * Regression tests: the keyword contradiction check must never invalidate.
 *
 * areContradictory() is a keyword guess. Before the fix, a hit on add made the
 * new belief invalidate the old one and set supersedes_id to it, and curate
 * auto-resolved every flagged pair by invalidating one side. The test fires on
 * unrelated pairs that share a few words and differ in negation, so beliefs
 * nobody meant to replace were silently lost, across domains and rule-vs-rule.
 *
 * The pairs below are paraphrases of real pairs that were wrongly invalidated.
 * Each one still trips the same pattern in areContradictory(); they are
 * unrelated in meaning.
 *
 * Replacing a belief is now explicit: `add-belief --supersedes <full-id>`.
 *
 * These run the built CLI as a subprocess, one fresh store per test (the store
 * lives under the cwd). Set MEMR_BUNDLE to run them against another build, e.g.
 * the pre-fix bundle, to see them fail.
 */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = process.env.MEMR_BUNDLE ?? join(import.meta.dir, '..', 'dist', 'index.js');
const FIXTURE_ROOT = join(import.meta.dir, '.fixtures');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Row {
  id: string;
  text: string;
  domain: string;
  supersedes_id: string | null;
  invalidated_at: number | null;
  invalidation_reason: string | null;
}

function fixture(): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  return mkdtempSync(join(FIXTURE_ROOT, 'memr-contra-'));
}

function run(cwd: string, args: string[]): RunResult {
  const proc = Bun.spawnSync(['bun', BUNDLE, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function withDb<T>(cwd: string, fn: (db: Database) => T): T {
  const db = new Database(join(cwd, '.memorai', 'memory.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function rows(cwd: string): Row[] {
  return withDb(cwd, db =>
    db.query('SELECT id, text, domain, supersedes_id, invalidated_at, invalidation_reason FROM beliefs').all() as Row[]
  );
}

function row(cwd: string, id: string): Row {
  const found = rows(cwd).find(r => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

/** Adds a belief through the CLI and returns its full id. */
function add(cwd: string, text: string, domain: string, extra: string[] = []): { id: string; result: RunResult } {
  const result = run(cwd, ['add-belief', '-t', text, '-d', domain, ...extra]);
  const id = result.stdout.match(/Added belief: (\S+)/)?.[1] ?? '';
  return { id, result };
}

/**
 * Writes a row straight into the store, bypassing create(). Used to seed both
 * sides of a keyword pair for curate: adding the second through the CLI would
 * already have invalidated the first on the pre-fix build.
 */
function insertRaw(cwd: string, id: string, text: string, domain: string): void {
  const now = Date.now();
  withDb(cwd, db =>
    db.run(
      `INSERT INTO beliefs (id, text, domain, belief_type, confidence, importance, tags, derived_at, last_evaluated)
       VALUES (?, ?, ?, 'fact', 0.9, 3, '[]', ?, ?)`,
      [id, text, domain, now, now]
    )
  );
}

// Paraphrased from real pairs. Each "newer" text trips areContradictory()
// against its "older" partner (pattern noted), though they are unrelated.
const PAIRS = [
  {
    name: 'cross-domain, watch hit by an infra add ("may not yet." vs "not yet deployed")',
    older: {
      domain: 'watch',
      text: 'ROOT CAUSE: the inject helper pasted WITHOUT bracketed paste; any newline in the pasted text leaves the message stuck on screen, never submitted, while the helper still printed OK. Restart or upgrade does NOT fix it. Fix = bracketed paste + transcript check, committed on a branch, not yet deployed.',
    },
    newer: {
      domain: 'infra',
      text: 'Under /apps/ the public vhost has limit_except GET: a public POST gets 403. A backend that needs the display server must call it on loopback, never via the public host. The unlock-check route answers 404 for unknown names; other /apps/ routes may not yet.',
    },
  },
  {
    name: 'cross-domain, a pattern hit by a cut-off three-word add (negation + 2 shared words)',
    older: {
      domain: 'pattern',
      text: "stalled-lead detector: after a resume, Claude Code re-delivers a dead session's notifications MERGED into one user entry; the queue item never gets its own dequeue, so a ledger-only replay reads it as open forever (false STUCK).",
    },
    newer: { domain: 'infra', text: 'Claude Code asks Dangerous' },
  },
  {
    name: 'same domain ("not the page" vs "deployed")',
    older: {
      domain: 'infra',
      text: 'Changing what a shared route returns, or how a token is built, is an interface change: grep every project checkout for the route and cookie name before deploying. The hardening broke a dev gate for 4h while page probes stayed 200. Probe each consumer outcome, not the page.',
    },
    newer: {
      domain: 'infra',
      text: 'The lane copy of the publish tool lacks the X-Apps-Admin header that the live copy (deployed today) sends and the hardened server requires for register/protect. Deploying the lane copy would break publishing. Rule: before shipping a lane-ahead file, diff it against the live blob; port, never blob-swap.',
    },
  },
  {
    name: 'same domain ("lacks the X-..." vs any "the")',
    older: {
      domain: 'infra',
      text: 'The lane copy of the publish tool lacks the X-Apps-Admin header that the live copy (deployed today) sends and the hardened server requires for register/protect. Deploying the lane copy would break publishing. Rule: before shipping a lane-ahead file, diff it against the live blob; port, never blob-swap.',
    },
    newer: {
      domain: 'infra',
      text: 'Claude Code shows a Dangerous rm operation prompt even in bypass mode when rm -rf targets a command substitution. An unattended project agent then blocks until someone answers; I checked the target first and answered. Rule: brief agents to clean temp dirs by literal path or a glob under their scratchpad.',
    },
  },
];

const WARNING = 'WARNING: possible contradiction (keyword match only, NOT invalidated)';

describe('add: a keyword contradiction warns and never invalidates', () => {
  for (const pair of PAIRS) {
    test(pair.name, () => {
      const cwd = fixture();
      const older = add(cwd, pair.older.text, pair.older.domain);
      expect(older.result.exitCode).toBe(0);

      const newer = add(cwd, pair.newer.text, pair.newer.domain);
      expect(newer.result.exitCode).toBe(0);
      expect(newer.id).not.toBe('');

      // The older belief is untouched; the newer one is stored and links nothing.
      expect(row(cwd, older.id).invalidated_at).toBeNull();
      expect(row(cwd, newer.id).invalidated_at).toBeNull();
      expect(row(cwd, newer.id).supersedes_id).toBeNull();

      // The warning names the candidate by FULL id (ids match exactly; a prefix
      // finds nothing), its domain, and the exact command to act on it.
      const stderr = newer.result.stderr;
      expect(stderr).toContain(WARNING);
      expect(stderr).toContain(`${older.id} [${pair.older.domain}] "${pair.older.text.slice(0, 80)}"`);
      expect(stderr).toContain(`mem-reason invalidate ${older.id} -r "superseded by ${newer.id}"`);
      expect(stderr).not.toContain('SUPERSEDED');
    });
  }

  test('rule vs rule: a new rule does not invalidate an older rule', () => {
    const cwd = fixture();
    const [, , same] = PAIRS;
    const older = add(cwd, same.older.text, 'rule');
    const newer = add(cwd, same.newer.text, 'rule');
    expect(newer.result.exitCode).toBe(0);

    expect(row(cwd, older.id).invalidated_at).toBeNull();
    expect(row(cwd, newer.id).supersedes_id).toBeNull();
    expect(newer.result.stderr).toContain(`${WARNING}: ${older.id} [rule]`);
  });
});

describe('add-belief --supersedes <full-id>', () => {
  const TARGET = 'Deploys go through the surgical copy script; a whole-repo sync is forbidden.';
  // Close enough to TARGET that a plain add would merge into it in place.
  const REPHRASE = 'Deploys go through the surgical copy script, one named file at a time; a whole-repo sync is forbidden.';

  test('invalidates the target and links it, even when the text rephrases it', () => {
    const cwd = fixture();
    const target = add(cwd, TARGET, 'infra');
    const replacement = add(cwd, REPHRASE, 'infra', ['--supersedes', target.id]);

    expect(replacement.result.exitCode).toBe(0);
    expect(replacement.id).not.toBe('');
    expect(replacement.id).not.toBe(target.id);

    const old = row(cwd, target.id);
    expect(old.invalidated_at).not.toBeNull();
    expect(old.invalidation_reason).toBe(`Superseded by ${replacement.id}`);
    expect(old.text).toBe(TARGET);

    const fresh = row(cwd, replacement.id);
    expect(fresh.invalidated_at).toBeNull();
    expect(fresh.supersedes_id).toBe(target.id);
    expect(fresh.text).toBe(REPHRASE);
    expect(rows(cwd)).toHaveLength(2);
  });

  test('refuses an id that is not the full id of an active belief, and writes nothing', () => {
    const cwd = fixture();
    const target = add(cwd, TARGET, 'infra');
    const gone = add(cwd, 'Staging runs on the second box behind the shared proxy.', 'infra');
    expect(run(cwd, ['invalidate', gone.id, '-r', 'retired']).exitCode).toBe(0);
    const before = JSON.stringify(rows(cwd));

    // A short prefix of a real id: refused, and the error points at the full id.
    const prefix = add(cwd, REPHRASE, 'infra', ['--supersedes', target.id.slice(0, 8)]);
    expect(prefix.result.exitCode).not.toBe(0);
    expect(prefix.result.stderr).toContain(`cannot supersede "${target.id.slice(0, 8)}"`);
    expect(prefix.result.stderr).toContain(target.id);

    // An id that matches nothing.
    const unknown = add(cwd, REPHRASE, 'infra', ['--supersedes', '00000000-0000-4000-8000-000000000000']);
    expect(unknown.result.exitCode).not.toBe(0);
    expect(unknown.result.stderr).toContain('no belief has that id');

    // An id that is already invalidated.
    const stale = add(cwd, REPHRASE, 'infra', ['--supersedes', gone.id]);
    expect(stale.result.exitCode).not.toBe(0);
    expect(stale.result.stderr).toContain('already invalidated');

    // Nothing written: same rows, same state, target still active.
    expect(JSON.stringify(rows(cwd))).toBe(before);
    expect(row(cwd, target.id).invalidated_at).toBeNull();
  });
});

describe('curate: keyword contradictions are reported, never invalidated', () => {
  test('flagged pairs stay active and are listed on stderr', () => {
    const cwd = fixture();
    const [crossA, crossC] = PAIRS;
    const ids = {
      aOld: add(cwd, crossA.older.text, crossA.older.domain).id,
      cOld: '6c1d4f0e-2b7a-4c39-9e51-0a8f3d2b7c14',
      aNew: 'b2e7a9c3-5d10-4f6b-8a2e-7c9d1e3f5a60',
      cNew: 'e4f8b1d2-9a3c-4e57-b6d0-1f2a3b4c5d6e',
    };
    insertRaw(cwd, ids.cOld, crossC.older.text, crossC.older.domain);
    insertRaw(cwd, ids.aNew, crossA.newer.text, crossA.newer.domain);
    insertRaw(cwd, ids.cNew, crossC.newer.text, crossC.newer.domain);

    const result = run(cwd, ['curate']);
    expect(result.exitCode).toBe(0);

    for (const id of Object.values(ids)) {
      expect(row(cwd, id).invalidated_at).toBeNull();
    }
    expect(result.stdout).toContain('Flagged:      2');
    const flagged = result.stderr.split('\n').filter(l => l.startsWith(WARNING));
    expect(flagged).toHaveLength(2);
    expect(flagged.some(l => l.includes(ids.aOld) && l.includes(ids.aNew))).toBe(true);
    expect(flagged.some(l => l.includes(ids.cOld) && l.includes(ids.cNew))).toBe(true);
    // No ready-made invalidate command: which side to drop, if any, is a human call.
    expect(result.stderr).not.toContain('mem-reason invalidate');
  });
});

describe('handoff: auto-supersede still works and touches nothing else', () => {
  test('the previous handoff is replaced; a keyword-matching belief elsewhere stays active', () => {
    const cwd = fixture();
    const seed = add(cwd, 'The changelog is published to the docs site and deployed weekly.', 'project');

    expect(run(cwd, ['handoff', 'STATE: release notes drafted. NEXT: review them with the team.']).exitCode).toBe(0);
    const first = rows(cwd).find(r => r.domain === 'handoff');
    expect(first).toBeDefined();

    // Trips areContradictory() against the seed ("not yet published to the docs site").
    const second = run(cwd, ['handoff', 'STATE: release notes written. NEXT: the changelog is not yet published to the docs site.']);
    expect(second.exitCode).toBe(0);

    const handoffs = rows(cwd).filter(r => r.domain === 'handoff');
    expect(handoffs).toHaveLength(2);
    expect(row(cwd, first!.id).invalidated_at).not.toBeNull();
    expect(handoffs.filter(r => r.invalidated_at === null)).toHaveLength(1);

    expect(row(cwd, seed.id).invalidated_at).toBeNull();
    expect(second.stderr).not.toContain('SUPERSEDED');
  });
});

describe('invalidate: an id that matches nothing is an error', () => {
  test('unknown id and short prefix exit non-zero and change nothing; the full id works', () => {
    const cwd = fixture();
    const target = add(cwd, 'Backups run nightly at 03:00 to the second disk.', 'infra');

    const unknown = run(cwd, ['invalidate', '00000000-0000-4000-8000-000000000000', '-r', 'test']);
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr).toContain('Belief not found');

    const prefix = run(cwd, ['invalidate', target.id.slice(0, 8), '-r', 'test']);
    expect(prefix.exitCode).not.toBe(0);
    expect(prefix.stderr).toContain(target.id);
    expect(row(cwd, target.id).invalidated_at).toBeNull();

    const full = run(cwd, ['invalidate', target.id, '-r', 'test']);
    expect(full.exitCode).toBe(0);
    expect(row(cwd, target.id).invalidated_at).not.toBeNull();
  });
});
