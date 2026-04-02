#!/usr/bin/env bun

import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

import { ensureDataDir, loadConfig } from './utils/config.js';
import { getBeliefStore, getDatabase, closeDatabase } from './storage/belief-store.js';
import { autoDetectDomain } from './utils/scoring.js';
import type { BeliefDomain, BeliefType, Importance } from './types.js';
import { DOMAIN_LIFECYCLES } from './types.js';

const VALID_DOMAINS: BeliefDomain[] = ['handoff', 'watch', 'project', 'stakeholder', 'rule', 'pattern', 'infra', 'skill'];
const VALID_TYPES: BeliefType[] = ['directive', 'fact', 'handoff', 'watch', 'decision', 'pending'];

const program = new Command();

program
  .name('mem-reason')
  .description('memr v2 — Belief-based persistent memory for Claude Code')
  .version('2.0.0');

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize .memorai directory')
  .action(() => {
    const dataDir = ensureDataDir();
    getDatabase();
    console.log(`Initialized memory system in ${dataDir}`);
    closeDatabase();
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show belief stats')
  .action(() => {
    const config = loadConfig();

    if (!existsSync(join(config.dataDir, 'memory.db'))) {
      console.log('Memory system not initialized. Run `mem-reason init` first.');
      return;
    }

    const beliefStore = getBeliefStore();

    const beliefCount = beliefStore.count();
    const activeBeliefCount = beliefStore.count({ activeOnly: true });
    const domainStats = beliefStore.getStatsPerDomain();

    console.log(`Beliefs: ${activeBeliefCount} active / ${beliefCount} total`);

    if (Object.keys(domainStats).length > 0) {
      console.log('\nBeliefs by domain:');
      for (const [domain, stats] of Object.entries(domainStats)) {
        console.log(`  ${domain}: ${stats.count} (avg confidence: ${(stats.avgConfidence * 100).toFixed(0)}%)`);
      }
    }

    closeDatabase();
  });

// ── remember ──────────────────────────────────────────────────────────────────
program
  .command('remember <text>')
  .description('Quick belief add — auto-detects domain from content')
  .option('-d, --domain <domain>', 'Override auto-detected domain')
  .option('-t, --type <type>', 'Override auto-detected type')
  .option('-p, --project <name>', 'Associate with project')
  .option('-s, --stakeholder <name>', 'Associate with stakeholder')
  .option('--tags <tags>', 'Comma-separated tags')
  .action((text: string, options) => {
    const beliefStore = getBeliefStore();

    const domain = (options.domain as BeliefDomain) || autoDetectDomain(text);

    const belief = beliefStore.create({
      text,
      domain,
      belief_type: options.type as BeliefType | undefined,
      tags: options.tags ? options.tags.split(',') : undefined,
      project: options.project || undefined,
      stakeholder: options.stakeholder || undefined,
    });

    const shortId = belief.id.slice(0, 8);
    console.log(`Remembered: [${belief.domain}/${belief.belief_type}] ${shortId}`);
    closeDatabase();
  });

// ── check ─────────────────────────────────────────────────────────────────────
program
  .command('check <topic>')
  .description('Quick lookup — top 3 beliefs about a topic')
  .option('-l, --limit <n>', 'Max results', '3')
  .action((topic: string, options) => {
    const beliefStore = getBeliefStore();
    const limit = parseInt(options.limit, 10);

    const results = beliefStore.check(topic, limit);

    if (results.length === 0) {
      console.log(`(no beliefs about "${topic}")`);
    } else {
      for (const b of results) {
        console.log(`- [${b.domain}] ${b.text}`);
      }
    }

    closeDatabase();
  });

// ── handoff ───────────────────────────────────────────────────────────────────
program
  .command('handoff <text>')
  .description('Session handoff — auto-supersedes previous handoffs')
  .option('-n, --session <n>', 'Session number')
  .action((text: string, options) => {
    const beliefStore = getBeliefStore();
    const sessionNumber = options.session ? parseInt(options.session, 10) : undefined;

    // Count existing handoffs before creating new one (createHandoff auto-supersedes)
    const previousCount = beliefStore.getActive({ domain: 'handoff' as BeliefDomain }).length;

    const belief = beliefStore.createHandoff(text, sessionNumber);

    const shortId = belief.id.slice(0, 8);
    console.log(`Handoff saved: ${shortId} (${previousCount} previous handoffs superseded)`);
    closeDatabase();
  });

// ── curate ────────────────────────────────────────────────────────────────────
program
  .command('curate')
  .description('Auto-cleanup: decay, dedup, expire, cap')
  .option('--dry-run', 'Show what would change without modifying')
  .action((options) => {
    const beliefStore = getBeliefStore();
    const dryRun = !!options.dryRun;

    const stats = beliefStore.curate(dryRun);
    const resolved = (stats as any).resolved ?? 0;
    const total = stats.expired + stats.decayed + stats.merged + stats.capped + stats.invalidated + resolved;

    const prefix = dryRun ? '[DRY RUN] ' : '';
    console.log(`${prefix}Curate results:`);
    console.log(`  Expired:      ${stats.expired}`);
    console.log(`  Decayed:      ${stats.decayed}`);
    console.log(`  Merged:       ${stats.merged}`);
    console.log(`  Capped:       ${stats.capped}`);
    console.log(`  Invalidated:  ${stats.invalidated}`);
    console.log(`  Resolved:     ${resolved}`);
    console.log(`  Total:        ${total}`);

    closeDatabase();
  });

// ── orient ────────────────────────────────────────────────────────────────────
program
  .command('orient')
  .description('Compact session-start context')
  .action(() => {
    const beliefStore = getBeliefStore();

    const output = beliefStore.orient();
    console.log(output);

    closeDatabase();
  });

// ── verify ────────────────────────────────────────────────────────────────────
program
  .command('verify <id>')
  .description('Mark a watch belief as verified')
  .action((id: string) => {
    const beliefStore = getBeliefStore();
    const belief = beliefStore.getById(id);

    if (!belief) {
      console.log(`Belief not found: ${id}`);
      closeDatabase();
      return;
    }

    const newConf = Math.min(1.0, belief.confidence + 0.1);
    const updated = beliefStore.update(id, {
      confidence: newConf,
      last_evaluated: Date.now(),
    });

    if (updated) {
      console.log(`Verified: ${id}`);
      console.log(`  Confidence: ${(updated.confidence * 100).toFixed(0)}%`);
    }

    closeDatabase();
  });

// ── add-belief ────────────────────────────────────────────────────────────────
program
  .command('add-belief')
  .description('Add a belief with explicit control over all fields')
  .requiredOption('-t, --text <text>', 'Belief text')
  .requiredOption('-d, --domain <domain>', `Domain: ${VALID_DOMAINS.join(', ')}`)
  .option('-c, --confidence <n>', 'Confidence 0-1', '0.7')
  .option('-i, --importance <n>', 'Importance 1-5', '3')
  .option('--type <type>', `Belief type: ${VALID_TYPES.join(', ')}`)
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-p, --project <name>', 'Project name')
  .option('-s, --stakeholder <name>', 'Stakeholder name')
  .action((options) => {
    const beliefStore = getBeliefStore();

    const belief = beliefStore.create({
      text: options.text,
      domain: options.domain as BeliefDomain,
      belief_type: options.type as BeliefType | undefined,
      confidence: parseFloat(options.confidence),
      importance: parseInt(options.importance, 10) as Importance,
      tags: options.tags ? options.tags.split(',') : [],
      project: options.project || undefined,
      stakeholder: options.stakeholder || undefined,
    });

    console.log(`Added belief: ${belief.id}`);
    console.log(`  "${belief.text}"`);
    closeDatabase();
  });

// ── search ────────────────────────────────────────────────────────────────────
program
  .command('search <query>')
  .description('Search beliefs')
  .option('-l, --limit <n>', 'Max results', '10')
  .option('-d, --domain <domain>', 'Filter by domain')
  .action((query: string, options) => {
    const beliefStore = getBeliefStore();
    const limit = parseInt(options.limit, 10);

    const beliefs = beliefStore.search(query, {
      limit,
      domain: options.domain as BeliefDomain | undefined,
      activeOnly: true,
    });

    if (beliefs.length === 0) {
      console.log('(no matching beliefs)');
    } else {
      for (const b of beliefs) {
        console.log(`[${b.domain}] (${(b.confidence * 100).toFixed(0)}%) ${b.text}`);
        console.log(`  ID: ${b.id}`);
      }
    }

    closeDatabase();
  });

// ── beliefs ───────────────────────────────────────────────────────────────────
program
  .command('beliefs')
  .description('List active beliefs')
  .option('-d, --domain <domain>', 'Filter by domain')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const beliefStore = getBeliefStore();

    const beliefs = beliefStore.getActive({
      domain: options.domain as BeliefDomain | undefined,
      limit: parseInt(options.limit, 10),
    });

    if (options.json) {
      console.log(JSON.stringify(beliefs, null, 2));
    } else if (beliefs.length === 0) {
      console.log('No active beliefs.');
    } else {
      const byDomain: Record<string, typeof beliefs> = {};
      for (const b of beliefs) {
        if (!byDomain[b.domain]) byDomain[b.domain] = [];
        byDomain[b.domain].push(b);
      }

      for (const [domain, domainBeliefs] of Object.entries(byDomain)) {
        console.log(`\n=== ${domain.toUpperCase()} ===`);
        for (const b of domainBeliefs) {
          const typeTag = b.belief_type ? `/${b.belief_type}` : '';
          console.log(`[${(b.confidence * 100).toFixed(0)}%] ${b.text} (${domain}${typeTag})`);
          console.log(`  ID: ${b.id}`);
        }
      }
    }

    closeDatabase();
  });

