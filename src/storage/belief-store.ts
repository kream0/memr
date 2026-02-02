import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './sqlite.js';
import { generateEmbedding, cosineSimilarity } from '../utils/embeddings.js';
import type { Belief, BeliefDomain, SearchOptions, BeliefSearchResult } from '../types.js';
import { loadConfig } from '../utils/config.js';

export class BeliefStore {
  private get db() {
    return getDatabase();
  }

  create(belief: Omit<Belief, 'id'>): Belief {
    const id = uuidv4();

    // Generate embedding if not provided
    let embedding = belief.embedding;
    if (!embedding) {
      embedding = generateEmbedding(belief.text);
    }

    const fullBelief: Belief = { id, ...belief, embedding };

    const stmt = this.db.prepare(`
      INSERT INTO beliefs (
        id, text, domain, confidence, evidence_ids,
        supporting_count, contradicting_count, derived_at, last_evaluated,
        supersedes_id, invalidated_at, invalidation_reason, importance, tags, embedding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      belief.text,
      belief.domain,
      belief.confidence,
      JSON.stringify(belief.evidence_ids),
      belief.supporting_count,
      belief.contradicting_count,
      belief.derived_at,
      belief.last_evaluated,
      belief.supersedes_id || null,
      belief.invalidated_at || null,
      belief.invalidation_reason || null,
      belief.importance,
      JSON.stringify(belief.tags),
      JSON.stringify(embedding)
    );

    return fullBelief;
  }

  getById(id: string): Belief | null {
    const stmt = this.db.prepare('SELECT * FROM beliefs WHERE id = ?');
    const row = stmt.get(id) as BeliefRow | null;

    if (!row) return null;
    return this.rowToBelief(row);
  }

  getByDomain(domain: BeliefDomain, options: { activeOnly?: boolean } = {}): Belief[] {
    let query = 'SELECT * FROM beliefs WHERE domain = ?';
    if (options.activeOnly !== false) {
      query += ' AND invalidated_at IS NULL';
    }
    query += ' ORDER BY confidence DESC, importance DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(domain) as BeliefRow[];

    return rows.map((row) => this.rowToBelief(row));
  }

  getActive(options: SearchOptions = {}): Belief[] {
    let query = 'SELECT * FROM beliefs WHERE invalidated_at IS NULL';
    const params: (string | number)[] = [];

    if (options.minConfidence) {
      query += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    if (options.domain) {
      query += ' AND domain = ?';
      params.push(options.domain);
    }

    query += ' ORDER BY importance DESC, confidence DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as BeliefRow[];

    return rows.map((row) => this.rowToBelief(row));
  }

  update(id: string, changes: Partial<Belief>): Belief | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (changes.text !== undefined) {
      updates.push('text = ?');
      params.push(changes.text);
    }
    if (changes.confidence !== undefined) {
      updates.push('confidence = ?');
      params.push(changes.confidence);
    }
    if (changes.evidence_ids !== undefined) {
      updates.push('evidence_ids = ?');
      params.push(JSON.stringify(changes.evidence_ids));
    }
    if (changes.supporting_count !== undefined) {
      updates.push('supporting_count = ?');
      params.push(changes.supporting_count);
    }
    if (changes.contradicting_count !== undefined) {
      updates.push('contradicting_count = ?');
      params.push(changes.contradicting_count);
    }
    if (changes.last_evaluated !== undefined) {
      updates.push('last_evaluated = ?');
      params.push(changes.last_evaluated);
    }
    if (changes.importance !== undefined) {
      updates.push('importance = ?');
      params.push(changes.importance);
    }
    if (changes.tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(changes.tags));
    }
    if (changes.embedding !== undefined) {
      updates.push('embedding = ?');
      params.push(JSON.stringify(changes.embedding));
    }

    if (updates.length === 0) return existing;

    params.push(id);

    const stmt = this.db.prepare(`UPDATE beliefs SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...params);

    return this.getById(id);
  }

