import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './sqlite.js';
import type { Belief, BeliefDomain, BeliefType, Importance, SearchOptions, NewBelief, ScoredBelief, ContextOptions } from '../types.js';
import { DOMAIN_LIFECYCLES } from '../types.js';
import { computeImportance, autoDetectDomain, autoDetectType, computeContextScore, jaccardSimilarity, expandQuery, areContradictory } from '../utils/scoring.js';
import { computeDecay, isExpired, formatOrientOutput } from '../utils/lifecycle.js';

interface BeliefRow {
  id: string;
  text: string;
  domain: string;
  belief_type: string;
  confidence: number;
  importance: number;
  tags: string | null;
  project: string | null;
  stakeholder: string | null;
  verify_by: number | null;
  expires_at: number | null;
  action: string | null;
  source_session: number | null;
  derived_at: number;
  last_evaluated: number;
  supersedes_id: string | null;
  invalidated_at: number | null;
  invalidation_reason: string | null;
  created_at: number;
}

export class BeliefStore {
  private get db() {
    return getDatabase();
  }

  create(input: NewBelief): Belief {
    const domain = input.domain ?? autoDetectDomain(input.text);
    const beliefType = input.belief_type ?? autoDetectType(input.text, domain);
    const tags = input.tags ?? [];
    const importance = input.importance ?? computeImportance({ domain, belief_type: beliefType, text: input.text, tags });
    const confidence = input.confidence ?? this.computeInitialConfidence(domain, beliefType);
    const now = Date.now();

    // Duplicate detection: merge instead of creating a new belief
    const duplicate = this.findDuplicate(input.text, domain, 0.5);
    if (duplicate) {
      // Even when merging a duplicate, check cross-domain contradictions (e.g. dup project fact vs rule)
      if (domain !== 'rule') {
        const rules = this.getActive({ domain: 'rule' });
        for (const rule of rules) {
          if (areContradictory(input.text, rule.text)) {
            process.stderr.write(
              `WARNING: Contradicts rule [${rule.id.slice(0, 8)}]: "${rule.text.slice(0, 80)}"\n`
            );
            break;
          }
        }
      }
      return this.merge(duplicate, input);
    }

    // Auto-supersede pending beliefs when shipped/completed version is stored
    if (/\b(shipped|completed|done|delivered|implemented|finished)\b/i.test(input.text)) {
      const pendingBeliefs = this.getActive({ domain }).filter(
        b => b.belief_type === 'pending' && this.textsShareSubject(input.text, b.text)
      );
      for (const pending of pendingBeliefs) {
        this.invalidate(pending.id, 'Superseded by shipped/completed version');
      }
    }

    // Contradiction detection: check for conflicting beliefs before insert
    let supersedesId = input.supersedes_id ?? null;
    const contradiction = this.findContradiction(input.text, domain);
    if (contradiction) {
      if (contradiction.isRule && domain !== 'rule') {
        // New fact contradicts an existing rule — warn but DON'T auto-invalidate the rule
        process.stderr.write(
          `WARNING: Contradicts rule [${contradiction.belief.id.slice(0, 8)}]: "${contradiction.belief.text.slice(0, 80)}"\n`
        );
      } else {
        // Same-domain contradiction — auto-invalidate the old belief, new one supersedes
        this.invalidate(contradiction.belief.id, `Contradicted by newer belief`);
        supersedesId = contradiction.belief.id;
        process.stderr.write(
          `SUPERSEDED: Old belief [${contradiction.belief.id.slice(0, 8)}] invalidated -- contradicted by this one\n`
        );
      }
    }

    const id = uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO beliefs (
        id, text, domain, belief_type, confidence, importance, tags,
        project, stakeholder, verify_by, expires_at, action, source_session,
        derived_at, last_evaluated, supersedes_id, invalidated_at, invalidation_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.text,
      domain,
      beliefType,
      confidence,
      importance,
      JSON.stringify(tags),
      input.project ?? null,
      input.stakeholder ?? null,
      input.verify_by ?? null,
      input.expires_at ?? null,
      input.action ?? null,
      input.source_session ?? null,
      now,
      now,
      supersedesId,
      null,
      null
    );

    return {
      id,
      text: input.text,
      domain,
      belief_type: beliefType,
      confidence,
      importance,
      tags,
      project: input.project,
      stakeholder: input.stakeholder,
      verify_by: input.verify_by,
      expires_at: input.expires_at,
      action: input.action,
      source_session: input.source_session,
      derived_at: now,
      last_evaluated: now,
      supersedes_id: supersedesId ?? undefined,
    };
  }