// ── update-belief ─────────────────────────────────────────────────────────────
program
  .command('update-belief <id>')
  .description('Update a belief')
  .option('-c, --confidence <n>', 'New confidence 0-1')
  .option('-i, --importance <n>', 'New importance 1-5')
  .action((id: string, options) => {
    const beliefStore = getBeliefStore();

    const changes: Record<string, number> = {};
    if (options.confidence) changes.confidence = parseFloat(options.confidence);
    if (options.importance) changes.importance = parseInt(options.importance, 10);
    changes.last_evaluated = Date.now();

    const updated = beliefStore.update(id, changes);

    if (updated) {
      console.log(`Updated belief: ${id}`);
      console.log(`  Confidence: ${(updated.confidence * 100).toFixed(0)}%`);
    } else {
      console.log(`Belief not found: ${id}`);
    }

    closeDatabase();
  });

// ── invalidate ────────────────────────────────────────────────────────────────
program
  .command('invalidate <id>')
  .description('Invalidate a belief')
  .requiredOption('-r, --reason <text>', 'Reason for invalidation')
  .action((id: string, options) => {
    const beliefStore = getBeliefStore();

    const success = beliefStore.invalidate(id, options.reason);

    if (success) {
      console.log(`Invalidated belief: ${id}`);
    } else {
      console.log(`Belief not found or already invalidated: ${id}`);
    }

    closeDatabase();
  });

