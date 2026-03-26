import type { Belief, BeliefType, BeliefDomain, Importance, ContextOptions } from '../types.js';

// Auto-detect domain from text content
export function autoDetectDomain(text: string): BeliefDomain {
  if (/\b(NEVER|ALWAYS|MUST|CRITICAL|rule|mandate)\b/i.test(text)) return 'rule';
  if (/\b(HANDOFF|NEXT|resume|session\s+\d+)\b/i.test(text)) return 'handoff';
  if (/\b(verify|regress|watch|fragile|broke\s+again|still\s+works)\b/i.test(text)) return 'watch';
  if (/\b(port|service|nginx|systemd|VPS|server|SSL|DNS)\b/i.test(text)) return 'infra';
  if (/\b(deploy|pipeline|workflow|pattern|architecture)\b/i.test(text)) return 'pattern';
  if (/\b(waiting|asked|request|stakeholder|deliverable)\b/i.test(text)) return 'stakeholder';
  if (/\b(skill|command|tool|hook|plugin)\b/i.test(text)) return 'skill';
  return 'project'; // safe default
}

// Auto-detect belief type from text + domain
export function autoDetectType(text: string, domain: BeliefDomain): BeliefType {
  if (domain === 'handoff') return 'handoff';
  if (domain === 'watch') return 'watch';
  if (/\b(NEVER|ALWAYS|MUST|DO NOT|rule)\b/i.test(text)) return 'directive';
  if (/\b(waiting|pending|needs|asked for)\b/i.test(text)) return 'pending';
  if (/\b(decided|chose|because|rationale)\b/i.test(text)) return 'decision';
  return 'fact';
}

// Compute importance algorithmically
export function computeImportance(belief: { domain: BeliefDomain; belief_type: BeliefType; text: string; tags: string[] }): Importance {
  // Domain-based base importance
  const domainWeights: Record<BeliefDomain, number> = {
    rule: 5, handoff: 5, watch: 4, stakeholder: 4,
    infra: 3, project: 3, pattern: 3, skill: 2,
  };
  let score = domainWeights[belief.domain];

  // Type modifiers
  if (belief.belief_type === 'directive') score = Math.max(score, 4);
  if (belief.belief_type === 'pending') score = Math.max(score, 4);

  // Text signals
  if (/\bCRITICAL\b/i.test(belief.text)) score = 5;
  if (/\bNEVER\b/i.test(belief.text)) score = Math.max(score, 4);

  return Math.min(5, Math.max(1, score)) as Importance;
}

// Score a belief for context loading (higher = more likely to be included)
export function computeContextScore(belief: Belief, options: ContextOptions): number {
  let score = 0;

  // Category weight (primary factor)
  const typeWeights: Record<BeliefType, number> = {
    handoff: 100,
    pending: 80,
    watch: 70,
    directive: 60,
    fact: 40,
    decision: 20,
  };
  score += typeWeights[belief.belief_type];

  // Recency boost
  const ageHours = (Date.now() - belief.derived_at) / 3600000;
  if (ageHours < 24) score += 20;
  else if (ageHours < 168) score += 10;

  // Importance as tiebreaker (0-10 range)
  score += belief.importance * 2;

  // Confidence as tiebreaker (0-10 range)
  score += belief.confidence * 10;

  // Staleness penalty
  const evalAgeDays = (Date.now() - belief.last_evaluated) / 86400000;
  if (evalAgeDays > 7) score -= 10;
  if (evalAgeDays > 30) score -= 20;

  // Project boost for project sessions
  if (options.projectName && belief.project === options.projectName) {
    score += 25;
  }

  return score;
}

