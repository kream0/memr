import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './sqlite.js';
import type { Event, EventType, EventPayload, EventContext, SearchOptions } from '../types.js';

export class EventStore {
  private get db() {
    return getDatabase();
  }

  create(event: Omit<Event, 'id'>): Event {
    const id = uuidv4();
    const fullEvent: Event = { id, ...event };

    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, session_id, timestamp, payload, context, searchable_text, processed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      event.type,
      event.session_id,
      event.timestamp,
      JSON.stringify(event.payload),
      JSON.stringify(event.context),
      event.searchable_text,
      event.processed ? 1 : 0
    );

    return fullEvent;
  }

  capture(
    type: EventType,
    sessionId: string,
    payload: EventPayload,
    context: EventContext = {}
  ): Event {
    const searchableText = this.buildSearchableText(type, payload);

    return this.create({
      type,
      session_id: sessionId,
      timestamp: Date.now(),
      payload,
      context,
      searchable_text: searchableText,
      processed: false,
    });
  }

  private buildSearchableText(type: EventType, payload: EventPayload): string {
    const parts: string[] = [type];

    if (payload.tool_name) parts.push(payload.tool_name);
    if (payload.tool_output) parts.push(payload.tool_output.slice(0, 1000));
    if (payload.message_content) parts.push(payload.message_content);
    if (payload.file_path) parts.push(payload.file_path);
    if (payload.error_message) parts.push(payload.error_message);

    return parts.join(' ');
  }

  getById(id: string): Event | null {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    const row = stmt.get(id) as EventRow | null;

    if (!row) return null;
    return this.rowToEvent(row);
  }

  getBySession(sessionId: string, options: SearchOptions = {}): Event[] {
    let query = 'SELECT * FROM events WHERE session_id = ?';
    const params: (string | number)[] = [sessionId];

    if (options.timeRange) {
      query += ' AND timestamp >= ? AND timestamp <= ?';
      params.push(options.timeRange.start, options.timeRange.end);
    }

    query += ' ORDER BY timestamp DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  getUnprocessed(sessionId?: string, options: { limit?: number } = {}): Event[] {
    let query = 'SELECT * FROM events WHERE processed = 0';
    const params: (string | number)[] = [];

    if (sessionId) {
      query += ' AND session_id = ?';
      params.push(sessionId);
    }

    query += ' ORDER BY timestamp ASC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  markProcessed(ids: string[]): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`UPDATE events SET processed = 1 WHERE id IN (${placeholders})`);
    stmt.run(...ids);
  }

  search(query: string, options: SearchOptions = {}): Event[] {
    let sql = `
      SELECT e.* FROM events e
      JOIN events_fts fts ON e.rowid = fts.rowid
      WHERE events_fts MATCH ?
    `;
    const params: (string | number)[] = [query];

    if (options.timeRange) {
      sql += ' AND e.timestamp >= ? AND e.timestamp <= ?';
      params.push(options.timeRange.start, options.timeRange.end);
    }

    sql += ' ORDER BY rank';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  getRecent(limit: number = 50): Event[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as EventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  getAfter(timestamp: number, options: { limit?: number } = {}): Event[] {
    let query = 'SELECT * FROM events WHERE timestamp > ? ORDER BY timestamp ASC';
    const params: (string | number)[] = [timestamp];

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EventRow[];

    return rows.map((row) => this.rowToEvent(row));
  }

  count(sessionId?: string): number {
    let query = 'SELECT COUNT(*) as count FROM events';
    const params: string[] = [];

    if (sessionId) {
      query += ' WHERE session_id = ?';
      params.push(sessionId);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { count: number };
    return result.count;
  }

  private rowToEvent(row: EventRow): Event {
    return {
      id: row.id,
      type: row.type as EventType,
      session_id: row.session_id,
      timestamp: row.timestamp,
      payload: JSON.parse(row.payload),
      context: row.context ? JSON.parse(row.context) : {},
      searchable_text: row.searchable_text,
      processed: row.processed === 1,
    };
  }
}

interface EventRow {
  id: string;
  type: string;
  session_id: string;
  timestamp: number;
  payload: string;
  context: string | null;
  searchable_text: string;
  processed: number;
  created_at: number;
}

// Singleton instance
let eventStore: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!eventStore) {
    eventStore = new EventStore();
  }
  return eventStore;
}

export function resetEventStore(): void {
  eventStore = null;
}