  findDuplicate(text: string, domain: BeliefDomain, threshold: number): Belief | null {
    const actives = this.getActive({ domain });
    for (const belief of actives) {
      const jaccard = jaccardSimilarity(text, belief.text);
      // Adaptive: if below threshold but shares 3+ significant words, lower to 0.25
      let effectiveThreshold = threshold;
      if (jaccard < threshold && jaccard >= 0.2) {
        const sharedSigWords = this.countSharedSignificantWords(text, belief.text);
        if (sharedSigWords >= 3) {
          effectiveThreshold = 0.25;
        }
      }
      if (jaccard >= effectiveThreshold) {
        return belief;
      }
    }
    return null;
  }

  findContradiction(text: string, domain: BeliefDomain): { belief: Belief; isRule: boolean } | null {
    // Check same-domain contradictions first
    const actives = this.getActive({ domain });
    for (const belief of actives) {
      if (areContradictory(text, belief.text)) {
        return { belief, isRule: domain === 'rule' };
      }
    }
    // Cross-domain: check new belief against ALL other domains
    // Rules get special treatment (isRule flag affects resolution behavior in create())
    const allDomains: BeliefDomain[] = ['rule', 'project', 'infra', 'pattern', 'stakeholder', 'watch', 'skill', 'handoff'];
    for (const crossDomain of allDomains) {
      if (crossDomain === domain) continue; // already checked same-domain above
      const beliefs = this.getActive({ domain: crossDomain });
      for (const belief of beliefs) {
        if (areContradictory(text, belief.text)) {
          return { belief, isRule: crossDomain === 'rule' };
        }
      }
    }
    return null;
  }