// ── context ───────────────────────────────────────────────────────────────────
program
  .command('context')
  .description('Full memory context for injection')
  .option('-l, --limit <n>', 'Token budget', '8000')
  .action((options) => {
    const beliefStore = getBeliefStore();
    const tokenBudget = parseInt(options.limit, 10);

    const scored = beliefStore.getContextBeliefs({
      tokenBudget,
      sessionType: 'interactive',
    });

    if (scored.length === 0) {
      console.log('(no stored beliefs yet)');
      closeDatabase();
      return;
    }

    const beliefs = scored.map((s) => s.belief);
    const usedTokens = scored.reduce((sum, s) => sum + s.estimatedTokens, 0);

    console.log('## Memory Context\n');
    const byDomain: Record<string, typeof beliefs> = {};
    for (const b of beliefs) {
      if (!byDomain[b.domain]) byDomain[b.domain] = [];
      byDomain[b.domain].push(b);
    }

    for (const [domain, domainBeliefs] of Object.entries(byDomain)) {
      console.log(`### ${domain}`);
      for (const b of domainBeliefs) {
        console.log(`- ${b.text}`);
      }
      console.log('');
    }

    console.log(`[${beliefs.length} beliefs / ~${usedTokens} tokens]`);

    closeDatabase();
  });

// ── import-memories ──────────────────────────────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      meta[key.trim()] = rest.join(':').trim();
    }
  }
  return { meta, body: match[2].trim() };
}

