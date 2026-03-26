import type { Belief, BeliefDomain, DOMAIN_LIFECYCLES } from '../types.js';
import { areContradictory } from './scoring.js';
// Note: This file exports pure functions. The BeliefStore calls them.

// Apply time-based confidence decay to a belief
export function computeDecay(belief: Belief, lifecycle: typeof DOMAIN_LIFECYCLES[BeliefDomain]): number {
  if (lifecycle.decayRate === 0) return belief.confidence;

  const ageDays = (Date.now() - belief.derived_at) / 86400000;
  if (ageDays <= lifecycle.decayAfterDays) return belief.confidence;

  const decayDays = ageDays - lifecycle.decayAfterDays;
  const decayed = belief.confidence - (lifecycle.decayRate * decayDays);
  return Math.max(0, Math.min(1, decayed));
}

// Check if a belief has expired
export function isExpired(belief: Belief): boolean {
  if (belief.expires_at && Date.now() > belief.expires_at) return true;
  return false;
}

// Check if a watch belief needs verification
export function needsVerification(belief: Belief): boolean {
  if (belief.belief_type !== 'watch') return false;
  if (belief.verify_by && Date.now() > belief.verify_by) return true;
  return false;
}

// Determine if a "fixed" belief should be promoted to watch
export function shouldPromoteToWatch(belief: Belief): boolean {
  if (belief.domain === 'watch') return false; // already a watch
  const ageDays = (Date.now() - belief.derived_at) / 86400000;
  // If text mentions "fixed" and is 3+ days old, promote to watch
  if (ageDays >= 3 && /\bfixed\b/i.test(belief.text)) return true;
  return false;
}

// Detect contradictions among a set of beliefs
export function detectContradictions(beliefs: Belief[]): Array<[Belief, Belief]> {
  const pairs: Array<[Belief, Belief]> = [];
  for (let i = 0; i < beliefs.length; i++) {
    for (let j = i + 1; j < beliefs.length; j++) {
      if (areContradictory(beliefs[i].text, beliefs[j].text)) {
        pairs.push([beliefs[i], beliefs[j]]);
      }
    }
  }
  return pairs;
}

// Format beliefs for orient output (compact, sectioned)
export function formatOrientOutput(beliefs: Belief[], totalStored: number): string {
  const sections: Record<string, string[]> = {
    'RESUME FROM LAST SESSION': [],
    'HARD CONSTRAINTS (never violate)': [],
    'PENDING DELIVERABLES': [],
    'REGRESSION WATCH': [],
    'SYSTEM KNOWLEDGE': [],
  };

  for (const b of beliefs) {
    const tag = `[${b.domain}]`;
    const line = `- ${tag} ${b.text}`;

    if (b.belief_type === 'handoff') {
      sections['RESUME FROM LAST SESSION'].push(line);
    } else if (b.belief_type === 'directive' || b.domain === 'rule') {
      sections['HARD CONSTRAINTS (never violate)'].push(line);
    } else if (b.belief_type === 'pending') {
      sections['PENDING DELIVERABLES'].push(line);
    } else if (b.belief_type === 'watch' || b.domain === 'watch') {
      sections['REGRESSION WATCH'].push(line);
    } else {
      sections['SYSTEM KNOWLEDGE'].push(line);
    }
  }

  const lines: string[] = [];
  for (const [title, items] of Object.entries(sections)) {
    if (items.length === 0) continue;
    lines.push(`## ${title}`);
    lines.push(...items);
    lines.push('');
  }

  // Detect and display contradictions
  const contradictions = detectContradictions(beliefs);
  if (contradictions.length > 0) {
    lines.push('## CONFLICTS (resolve these)');
    for (const [a, b] of contradictions) {
      const aText = a.text.length > 80 ? a.text.slice(0, 80) + '...' : a.text;
      const bText = b.text.length > 80 ? b.text.slice(0, 80) + '...' : b.text;
      lines.push(`- CONFLICT: "${aText}" vs "${bText}"`);
      lines.push(`  IDs: ${a.id.slice(0, 8)} vs ${b.id.slice(0, 8)}`);
    }
    lines.push('');
  }

  const tokenEstimate = beliefs.reduce((sum, b) => sum + Math.ceil(b.text.length / 4) + 15, 0);
  lines.push(`[${beliefs.length} beliefs loaded / ${totalStored} stored / ~${tokenEstimate} tokens used]`);
  lines.push('Use `mem-reason check "<topic>"` to query specific knowledge.');

  return lines.join('\n');
}