  merge(existing: Belief, newer: NewBelief): Belief {
    const updatedText = newer.text || existing.text;
    const updatedConfidence = Math.min(1.0, existing.confidence + 0.05);
    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE beliefs
      SET text = ?, confidence = ?, last_evaluated = ?
      WHERE id = ?
    `);
    stmt.run(updatedText, updatedConfidence, now, existing.id);

    return {
      ...existing,
      text: updatedText,
      confidence: updatedConfidence,
      last_evaluated: now,
    };
  }

  getById(id: string): Belief | null {
    const stmt = this.db.prepare('SELECT * FROM beliefs WHERE id = ?');
    const row = stmt.get(id) as BeliefRow | null;
    if (!row) return null;
    return this.rowToBelief(row);
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

  getContextBeliefs(options: ContextOptions): ScoredBelief[] {
    const allActive = this.getActive({ minConfidence: 0.3 });

    // Score every active belief
    const scored: ScoredBelief[] = allActive.map((belief) => ({
      belief,
      score: computeContextScore(belief, options),
      estimatedTokens: Math.ceil(belief.text.length / 4) + 15,
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const selected: ScoredBelief[] = [];
    let tokensBudgetRemaining = options.tokenBudget;

    // Phase 1: Guarantee 1 slot per critical type
    const criticalTypes: BeliefType[] = ['handoff', 'pending', 'watch', 'directive'];
    const usedIds = new Set<string>();

    for (const ctype of criticalTypes) {
      const candidate = scored.find(
        (s) => s.belief.belief_type === ctype && !usedIds.has(s.belief.id)
      );
      if (candidate && candidate.estimatedTokens <= tokensBudgetRemaining) {
        selected.push(candidate);
        usedIds.add(candidate.belief.id);
        tokensBudgetRemaining -= candidate.estimatedTokens;
      }
    }

    // Phase 2: Fill remaining budget by score
    for (const entry of scored) {
      if (usedIds.has(entry.belief.id)) continue;
      if (entry.estimatedTokens > tokensBudgetRemaining) continue;
      selected.push(entry);
      usedIds.add(entry.belief.id);
      tokensBudgetRemaining -= entry.estimatedTokens;
    }

    // Re-sort final selection by score
    selected.sort((a, b) => b.score - a.score);

    return selected;
  }

  orient(): string {
    const beliefs = this.getContextBeliefs({ tokenBudget: 3000, sessionType: 'interactive' });
    const totalStored = this.count();
    return formatOrientOutput(
      beliefs.map((sb) => sb.belief),
      totalStored
    );
  }

  search(query: string, options: SearchOptions = {}): Belief[] {
    const sanitized = this.sanitizeFtsQuery(query);

    // Try FTS5 first
    try {
      const results = this.searchFTS(sanitized, options);
      if (results.length > 0) return results;
    } catch {
      // FTS5 failed, fall through to LIKE
    }

    // Fallback to LIKE search
    return this.searchLike(query, options);
  }

  check(topic: string, limit: number = 3): Belief[] {
    // First try direct search
    const direct = this.search(topic, { limit });
    if (direct.length >= limit) return direct;

    // Expand and search for synonyms
    const expanded = expandQuery(topic);
    const seen = new Set(direct.map(b => b.id));
    const results = [...direct];

    for (const term of expanded) {
      if (results.length >= limit) break;
      const found = this.search(term, { limit: limit - results.length });
      for (const b of found) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          results.push(b);
        }
      }
    }

    return results.slice(0, limit);
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
    if (changes.importance !== undefined) {
      updates.push('importance = ?');
      params.push(changes.importance);
    }
    if (changes.domain !== undefined) {
      updates.push('domain = ?');
      params.push(changes.domain);
    }
    if (changes.belief_type !== undefined) {
      updates.push('belief_type = ?');
      params.push(changes.belief_type);
    }
    if (changes.tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(changes.tags));
    }
    if (changes.project !== undefined) {
      updates.push('project = ?');
      params.push(changes.project ?? null);
    }
    if (changes.stakeholder !== undefined) {
      updates.push('stakeholder = ?');
      params.push(changes.stakeholder ?? null);
    }
    if (changes.verify_by !== undefined) {
      updates.push('verify_by = ?');
      params.push(changes.verify_by ?? null);
    }
    if (changes.expires_at !== undefined) {
      updates.push('expires_at = ?');
      params.push(changes.expires_at ?? null);
    }
    if (changes.action !== undefined) {
      updates.push('action = ?');
      params.push(changes.action ?? null);
    }
    if (changes.source_session !== undefined) {
      updates.push('source_session = ?');
      params.push(changes.source_session ?? null);
    }
    if (changes.last_evaluated !== undefined) {
      updates.push('last_evaluated = ?');
      params.push(changes.last_evaluated);
    }

    if (updates.length === 0) return existing;

    params.push(id);
    const stmt = this.db.prepare(`UPDATE beliefs SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...params);

    return this.getById(id);
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

  createHandoff(text: string, sessionNumber?: number): Belief {
    // Invalidate ALL existing active handoff beliefs
    const activeHandoffs = this.getActive({ domain: 'handoff' });
    for (const h of activeHandoffs) {
      this.invalidate(h.id, 'Superseded by new handoff');
    }

    const twoDays = 2 * 24 * 60 * 60 * 1000;

    return this.create({
      text,
      domain: 'handoff',
      belief_type: 'handoff',
      confidence: 1.0,
      importance: 5 as Importance,
      expires_at: Date.now() + twoDays,
      source_session: sessionNumber,
      tags: ['handoff'],
    });
  }

