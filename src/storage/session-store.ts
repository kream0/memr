import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './sqlite.js';
import type { Session } from '../types.js';

export class SessionStore {
  private get db() {
    return getDatabase();
  }

  create(): Session {
    const id = uuidv4();
    const now = Date.now();

    const session: Session = {
      id,
      started_at: now,
      event_count: 0,
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, started_at, event_count)
      VALUES (?, ?, 0)
    `);

    stmt.run(id, now);

    return session;
  }

  getById(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | null;

    if (!row) return null;
    return this.rowToSession(row);
  }

  getCurrent(): Session | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `);

    const row = stmt.get() as SessionRow | null;
    if (!row) return null;
    return this.rowToSession(row);
  }

  getOrCreate(): Session {
    const current = this.getCurrent();
    if (current) return current;
    return this.create();
  }

  end(id: string, summary?: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET ended_at = ?, summary = ?
      WHERE id = ? AND ended_at IS NULL
    `);

    const result = stmt.run(Date.now(), summary || null, id);
    return result.changes > 0;
  }

  incrementEventCount(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET event_count = event_count + 1 WHERE id = ?
    `);
    stmt.run(id);
  }

  updateSummary(id: string, summary: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE sessions SET summary = ? WHERE id = ?
    `);

    const result = stmt.run(summary, id);
    return result.changes > 0;
  }

  getRecent(limit: number = 10): Session[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      ORDER BY started_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  count(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sessions');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      started_at: row.started_at,
      ended_at: row.ended_at || undefined,
      summary: row.summary || undefined,
      event_count: row.event_count,
    };
  }
}

interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  summary: string | null;
  event_count: number;
}

// Singleton instance
let sessionStore: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!sessionStore) {
    sessionStore = new SessionStore();
  }
  return sessionStore;
}

export function resetSessionStore(): void {
  sessionStore = null;
}