// Synonym groups — bidirectional associations for query expansion
const SYNONYM_GROUPS: string[][] = [
  ['database', 'db', 'sqlite', 'postgresql', 'postgres', 'mysql', 'mariadb', 'sql', 'migration'],
  ['auth', 'authentication', 'login', 'jwt', 'token', 'bcrypt', 'password', 'session', 'credential'],
  ['deploy', 'deployment', 'ship', 'release', 'publish', 'production', 'staging'],
  ['test', 'testing', 'spec', 'assertion', 'expect', 'jest', 'vitest'],
  ['error', 'exception', 'crash', 'bug', 'failure', 'broken', 'fix'],
  ['api', 'endpoint', 'route', 'handler', 'rest', 'graphql', 'http'],
  ['frontend', 'ui', 'react', 'vue', 'component', 'css', 'html', 'browser'],
  ['backend', 'server', 'express', 'fastify', 'node', 'bun', 'runtime'],
  ['docker', 'container', 'image', 'kubernetes', 'k8s', 'pod'],
  ['git', 'commit', 'branch', 'merge', 'rebase', 'push', 'pull'],
  ['config', 'configuration', 'env', 'environment', 'settings', 'dotenv'],
  ['cache', 'redis', 'memcached', 'caching'],
  ['queue', 'worker', 'job', 'background', 'async', 'rabbitmq', 'bull'],
  ['monitor', 'monitoring', 'log', 'logging', 'metric', 'alert', 'observability'],
  ['security', 'vulnerability', 'xss', 'injection', 'csrf', 'cors'],
  ['id', 'uuid', 'identifier', 'primary key', 'sequential', 'auto-increment', 'autoincrement'],
  ['priority', 'urgent', 'critical', 'high', 'low', 'medium'],
  ['user', 'account', 'profile', 'role', 'permission'],
  ['file', 'upload', 'download', 'storage', 'blob', 's3'],
  ['email', 'mail', 'smtp', 'notification', 'message'],
  ['port', 'listen', 'bind', 'host', 'address'],
  ['nginx', 'proxy', 'reverse proxy', 'load balancer', 'ssl', 'tls', 'https'],
  ['service', 'systemd', 'daemon', 'process', 'pid'],
  ['stakeholder', 'client', 'customer', 'requester', 'user request'],
];

export function expandQuery(query: string): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = new Set<string>(terms);

  for (const term of terms) {
    for (const group of SYNONYM_GROUPS) {
      if (matchesSynonymGroup(term, group)) {
        for (const syn of group) {
          expanded.add(syn);
        }
      }
    }
  }

  return [...expanded];
}