  curate(dryRun: boolean = false): { expired: number; decayed: number; merged: number; capped: number; invalidated: number; resolved: number } {
    const stats = { expired: 0, decayed: 0, merged: 0, capped: 0, invalidated: 0, resolved: 0 };
    const allActive = this.getActive();

    // 1. Expire beliefs past expires_at
    for (const belief of allActive) {
      if (isExpired(belief)) {
        stats.expired++;
        if (!dryRun) {
          this.invalidate(belief.id, 'Expired (past expires_at)');
        }
      }
    }

    // 2. Apply time-based confidence decay per DOMAIN_LIFECYCLES
    const stillActive = dryRun ? allActive.filter((b) => !isExpired(b)) : this.getActive();
    for (const belief of stillActive) {
      const lifecycle = DOMAIN_LIFECYCLES[belief.domain];
      if (!lifecycle) continue;

      const decayed = computeDecay(belief, lifecycle);
      if (decayed < belief.confidence) {
        stats.decayed++;
        if (!dryRun) {
          this.update(belief.id, { confidence: decayed, last_evaluated: Date.now() });
        }
      }
    }

    // 3. Detect and merge duplicates (same domain, adaptive threshold)
    const postDecay = dryRun ? stillActive : this.getActive();
    const domains = [...new Set(postDecay.map((b) => b.domain))] as BeliefDomain[];
    const mergedIds = new Set<string>();

    for (const domain of domains) {
      const domainBeliefs = postDecay.filter((b) => b.domain === domain && !mergedIds.has(b.id));
      for (let i = 0; i < domainBeliefs.length; i++) {
        if (mergedIds.has(domainBeliefs[i].id)) continue;
        for (let j = i + 1; j < domainBeliefs.length; j++) {
          if (mergedIds.has(domainBeliefs[j].id)) continue;
          const jaccard = jaccardSimilarity(domainBeliefs[i].text, domainBeliefs[j].text);
          // Adaptive threshold: lower when beliefs share significant words
          let threshold = 0.5;
          if (jaccard < 0.5 && jaccard >= 0.2) {
            const sharedSigWords = this.countSharedSignificantWords(domainBeliefs[i].text, domainBeliefs[j].text);
            // 3+ shared significant words → lower threshold to 0.25
            // This catches "Express server runs on port 3100" vs "TaskFlow uses Express on port 3100 with SQLite"
            if (sharedSigWords >= 3) {
              threshold = 0.25;
            }
          }
          if (jaccard > threshold) {
            stats.merged++;
            mergedIds.add(domainBeliefs[j].id);
            if (!dryRun) {
              // Keep the higher-confidence one, merge text from newer
              const keeper = domainBeliefs[i].confidence >= domainBeliefs[j].confidence
                ? domainBeliefs[i] : domainBeliefs[j];
              const loser = keeper.id === domainBeliefs[i].id
                ? domainBeliefs[j] : domainBeliefs[i];
              this.merge(keeper, { text: keeper.text, domain: keeper.domain });
              this.invalidate(loser.id, `Merged into ${keeper.id}`);
            }
          }
        }
      }
    }

    // 4. Enforce per-domain caps (from DOMAIN_LIFECYCLES.maxPerDomain)
    const postMerge = dryRun ? postDecay.filter((b) => !mergedIds.has(b.id)) : this.getActive();
    for (const domain of domains) {
      const lifecycle = DOMAIN_LIFECYCLES[domain];
      if (!lifecycle) continue;

      const domainBeliefs = postMerge
        .filter((b) => b.domain === domain)
        .sort((a, b) => {
          // Sort by importance DESC, confidence DESC for cap enforcement
          if (b.importance !== a.importance) return b.importance - a.importance;
          return b.confidence - a.confidence;
        });

      if (domainBeliefs.length > lifecycle.maxPerDomain) {
        const excess = domainBeliefs.slice(lifecycle.maxPerDomain);
        for (const belief of excess) {
          stats.capped++;
          if (!dryRun) {
            this.invalidate(belief.id, `Domain cap exceeded (${domain}: max ${lifecycle.maxPerDomain})`);
          }
        }
      }
    }

    // 5. Auto-invalidate beliefs with confidence < 0.2
    const postCap = dryRun ? postMerge : this.getActive();
    for (const belief of postCap) {
      if (belief.confidence < 0.2) {
        stats.invalidated++;
        if (!dryRun) {
          this.invalidate(belief.id, 'Confidence below threshold (< 0.2)');
        }
      }
    }

    // 6. Resolve active contradictions
    const postInvalidate = dryRun ? postCap.filter(b => b.confidence >= 0.2) : this.getActive();
    const contradictionPairs = this.findAllContradictions(postInvalidate);
    for (const [beliefA, beliefB] of contradictionPairs) {
      stats.resolved++;
      if (!dryRun) {
        const winner = this.resolveContradiction(beliefA, beliefB);
        const loser = winner.id === beliefA.id ? beliefB : beliefA;
        this.invalidate(loser.id, `Contradicted by ${winner.id.slice(0, 8)} (auto-resolved by curate)`);
      }
    }

    return stats;
  }