function memoryTypeToDomain(type: string): BeliefDomain {
  switch (type) {
    case 'feedback': return 'rule';
    case 'user': return 'rule';
    case 'project': return 'project';
    case 'reference': return 'infra';
    default: return 'project';
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
    .replace(/\*([^*]+)\*/g, '$1')      // italic
    .replace(/`([^`]+)`/g, '$1')        // inline code
    .replace(/```[\s\S]*?```/g, '')     // code blocks
    .replace(/^\s*[-*]\s+/gm, '- ')    // normalize list markers
    .replace(/\n{3,}/g, '\n\n')        // collapse blank lines
    .trim();
}

function extractBeliefText(body: string, description: string): string {
  const cleaned = stripMarkdown(body);
  if (!cleaned) return description.slice(0, 500);

  // If body has Why/How sections, preserve them compactly
  const whyMatch = cleaned.match(/Why:([\s\S]*?)(?=How to apply:|$)/i);
  const howMatch = cleaned.match(/How to apply:([\s\S]*?)$/i);

  if (whyMatch && howMatch) {
    const core = cleaned.split(/\n*Why:/i)[0].trim();
    const why = whyMatch[1].trim();
    const how = howMatch[1].trim();
    const compact = `${core} | Why: ${why} | How: ${how}`;
    if (compact.length <= 500) return compact;
    // Fall through to truncation
  }

  // Take first paragraph or up to 400 chars
  const paragraphs = cleaned.split(/\n\n/);
  let result = paragraphs[0];

  // Add more paragraphs if room
  for (let i = 1; i < paragraphs.length; i++) {
    const candidate = result + ' ' + paragraphs[i];
    if (candidate.length > 400) break;
    result = candidate;
  }

  if (result.length > 500) {
    result = result.slice(0, 497) + '...';
  }

  return result;
}

program
  .command('import-memories <dir>')
  .description('Import auto-memory .md files into memr beliefs')
  .option('--dry-run', 'Show what would be imported without modifying')
  .option('--force', 'Import even if duplicates detected')
  .action((dir: string, options) => {
    const resolvedDir = dir.startsWith('/') ? dir : join(process.cwd(), dir);

    if (!existsSync(resolvedDir)) {
      console.error(`Directory not found: ${resolvedDir}`);
      process.exit(1);
    }

    const files = readdirSync(resolvedDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    if (files.length === 0) {
      console.log('No .md files found (excluding MEMORY.md).');
      return;
    }

    const dryRun = !!options.dryRun;
    const force = !!options.force;

    if (!dryRun) {
      // Ensure DB is initialized
      const config = loadConfig();
      if (!existsSync(join(config.dataDir, 'memory.db'))) {
        console.error('Memory system not initialized. Run `mem-reason init` first.');
        process.exit(1);
      }
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    const beliefStore = dryRun ? null : getBeliefStore();

    for (const file of files) {
      const filePath = join(resolvedDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(content);

        const name = meta.name || basename(file, '.md');
        const description = meta.description || '';
        const type = meta.type || 'project';
        const domain = memoryTypeToDomain(type);

        const beliefText = extractBeliefText(body, description);

        if (!beliefText) {
          console.log(`  SKIP (empty): ${file}`);
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`  [${domain}] ${file} → "${beliefText.slice(0, 80)}${beliefText.length > 80 ? '...' : ''}"`);
          imported++;
          continue;
        }

        // Check for existing duplicate before creating
        if (!force) {
          const existing = beliefStore!.findDuplicate(beliefText, domain, 0.7);
          if (existing) {
            console.log(`  SKIP (duplicate): ${file} → matches ${existing.id.slice(0, 8)}`);
            skipped++;
            continue;
          }
        }

        const belief = beliefStore!.create({
          text: beliefText,
          domain,
          tags: ['imported', `source:${basename(file, '.md')}`],
        });

        console.log(`  OK: ${file} → [${belief.domain}/${belief.belief_type}] ${belief.id.slice(0, 8)}`);
        imported++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${file} → ${msg}`);
        errors++;
      }
    }

    const prefix = dryRun ? '[DRY RUN] ' : '';
    console.log(`\n${prefix}Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors (from ${files.length} files)`);

    if (!dryRun) closeDatabase();
  });