// Simple stem: strip common suffixes to normalize plurals and verb forms
function simpleStem(word: string): string {
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('tion') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// Check if a word belongs to a synonym group via exact match or stem match
function matchesSynonymGroup(word: string, group: string[]): boolean {
  const stemmed = simpleStem(word);
  return group.some(syn => {
    if (syn === word) return true;
    const synStemmed = simpleStem(syn);
    // Allow stem matches (e.g. "tests" stem "test" matches "test")
    // but NOT compound word matches (e.g. "asynchandler" must NOT match "handler")
    if (stemmed === synStemmed) return true;
    if (stemmed === syn || word === synStemmed) return true;
    return false;
  });
}

// Check if a word from one text has a whole-word or synonym match in another text
function wordMatchesInText(word: string, text: string): boolean {
  // Use word-boundary matching to avoid "add" matching inside "added"
  const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (wordRegex.test(text)) return true;
  // Check if any synonym of this word appears in the text (whole-word)
  // Uses stem matching to handle plurals/verb forms but NOT substring matching
  for (const group of SYNONYM_GROUPS) {
    if (matchesSynonymGroup(word, group)) {
      // This word belongs to this synonym group -- check if any group member appears in text
      for (const syn of group) {
        if (syn.length > 2) {
          const synRegex = new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          if (synRegex.test(text)) return true;
        }
      }
    }
  }
  return false;
}

// Detect if two belief texts contradict each other
export function areContradictory(textA: string, textB: string): boolean {
  const a = textA.toLowerCase();
  const b = textB.toLowerCase();

  // Helper: check if forbidden subject appears in text (exact match or word-level overlap)
  function forbiddenMatchesText(forbidden: string, text: string, negWords: string[]): boolean {
    if (negWords.some(nw => text.includes(nw))) return false;
    // First try exact substring
    if (text.includes(forbidden)) return true;
    // Fallback: word-level overlap with synonym awareness
    // The FIRST significant word is treated as the primary identifier (e.g. "asyncHandler" in "asyncHandler middleware")
    // For short subjects (1-2 words), the primary word MUST match
    // For longer subjects (3+ words), require >= 50% match
    const forbiddenWords = forbidden.split(/\s+/).filter(w => w.length > 2);
    if (forbiddenWords.length > 0) {
      const matchCount = forbiddenWords.filter(w => wordMatchesInText(w, text)).length;
      const primaryMatches = forbiddenWords.length > 0 && wordMatchesInText(forbiddenWords[0], text);
      if (forbiddenWords.length <= 2) {
        // For short subjects: primary word must match
        if (primaryMatches) return true;
      } else {
        if (matchCount / forbiddenWords.length >= 0.5) return true;
      }
    }
    return false;
  }

  // Pattern 1: Negation opposition
  // "NEVER use X" vs "uses X" or "use X"
  const neverMatch = a.match(/\bnever\s+(?:use|do|send|store|run|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (neverMatch) {
    const forbidden = neverMatch[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, b, ['never', 'do not', "don't"])) {
      return true;
    }
  }

  // Check reverse direction
  const neverMatchB = b.match(/\bnever\s+(?:use|do|send|store|run|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (neverMatchB) {
    const forbidden = neverMatchB[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, a, ['never', 'do not', "don't"])) {
      return true;
    }
  }

  // Pattern 2: "Do NOT X" vs "X" / "should X"
  const doNotMatch = a.match(/\b(?:do not|don't|should not|must not)\s+(?:use|do|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (doNotMatch) {
    const forbidden = doNotMatch[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, b, ['not', 'never', "don't"])) {
      return true;
    }
  }

  // Check reverse
  const doNotMatchB = b.match(/\b(?:do not|don't|should not|must not)\s+(?:use|do|add|create|make)\s+(.+?)(?:\s*[-\u2014.]|$)/i);
  if (doNotMatchB) {
    const forbidden = doNotMatchB[1].trim().toLowerCase();
    if (forbidden.length > 2 && forbiddenMatchesText(forbidden, a, ['not', 'never', "don't"])) {
      return true;
    }
  }

  // Pattern 3: Status contradiction — "pending" vs "shipped/completed/done"
  const pendingA = /\b(?:pending|waiting|requested|needs)\b/i.test(a);
  const doneA = /\b(?:shipped|completed|done|delivered|implemented|finished)\b/i.test(a);
  const pendingB = /\b(?:pending|waiting|requested|needs)\b/i.test(b);
  const doneB = /\b(?:shipped|completed|done|delivered|implemented|finished)\b/i.test(b);

  if ((pendingA && doneB) || (doneA && pendingB)) {
    // Only flag if they're about the same subject (>30% word overlap)
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
    const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
    const minSize = Math.min(wordsA.size, wordsB.size);
    if (minSize > 0 && overlap / minSize > 0.3) {
      return true;
    }
  }

  // Pattern 4: "has no X" / "no X" / "lacks X" / "without X" vs affirmative
  function extractNegatedSubject(text: string): string | null {
    const match = text.match(/\b(?:has no|have no|no|lacks?|without)\s+(.+?)(?:\s*[.!,;:\u2014-]|$)/i);
    return match ? match[1].trim().toLowerCase() : null;
  }

  const negA = extractNegatedSubject(a);
  if (negA) {
    const subjectWords = negA.split(/\s+/).filter(w => w.length > 2);
    const matchCount = subjectWords.filter(w => wordMatchesInText(w, b)).length;
    if (subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5 &&
        !b.includes('no ') && !b.includes('not ') && !b.includes('lacks') && !b.includes('without')) {
      return true;
    }
  }
  const negB = extractNegatedSubject(b);
  if (negB) {
    const subjectWords = negB.split(/\s+/).filter(w => w.length > 2);
    const matchCount = subjectWords.filter(w => wordMatchesInText(w, a)).length;
    if (subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5 &&
        !a.includes('no ') && !a.includes('not ') && !a.includes('lacks') && !a.includes('without')) {
      return true;
    }
  }

  // Pattern 5: "not yet X" / "not implemented" vs "X implemented/done/shipped"
  // Exclude "do not/should not/must not + verb" (handled by Pattern 2) via negative lookbehind
  const p5Regex = /(?<!\b(?:do|should|must|can|will|would|could|shall))\s+not\s+(?:yet\s+)?(.+?)(?:\s*[.!,;:\u2014-]|$)/i;
  const notYetA = a.match(p5Regex);
  if (notYetA) {
    const subject = notYetA[1].trim().toLowerCase();
    // Skip if subject starts with a bare verb (add, use, make, etc.) — that's Pattern 2 territory
    if (!/^(?:add|use|do|create|make|send|store|run)\b/.test(subject)) {
      const subjectWords = subject.split(/\s+/).filter(w => w.length > 2);
      const hasAffirmB = /\b(?:implemented|done|shipped|completed|finished|added|exists|deployed)\b/i.test(b);
      const matchCount = subjectWords.filter(w => wordMatchesInText(w, b)).length;
      if (hasAffirmB && subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5) {
        return true;
      }
    }
  }
  const notYetB = b.match(p5Regex);
  if (notYetB) {
    const subject = notYetB[1].trim().toLowerCase();
    if (!/^(?:add|use|do|create|make|send|store|run)\b/.test(subject)) {
      const subjectWords = subject.split(/\s+/).filter(w => w.length > 2);
      const hasAffirmA = /\b(?:implemented|done|shipped|completed|finished|added|exists|deployed)\b/i.test(a);
      const matchCount = subjectWords.filter(w => wordMatchesInText(w, a)).length;
      if (hasAffirmA && subjectWords.length > 0 && matchCount / subjectWords.length >= 0.5) {
        return true;
      }
    }
  }

  // Pattern 6: Direct affirmation vs negation with shared subject (general catch-all)
  // If texts share >40% significant words AND one has negation while the other doesn't
  // Uses DIRECT word matching only (no synonym expansion) to avoid false positives
  // from synonym groups that connect unrelated tools (e.g. bun <-> express)
  const hasNegationA = /\b(?:no|not|never|lacks?|without|don't|doesn't|hasn't|haven't)\b/i.test(a);
  const hasNegationB = /\b(?:no|not|never|lacks?|without|don't|doesn't|hasn't|haven't)\b/i.test(b);
  if (hasNegationA !== hasNegationB) {
    const sigWords = (s: string) => {
      const words = s.replace(/[^\w\s-]/g, '').split(/\s+/).filter(Boolean);
      const stopList = new Set(['the','a','an','is','are','was','were','be','been','has','have','had','do','does','did','will','would','could','should','may','might','can','need','must','on','in','at','to','for','of','with','by','from','as','and','but','or','nor','not','so','yet','no','this','that','it','its','never','lacks','without','don\'t','doesn\'t','hasn\'t','haven\'t','use','uses','used','using','under','load','break','test','tested','testing','work','works','working','also','just','like','make','new','old','all','any','some','each','every','watch','rule','added','done','still']);
      return words.filter(w => !stopList.has(w) && w.length > 2);
    };
    const wordsA = sigWords(a);
    const wordsB = sigWords(b);
    const setBWords = new Set(wordsB);
    // Direct word matching only — no synonym expansion to avoid cross-tool false positives
    const overlap = wordsA.filter(w => setBWords.has(w)).length;
    const minLen = Math.min(wordsA.length, wordsB.length);
    // Require at least 2 overlapping significant words to avoid false positives
    // from single shared generic terms like "middleware" or "server"
    if (minLen > 0 && overlap >= 2 && overlap / minLen >= 0.4) {
      return true;
    }
  }

  return false;
}

// Stop words stripped before Jaccard comparison — these inflate union without semantic value
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'on', 'in', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'into', 'about', 'between', 'through', 'during', 'before', 'after',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'this', 'that', 'these', 'those', 'it', 'its',
]);

// Jaccard similarity on tokenized words (stop words stripped for belief-length text)
export function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => {
    const words = s.toLowerCase().replace(/[^\w\s-]/g, '').split(/\s+/).filter(Boolean);
    return new Set(words.filter(w => !STOP_WORDS.has(w) && w.length > 1));
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}