  // --------------- Private helpers ---------------

  private findAllContradictions(beliefs: Belief[]): Array<[Belief, Belief]> {
    const pairs: Array<[Belief, Belief]> = [];
    const resolved = new Set<string>();

    for (let i = 0; i < beliefs.length; i++) {
      if (resolved.has(beliefs[i].id)) continue;
      for (let j = i + 1; j < beliefs.length; j++) {
        if (resolved.has(beliefs[j].id)) continue;
        if (areContradictory(beliefs[i].text, beliefs[j].text)) {
          pairs.push([beliefs[i], beliefs[j]]);
          // Mark the loser so we don't create overlapping pairs
          const winner = this.resolveContradiction(beliefs[i], beliefs[j]);
          const loserId = winner.id === beliefs[i].id ? beliefs[j].id : beliefs[i].id;
          resolved.add(loserId);
        }
      }
    }
    return pairs;
  }

  private resolveContradiction(a: Belief, b: Belief): Belief {
    // Priority hierarchy for who wins:
    // 1. Rules/directives always win over facts
    const aIsRule = a.domain === 'rule' || a.belief_type === 'directive';
    const bIsRule = b.domain === 'rule' || b.belief_type === 'directive';
    if (aIsRule && !bIsRule) return a;
    if (bIsRule && !aIsRule) return b;

    // 2. "Shipped/completed" wins over "pending"
    const aShipped = /\b(shipped|completed|done|delivered|implemented|finished)\b/i.test(a.text);
    const bShipped = /\b(shipped|completed|done|delivered|implemented|finished)\b/i.test(b.text);
    const aPending = /\b(pending|waiting|requested|needs)\b/i.test(a.text);
    const bPending = /\b(pending|waiting|requested|needs)\b/i.test(b.text);
    if (aShipped && bPending) return a;
    if (bShipped && aPending) return b;

    // 3. Higher importance wins
    if (a.importance !== b.importance) return a.importance > b.importance ? a : b;

    // 4. Higher confidence wins
    if (Math.abs(a.confidence - b.confidence) > 0.05) return a.confidence > b.confidence ? a : b;

    // 5. Newer wins (tie-breaker)
    return a.derived_at >= b.derived_at ? a : b;
  }

