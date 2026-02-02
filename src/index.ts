#!/usr/bin/env bun

import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';

import { ensureDataDir, loadConfig } from './utils/config.js';
import { getDatabase, closeDatabase } from './storage/sqlite.js';
import { getEventStore } from './storage/event-store.js';
import { getBeliefStore } from './storage/belief-store.js';
import { getSessionStore } from './storage/session-store.js';
import { buildInferencePrompt, formatBeliefsForPrompt, formatEventsForPrompt } from './reasoning/prompts.js';
import type { BeliefDomain, EventType } from './types.js';

const program = new Command();

program
  .name('mem-reason')
  .description('Memory-as-Reasoning: Dynamic belief system for Claude Code')
  .version('0.1.0');

// Initialize command
program
  .command('init')
  .description('Initialize memory system in current directory')
  .action(() => {
    const dataDir = ensureDataDir();
    getDatabase();
    console.log(`Initialized memory system in ${dataDir}`);
    closeDatabase();
  });

// Status command
program
  .command('status')
  .description('Show memory system status')
  .action(() => {
    const config = loadConfig();

    if (!existsSync(join(config.dataDir, 'memory.db'))) {
      console.log('Memory system not initialized. Run `mem-reason init` first.');
      return;
    }

    const eventStore = getEventStore();
    const beliefStore = getBeliefStore();
    const sessionStore = getSessionStore();

    const eventCount = eventStore.count();
    const beliefCount = beliefStore.count();
    const activeBeliefCount = beliefStore.count({ activeOnly: true });
    const sessionCount = sessionStore.count();
    const domainStats = beliefStore.getStatsPerDomain();

    console.log(`Events: ${eventCount}`);
    console.log(`Beliefs: ${activeBeliefCount} active / ${beliefCount} total`);
    console.log(`Sessions: ${sessionCount}`);

    if (Object.keys(domainStats).length > 0) {
      console.log('\nBeliefs by domain:');
      for (const [domain, stats] of Object.entries(domainStats)) {
        console.log(`  ${domain}: ${stats.count} (avg confidence: ${(stats.avgConfidence * 100).toFixed(0)}%)`);
      }
    }

    closeDatabase();
  });

// Capture event command
program
  .command('capture')
  .description('Capture an event')
  .requiredOption('-t, --type <type>', 'Event type: tool_call, user_message, file_change, error, observation')
  .option('--tool <name>', 'Tool name (for tool_call)')
  .option('--file <path>', 'File path')
  .option('--message <text>', 'Message content')
  .option('--error <text>', 'Error message')
  .option('--output <text>', 'Tool output')
  .action((options) => {
    const eventStore = getEventStore();
    const sessionStore = getSessionStore();

    const session = sessionStore.getOrCreate();

    const event = eventStore.capture(
      options.type as EventType,
      session.id,
      {
        tool_name: options.tool,
        file_path: options.file,
        message_content: options.message,
        error_message: options.error,
        tool_output: options.output,
      },
      {}
    );

    sessionStore.incrementEventCount(session.id);
    console.log(`Captured event: ${event.id}`);
    closeDatabase();
  });

// Add belief command
program
  .command('add-belief')
  .description('Add a new belief')
  .requiredOption('-t, --text <text>', 'Belief text')
  .requiredOption('-d, --domain <domain>', 'Domain: code_pattern, user_preference, project_structure, workflow, decision, constraint')
  .option('-c, --confidence <n>', 'Confidence 0-1', '0.7')
  .option('-i, --importance <n>', 'Importance 1-10', '5')
  .option('-e, --evidence <ids>', 'Comma-separated event IDs')
  .option('--tags <tags>', 'Comma-separated tags')
  .action((options) => {
    const beliefStore = getBeliefStore();
    const now = Date.now();

    const belief = beliefStore.create({
      text: options.text,
      domain: options.domain as BeliefDomain,
      confidence: parseFloat(options.confidence),
      evidence_ids: options.evidence ? options.evidence.split(',') : [],
      supporting_count: options.evidence ? options.evidence.split(',').length : 0,
      contradicting_count: 0,
      derived_at: now,
      last_evaluated: now,
      importance: parseInt(options.importance, 10),
      tags: options.tags ? options.tags.split(',') : [],
    });

    console.log(`Added belief: ${belief.id}`);
    console.log(`  "${belief.text}"`);
    closeDatabase();
  });