// ── setup ───────────────────────────────────────────────────────────────────
function getEmbeddedHook(): string {
  const lines = [
    '#!/usr/bin/env bash',
    '# memr SessionStart hook — generic, project-agnostic',
    '# Provides belief context and active recall protocol at session start.',
    '# Install: mem-reason setup  (auto-registers this hook)',
    '',
    'set -euo pipefail',
    '',
    '# ── Curate beliefs silently (non-blocking) ────────────────────────────────────',
    'mem-reason curate >/dev/null 2>&1 &',
    '',
    '# ── Orient: get compact belief context ────────────────────────────────────────',
    'orient_output=""',
    'if command -v mem-reason >/dev/null 2>&1; then',
    '  orient_output=$(mem-reason orient 2>/dev/null || true)',
    'fi',
    '',
    '# ── Build context block ──────────────────────────────────────────────────────',
    "read -r -d '' CONTEXT_BLOCK << 'MEMR_EOF' || true",
    '## Active Recall Protocol',
    '',
    'You have a persistent belief store via `mem-reason`. Use it throughout this session:',
    '',
    '### Retrieve before acting',
    '- Before starting any task, run `mem-reason check "<topic>"` to recall relevant beliefs.',
    '- At session start, review `mem-reason orient` output (included below) for current context.',
    '',
    '### Store before ending',
    '- Before this session ends, encode any new lessons, decisions, or handoffs:',
    '  - `mem-reason remember "<lesson>"` for quick storage',
    '  - `mem-reason handoff "<state>"` for session continuity',
    '- If something broke and you fixed it, store the lesson as a belief.',
    '',
    '### Commands reference',
    '- `mem-reason check <topic>` — quick lookup (top 3)',
    '- `mem-reason remember <text>` — store a new belief',
    '- `mem-reason handoff <text>` — session handoff (auto-supersedes previous)',
    '- `mem-reason search <query>` — full-text search',
    '- `mem-reason beliefs` — list all active beliefs',
    '- `mem-reason curate` — auto-cleanup (decay, dedup, expire)',
    'MEMR_EOF',
    '',
    '# Append orient output if non-empty',
    'if [ -n "$orient_output" ]; then',
    '  CONTEXT_BLOCK="${CONTEXT_BLOCK}',
    '',
    '## Current Belief Context',
    '$orient_output"',
    'fi',
    '',
    '# ── Output as Claude Code hook JSON ──────────────────────────────────────────',
    'if command -v jq >/dev/null 2>&1; then',
    "  jq -n --arg ctx \"$CONTEXT_BLOCK\" '{",
    '    hookSpecificOutput: {',
    '      hookEventName: "SessionStart",',
    '      additionalContext: $ctx',
    '    }',
    "  }'",
    'else',
    '  # Manual JSON escaping fallback',
    "  escaped=$(printf '%s' \"$CONTEXT_BLOCK\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g; s/\\t/\\\\t/g' | awk '{printf \"%s\\\\n\", $0}' | sed 's/\\\\n$//')",
    '  printf \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\\n\' "$escaped"',
    'fi',
  ];
  return lines.join('\n') + '\n';
}

program
  .command('setup')
  .description('Set up memr in current project — init beliefs, install SessionStart hook')
  .action(() => {
    const projectDir = process.cwd();

    // Step 1: Initialize .memorai/
    console.log('1. Initializing .memorai/ ...');
    const dataDir = ensureDataDir(projectDir);
    getDatabase();
    closeDatabase();
    console.log(`   Created: ${dataDir}`);

    // Step 2: Create .claude/hooks/ directory
    const hooksDir = join(projectDir, '.claude', 'hooks');
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // Step 3: Write the hook file from embedded content
    const hookPath = join(hooksDir, 'memr-session-start.sh');
    console.log('2. Writing hook: .claude/hooks/memr-session-start.sh ...');
    writeFileSync(hookPath, getEmbeddedHook(), { mode: 0o755 });
    console.log(`   Created: ${hookPath}`);

    // Step 4: Create or update .claude/settings.json
    const settingsPath = join(projectDir, '.claude', 'settings.json');
    console.log('3. Configuring .claude/settings.json ...');

    const memrHookEntry = {
      hooks: [
        {
          type: 'command',
          command: 'bash .claude/hooks/memr-session-start.sh',
        },
      ],
    };

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        // If settings.json exists but is invalid JSON, start fresh
        settings = {};
      }
    }

    // Ensure hooks.SessionStart exists as an array
    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown[]>;
    if (!Array.isArray(hooks.SessionStart)) {
      hooks.SessionStart = [];
    }

    // Check if memr hook is already registered (avoid duplicates)
    const alreadyRegistered = hooks.SessionStart.some((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      if (!Array.isArray(e.hooks)) return false;
      return e.hooks.some((h: unknown) => {
        if (typeof h !== 'object' || h === null) return false;
        const hObj = h as Record<string, unknown>;
        return hObj.type === 'command' && typeof hObj.command === 'string' &&
          (hObj.command as string).includes('memr-session-start.sh');
      });
    });

    if (alreadyRegistered) {
      console.log('   Hook already registered (skipped duplicate).');
    } else {
      hooks.SessionStart.push(memrHookEntry);
      console.log('   Registered SessionStart hook.');
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`   Updated: ${settingsPath}`);

    // Summary
    console.log('\n--- memr setup complete ---');
    console.log(`Project: ${projectDir}`);
    console.log('Verify with:');
    console.log('  cat .claude/settings.json');
    console.log('  bash .claude/hooks/memr-session-start.sh | jq .');
    console.log('  mem-reason status');
  });

program.parse();