  private countSharedSignificantWords(textA: string, textB: string): number {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
      'need', 'must', 'on', 'in', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
      'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'this', 'that', 'it', 'its', 'all',
      'uses', 'use', 'used', 'using',
    ]);
    const tokenize = (s: string) => {
      const words = s.toLowerCase().replace(/[^\w\s-]/g, '').split(/\s+/).filter(Boolean);
      return new Set(words.filter(w => !stopWords.has(w) && w.length > 2));
    };
    const wordsA = tokenize(textA);
    const wordsB = tokenize(textB);
    return [...wordsA].filter(w => wordsB.has(w)).length;
  }

  private sanitizeFtsQuery(query: string): string {
    return query.replace(/(\w+(?:-\w+)+)/g, '"$1"');
  }

  private searchFTS(query: string, options: SearchOptions): Belief[] {
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

  private searchLike(query: string, options: SearchOptions): Belief[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    let sql = 'SELECT * FROM beliefs WHERE 1=1';
    const params: (string | number)[] = [];

    // Search across text, tags, project, and stakeholder
    const termConditions: string[] = [];
    for (const term of terms) {
      termConditions.push('(LOWER(text) LIKE ? OR LOWER(COALESCE(tags, \'\')) LIKE ? OR LOWER(COALESCE(project, \'\')) LIKE ? OR LOWER(COALESCE(stakeholder, \'\')) LIKE ?)');
      params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
    }
    sql += ' AND (' + termConditions.join(' AND ') + ')';

    if (options.activeOnly !== false) {
      sql += ' AND invalidated_at IS NULL';
    }

    if (options.minConfidence) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    if (options.domain) {
      sql += ' AND domain = ?';
      params.push(options.domain);
    }

    sql += ' ORDER BY importance DESC, confidence DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as BeliefRow[];
    return rows.map((row) => this.rowToBelief(row));
  }

  private textsShareSubject(a: string, b: string): boolean {
    // Check if two texts are about the same subject by looking for shared significant words
    const significant = (s: string) => {
      const words = s.toLowerCase().replace(/[^\w\s-]/g, '').split(/\s+/).filter(Boolean);
      return new Set(words.filter(w => !['the','a','an','is','are','was','for','to','of','with','in','on','by','from','and','but','or','not','has','have','had','this','that'].includes(w) && w.length > 2));
    };
    const wordsA = significant(a);
    const wordsB = significant(b);
    const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
    const minSize = Math.min(wordsA.size, wordsB.size);
    return minSize > 0 && overlap / minSize > 0.3;
  }

  private computeInitialConfidence(domain: BeliefDomain, type: BeliefType): number {
    // Rules from corrections start high — they're validated by human feedback
    if (domain === 'rule' || type === 'directive') return 0.95;
    // Handoffs are fresh and certain
    if (type === 'handoff') return 1.0;
    // Watch items start lower — they're hypotheses to verify
    if (type === 'watch') return 0.75;
    // Pending items are uncertain by nature
    if (type === 'pending') return 0.80;
    // Decisions are deliberate
    if (type === 'decision') return 0.90;
    // Facts are default
    return 0.85;
  }

  private rowToBelief(row: BeliefRow): Belief {
    return {
      id: row.id,
      text: row.text,
      domain: row.domain as BeliefDomain,
      belief_type: row.belief_type as BeliefType,
      confidence: row.confidence,
      importance: row.importance as Importance,
      tags: row.tags ? (row.tags.startsWith('[') ? JSON.parse(row.tags) : [row.tags]) : [],
      project: row.project ?? undefined,
      stakeholder: row.stakeholder ?? undefined,
      verify_by: row.verify_by ?? undefined,
      expires_at: row.expires_at ?? undefined,
      action: row.action ?? undefined,
      source_session: row.source_session ?? undefined,
      derived_at: row.derived_at,
      last_evaluated: row.last_evaluated,
      supersedes_id: row.supersedes_id ?? undefined,
      invalidated_at: row.invalidated_at ?? undefined,
      invalidation_reason: row.invalidation_reason ?? undefined,
    };
  }
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

// Re-export database functions so index.ts doesn't import sqlite.ts directly.
// This prevents bun's bundler from duplicating the sqlite module (and its db singleton).
export { getDatabase, closeDatabase } from './sqlite.js';