  invalidate(id: string, reason: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE beliefs
      SET invalidated_at = ?, invalidation_reason = ?
      WHERE id = ? AND invalidated_at IS NULL
    `);

    const result = stmt.run(Date.now(), reason, id);
    return result.changes > 0;
  }

  incrementContradicting(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE beliefs SET contradicting_count = contradicting_count + 1 WHERE id = ?
    `);
    stmt.run(id);
  }

  incrementSupporting(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE beliefs SET supporting_count = supporting_count + 1 WHERE id = ?
    `);
    stmt.run(id);
  }

  adjustConfidence(ids: string[], delta: number): void {
    if (ids.length === 0) return;

    const config = loadConfig();
    const placeholders = ids.map(() => '?').join(',');

    // Clamp confidence between minConfidenceFloor and 1.0
    const stmt = this.db.prepare(`
      UPDATE beliefs
      SET confidence = MAX(?, MIN(1.0, confidence + ?))
      WHERE id IN (${placeholders})
    `);

    stmt.run(config.minConfidenceFloor, delta, ...ids);
  }

  searchKeyword(query: string, options: SearchOptions = {}): Belief[] {
    let sql = `
      SELECT b.* FROM beliefs b
      JOIN beliefs_fts fts ON b.rowid = fts.rowid
      WHERE beliefs_fts MATCH ?
    `;
    const params: (string | number)[] = [query];

    if (options.activeOnly !== false) {
      sql += ' AND b.invalidated_at IS NULL';
    }

    if (options.minConfidence) {
      sql += ' AND b.confidence >= ?';
      params.push(options.minConfidence);
    }

    if (options.domain) {
      sql += ' AND b.domain = ?';
      params.push(options.domain);
    }

    sql += ' ORDER BY rank';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as BeliefRow[];

    return rows.map((row) => this.rowToBelief(row));
  }

  searchSemantic(query: string, options: SearchOptions = {}): BeliefSearchResult[] {
    const queryEmbedding = generateEmbedding(query);

    // Get all active beliefs with embeddings
    const beliefs = this.getActive({
      ...options,
      limit: undefined, // Get all for semantic search, then filter
    });

    // Calculate similarity scores
    const scored = beliefs
      .filter((b) => b.embedding)
      .map((b) => ({
        belief: b,
        score: cosineSimilarity(queryEmbedding, b.embedding!),
        matchType: 'semantic' as const,
      }));

    // Sort by score and apply limit
    scored.sort((a, b) => b.score - a.score);

    const limit = options.limit || 10;
    return scored.slice(0, limit);
  }

  searchHybrid(query: string, options: SearchOptions = {}): BeliefSearchResult[] {
    const keywordResults = this.searchKeyword(query, { ...options, limit: (options.limit || 10) * 2 });
    const semanticResults = this.searchSemantic(query, { ...options, limit: (options.limit || 10) * 2 });

    // Combine results with deduplication
    const seen = new Set<string>();
    const combined: BeliefSearchResult[] = [];

    // Interleave results, preferring higher scores
    const keywordMap = new Map(keywordResults.map((b, i) => [b.id, { belief: b, score: 1 - i * 0.1 }]));

    for (const result of semanticResults) {
      if (seen.has(result.belief.id)) continue;
      seen.add(result.belief.id);

      const keywordMatch = keywordMap.get(result.belief.id);
      const finalScore = keywordMatch
        ? (result.score + keywordMatch.score) / 2
        : result.score;

      combined.push({
        belief: result.belief,
        score: finalScore,
        matchType: keywordMatch ? 'hybrid' : 'semantic',
      });
    }

    // Add keyword-only results
    for (const belief of keywordResults) {
      if (seen.has(belief.id)) continue;
      seen.add(belief.id);

      combined.push({
        belief,
        score: 0.5, // Lower score for keyword-only matches
        matchType: 'keyword',
      });
    }

    combined.sort((a, b) => b.score - a.score);

    const limit = options.limit || 10;
    return combined.slice(0, limit);
  }

  count(options: { activeOnly?: boolean; domain?: BeliefDomain } = {}): number {
    let query = 'SELECT COUNT(*) as count FROM beliefs';
    const conditions: string[] = [];
    const params: string[] = [];

    if (options.activeOnly !== false) {
      conditions.push('invalidated_at IS NULL');
    }

    if (options.domain) {
      conditions.push('domain = ?');
      params.push(options.domain);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { count: number };
    return result.count;
  }

  getStatsPerDomain(): Record<BeliefDomain, { count: number; avgConfidence: number }> {
    const stmt = this.db.prepare(`
      SELECT domain, COUNT(*) as count, AVG(confidence) as avgConfidence
      FROM beliefs
      WHERE invalidated_at IS NULL
      GROUP BY domain
    `);

    const rows = stmt.all() as { domain: string; count: number; avgConfidence: number }[];

    const stats: Record<string, { count: number; avgConfidence: number }> = {};
    for (const row of rows) {
      stats[row.domain] = {
        count: row.count,
        avgConfidence: row.avgConfidence,
      };
    }

    return stats as Record<BeliefDomain, { count: number; avgConfidence: number }>;
  }

  applyConfidenceDecay(): number {
    const config = loadConfig();
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    // Get beliefs that need decay applied
    const stmt = this.db.prepare(`
      UPDATE beliefs
      SET confidence = MAX(?, confidence - ? * ((? - last_evaluated) / ?))
      WHERE invalidated_at IS NULL
        AND confidence > ?
    `);

    const result = stmt.run(
      config.minConfidenceFloor,
      config.confidenceDecayPerDay,
      now,
      dayInMs,
      config.minConfidenceFloor
    );

    return result.changes;
  }

  private rowToBelief(row: BeliefRow): Belief {
    return {
      id: row.id,
      text: row.text,
      domain: row.domain as BeliefDomain,
      confidence: row.confidence,
      evidence_ids: JSON.parse(row.evidence_ids),
      supporting_count: row.supporting_count,
      contradicting_count: row.contradicting_count,
      derived_at: row.derived_at,
      last_evaluated: row.last_evaluated,
      supersedes_id: row.supersedes_id || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
      importance: row.importance,
      tags: row.tags ? JSON.parse(row.tags) : [],
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
    };
  }
}

interface BeliefRow {
  id: string;
  text: string;
  domain: string;
  confidence: number;
  evidence_ids: string;
  supporting_count: number;
  contradicting_count: number;
  derived_at: number;
  last_evaluated: number;
  supersedes_id: string | null;
  invalidated_at: number | null;
  invalidation_reason: string | null;
  importance: number;
  tags: string | null;
  embedding: string | null;
  created_at: number;
}

// Singleton instance
let beliefStore: BeliefStore | null = null;

export function getBeliefStore(): BeliefStore {
  if (!beliefStore) {
    beliefStore = new BeliefStore();
  }
  return beliefStore;
}

export function resetBeliefStore(): void {
  beliefStore = null;
}
