// Belief Domain — categorizes WHERE a belief lives
export type BeliefDomain =
  | 'handoff'      // Session continuity — what was happening, what's next
  | 'watch'        // Regression monitors — things to verify, fragile fixes
  | 'project'      // Per-project operational state (ports, versions, DB)
  | 'stakeholder'  // People, their asks, pending deliverables
  | 'rule'         // Hard constraints, mandatory behaviors, owner mandates
  | 'pattern'      // Proven workflows, architecture decisions, deploy pipelines
  | 'infra'        // Infrastructure facts (ports, services, topology, VPS state)
  | 'skill';       // Tool/skill existence and usage patterns

// Belief Type — categorizes WHAT kind of knowledge
export type BeliefType =
  | 'directive'    // "Always do X", "Never do Y" — actionable instruction
  | 'fact'         // "Port 5433 runs cosware" — verifiable state
  | 'handoff'      // "Session 26 was working on X, next: Y" — session continuity
  | 'watch'        // "Verify voice transcription still works" — regression monitor
  | 'decision'     // "We chose MariaDB over Postgres because..." — rationale
  | 'pending';     // "Hicham waiting for migration SQL" — unresolved deliverable

export type Importance = 1 | 2 | 3 | 4 | 5;
// 5 = CRITICAL (10% of beliefs) — violation causes owner frustration
// 4 = HIGH (20%) — required for competent operation
// 3 = STANDARD (40%) — useful context that improves quality
// 2 = LOW (20%) — nice to know, not critical
// 1 = ARCHIVE (10%) — historical, rarely needed

export interface Belief {
  id: string;
  text: string;                    // Max 300 chars — atomic, actionable
  domain: BeliefDomain;
  belief_type: BeliefType;
  confidence: number;              // 0.0-1.0, decays over time
  importance: Importance;          // 1-5, algorithmically computed
  tags: string[];

  // Structured metadata (nullable, domain-dependent)
  project?: string;                // Which project (null = global)
  stakeholder?: string;            // Who this involves
  verify_by?: number;              // When to re-verify (for 'watch' type)
  expires_at?: number;             // Auto-invalidate after this (for 'handoff')
  action?: string;                 // What to DO about this
  source_session?: number;         // Session number that created this

  // Lifecycle
  derived_at: number;
  last_evaluated: number;
  supersedes_id?: string;
  invalidated_at?: number;
  invalidation_reason?: string;
}

export interface NewBelief {
  text: string;
  domain: BeliefDomain;
  belief_type?: BeliefType;
  confidence?: number;
  importance?: Importance;
  tags?: string[];
  project?: string;
  stakeholder?: string;
  verify_by?: number;
  expires_at?: number;
  action?: string;
  source_session?: number;
  supersedes_id?: string;
}

export interface ScoredBelief {
  belief: Belief;
  score: number;
  estimatedTokens: number;
}

export interface ContextOptions {
  tokenBudget: number;
  sessionType: 'interactive' | 'headless' | 'project';
  projectName?: string;
}

export interface SearchOptions {
  limit?: number;
  minConfidence?: number;
  domain?: BeliefDomain;
  activeOnly?: boolean;
}

// Domain lifecycle configuration
export interface DomainLifecycle {
  ttlDays: number | null;        // null = no expiry
  decayRate: number;             // confidence decay per day
  decayAfterDays: number;        // when decay starts
  autoExpire: boolean;
  maxPerDomain: number;
}

export const DOMAIN_LIFECYCLES: Record<BeliefDomain, DomainLifecycle> = {
  handoff:     { ttlDays: 2,    decayRate: 0,     decayAfterDays: 0,  autoExpire: true,  maxPerDomain: 5 },
  watch:       { ttlDays: 7,    decayRate: 0.03,  decayAfterDays: 0,  autoExpire: true,  maxPerDomain: 30 },
  project:     { ttlDays: null, decayRate: 0.01,  decayAfterDays: 14, autoExpire: false, maxPerDomain: 50 },
  stakeholder: { ttlDays: null, decayRate: 0,     decayAfterDays: 0,  autoExpire: false, maxPerDomain: 30 },
  rule:        { ttlDays: null, decayRate: 0,     decayAfterDays: 0,  autoExpire: false, maxPerDomain: 50 },
  pattern:     { ttlDays: null, decayRate: 0.005, decayAfterDays: 30, autoExpire: false, maxPerDomain: 50 },
  infra:       { ttlDays: null, decayRate: 0.01,  decayAfterDays: 14, autoExpire: false, maxPerDomain: 50 },
  skill:       { ttlDays: null, decayRate: 0,     decayAfterDays: 0,  autoExpire: false, maxPerDomain: 30 },
};

export interface Config {
  dataDir: string;
}

export const DEFAULT_CONFIG: Config = {
  dataDir: '.memorai',
};