// Search command
program
  .command('search <query>')
  .description('Search beliefs and events')
  .option('-t, --type <type>', 'Search type: beliefs, events, both', 'both')
  .option('-l, --limit <n>', 'Max results', '10')
  .option('-d, --domain <domain>', 'Filter beliefs by domain')
  .action((query: string, options) => {
    const beliefStore = getBeliefStore();
    const eventStore = getEventStore();
    const limit = parseInt(options.limit, 10);

    if (options.type === 'beliefs' || options.type === 'both') {
      console.log('=== BELIEFS ===');
      const beliefs = beliefStore.searchHybrid(query, {
        limit,
        domain: options.domain as BeliefDomain | undefined,
        activeOnly: true,
      });

      if (beliefs.length === 0) {
        console.log('(no matching beliefs)');
      } else {
        for (const result of beliefs) {
          const b = result.belief;
          console.log(`[${b.domain}] (${(b.confidence * 100).toFixed(0)}%) ${b.text}`);
          console.log(`  ID: ${b.id}`);
        }
      }
      console.log('');
    }

    if (options.type === 'events' || options.type === 'both') {
      console.log('=== EVENTS ===');
      const events = eventStore.search(query, { limit });

      if (events.length === 0) {
        console.log('(no matching events)');
      } else {
        for (const e of events) {
          const time = new Date(e.timestamp).toLocaleString();
          console.log(`[${e.type}] ${time}`);
          console.log(`  ID: ${e.id}`);
          console.log(`  ${e.searchable_text.slice(0, 100)}`);
        }
      }
    }

    closeDatabase();
  });

// List beliefs command
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
          const evidence = `${b.supporting_count}+/${b.contradicting_count}-`;
          console.log(`[${(b.confidence * 100).toFixed(0)}%] ${b.text} (${evidence})`);
          console.log(`  ID: ${b.id}`);
        }
      }
    }

    closeDatabase();
  });

// List events command
program
  .command('events')
  .description('List recent events')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('-s, --session <id>', 'Filter by session')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const eventStore = getEventStore();

    const events = options.session
      ? eventStore.getBySession(options.session, { limit: parseInt(options.limit, 10) })
      : eventStore.getRecent(parseInt(options.limit, 10));

    if (options.json) {
      console.log(JSON.stringify(events, null, 2));
    } else if (events.length === 0) {
      console.log('No events.');
    } else {
      for (const e of events) {
        const time = new Date(e.timestamp).toLocaleString();
        console.log(`[${e.type}] ${time}`);
        console.log(`  ID: ${e.id}`);
        console.log(`  ${e.searchable_text.slice(0, 100)}`);
        console.log('');
      }
    }

    closeDatabase();
  });

// Update belief command
program
  .command('update-belief <id>')
  .description('Update a belief')
  .option('-c, --confidence <n>', 'New confidence 0-1')
  .option('-i, --importance <n>', 'New importance 1-10')
  .option('--add-support', 'Increment supporting count')
  .option('--add-contradict', 'Increment contradicting count')
  .action((id: string, options) => {
    const beliefStore = getBeliefStore();

    if (options.addSupport) {
      beliefStore.incrementSupporting(id);
    }
    if (options.addContradict) {
      beliefStore.incrementContradicting(id);
    }

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

// Invalidate belief command
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

// Reason command - outputs data for Claude to reason about
program
  .command('reason')
  .description('Output data for reasoning about recent activity')
  .option('-l, --limit <n>', 'Max events to include', '30')
  .option('-d, --domain <domain>', 'Focus on specific domain')
  .action((options) => {
    const eventStore = getEventStore();
    const beliefStore = getBeliefStore();

    const events = eventStore.getRecent(parseInt(options.limit, 10));
    const beliefs = beliefStore.getActive({
      domain: options.domain as BeliefDomain | undefined,
      limit: 20,
    });

    const prompt = buildInferencePrompt(events, beliefs, options.domain as BeliefDomain | undefined);
    console.log(prompt);

    closeDatabase();
  });

// Context command - outputs current memory context
program
  .command('context')
  .description('Output current memory context for injection')
  .option('-l, --limit <n>', 'Max beliefs to include', '10')
  .action((options) => {
    const beliefStore = getBeliefStore();

    const beliefs = beliefStore.getActive({
      limit: parseInt(options.limit, 10),
      minConfidence: 0.5,
    });

    if (beliefs.length === 0) {
      console.log('(no stored beliefs yet)');
    } else {
      console.log('## Memory Context\n');
      console.log(formatBeliefsForPrompt(beliefs));
    }

    closeDatabase();
  });

// Session commands
program
  .command('session-start')
  .description('Start a new session')
  .action(() => {
    const sessionStore = getSessionStore();
    const session = sessionStore.create();
    console.log(`Started session: ${session.id}`);
    closeDatabase();
  });

program
  .command('session-end')
  .description('End current session')
  .option('-s, --summary <text>', 'Session summary')
  .action((options) => {
    const sessionStore = getSessionStore();
    const session = sessionStore.getCurrent();

    if (!session) {
      console.log('No active session.');
      closeDatabase();
      return;
    }

    sessionStore.end(session.id, options.summary);
    console.log(`Ended session: ${session.id}`);
    closeDatabase();
  });

program.parse();
