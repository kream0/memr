# memory-as-reasoning

Memory as dynamic reasoning, not static storage.

A Claude Code CLI plugin that captures events, derives mutable beliefs with confidence scores, and provides hybrid search (FTS5 + semantic) — treating memory as an evolving reasoning process rather than a flat key-value store.

## Overview

`memory-as-reasoning` introduces a belief-based memory system for AI-assisted development. Instead of storing raw notes, it:

- **Captures events** — tool calls, messages, file changes, errors — as an append-only log
- **Derives beliefs** — mutable statements with confidence scores, evidence tracking, and domain classification
- **Decays over time** — beliefs lose confidence without reinforcing evidence, keeping memory current
- **Searches intelligently** — combines SQLite FTS5 keyword search with hash-based semantic similarity

The CLI tool `mem-reason` can be used standalone or integrated into Claude Code via the `/recall` skill.

## Installation

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+

### Steps

```bash
# Clone the repository
git clone <repo-url>
cd memory-as-reasoning

# Install dependencies
bun install

# Build
bun run build

# Install CLI globally
npm link

# Verify
mem-reason --version
```

## Quick start

```bash
# 1. Initialize memory in your project
cd /path/to/your/project
mem-reason init

# 2. Capture an event
mem-reason capture -t user_message --message "Prefer async/await over callbacks"

# 3. Generate a reasoning prompt for Claude
mem-reason reason

# 4. Add a derived belief
mem-reason add-belief -t "User prefers async/await over callbacks" -d user_preference -c 0.85

# 5. Inject memory context into a prompt
mem-reason context
```

## CLI commands

### `init`

Initialize the memory system in the current directory. Creates `.memorai/` with an SQLite database and config.

```bash
mem-reason init
```

### `status`

Show memory system statistics: event count, belief count (active/total), session count, and per-domain breakdowns.

```bash
mem-reason status
```

### `capture`

Record a raw event.

```bash
mem-reason capture -t <type> [options]
```

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | **Required.** One of: `tool_call`, `user_message`, `assistant_message`, `observation`, `file_change`, `error`, `session_start`, `session_end` |
| `--tool <name>` | Tool name (for `tool_call`) |
| `--file <path>` | File path (for `file_change`) |
| `--message <text>` | Message content (for message types) |
| `--error <text>` | Error message (for `error`) |
| `--output <text>` | Tool output text |

### `add-belief`

Add a new belief to the system.

```bash
mem-reason add-belief -t <text> -d <domain> [options]
```

| Option | Description |
|--------|-------------|
| `-t, --text <text>` | **Required.** Belief statement |
| `-d, --domain <domain>` | **Required.** Belief domain (see [Belief domains](#belief-domains)) |
| `-c, --confidence <n>` | Confidence 0–1 (default: `0.7`) |
| `-i, --importance <n>` | Importance 1–10 (default: `5`) |
| `-e, --evidence <ids>` | Comma-separated supporting event IDs |
| `--tags <tags>` | Comma-separated tags |

### `search`

Search beliefs and events by keyword or semantic similarity.

```bash
mem-reason search <query> [options]
```

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | `beliefs`, `events`, or `both` (default: `both`) |
| `-l, --limit <n>` | Max results (default: `10`) |
| `-d, --domain <domain>` | Filter beliefs by domain |

### `beliefs`

List active beliefs.

```bash
mem-reason beliefs [options]
```

| Option | Description |
|--------|-------------|
| `-d, --domain <domain>` | Filter by domain |
| `-l, --limit <n>` | Max beliefs (default: `20`) |
| `--json` | Output as JSON |

### `events`

List recent events in reverse chronological order.

```bash
mem-reason events [options]
```

| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Max events (default: `20`) |
| `-s, --session <id>` | Filter by session ID |
| `--json` | Output as JSON |

### `update-belief`

Update an existing belief.

```bash
mem-reason update-belief <id> [options]
```

| Option | Description |
|--------|-------------|
| `-c, --confidence <n>` | New confidence (0–1) |
| `-i, --importance <n>` | New importance (1–10) |
| `--add-support` | Increment supporting evidence count |
| `--add-contradict` | Increment contradicting evidence count |

### `invalidate`

Mark a belief as no longer valid.

```bash
mem-reason invalidate <id> -r <reason>
```

| Option | Description |
|--------|-------------|
| `-r, --reason <text>` | **Required.** Reason for invalidation |

### `reason`

Generate a reasoning prompt for Claude to analyze recent activity and derive new beliefs.

```bash
mem-reason reason [options]
```

| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Max events to include (default: `30`) |
| `-d, --domain <domain>` | Focus on a specific domain |

### `context`

Output current memory context formatted for prompt injection.

```bash
mem-reason context [options]
```

| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Max beliefs to include (default: `10`) |

### `session-start`

Create a new session. Returns the session ID.

```bash
mem-reason session-start
```

### `session-end`

End the current active session.

```bash
mem-reason session-end [options]
```

| Option | Description |
|--------|-------------|
| `-s, --summary <text>` | Optional session summary |

## Belief domains

Beliefs are classified into one of six domains:

| Domain | Description | Example |
|--------|-------------|---------|
| `code_pattern` | Patterns in how code is written | "Uses async/await over callbacks" |
| `user_preference` | User's stated or inferred preferences | "Prefers detailed error messages" |
| `project_structure` | How the project is organized | "Uses monorepo structure" |
| `workflow` | Common workflows or action sequences | "Always tests before committing" |
| `decision` | Architectural or design decisions | "Using SQLite for storage" |
| `constraint` | Requirements or limitations | "Must support Node.js 18+" |

## Confidence system

### Scale

| Range | Meaning |
|-------|---------|
| 0.9–1.0 | Very confident — multiple strong evidence sources |
| 0.7–0.9 | Confident — clear supporting evidence |
| 0.5–0.7 | Moderate — some supporting evidence |
| 0.3–0.5 | Low — weak or conflicting evidence |
| < 0.3 | Auto-archived — belief becomes inactive |

### Decay

Beliefs lose confidence over time without reinforcing evidence:

```
new_confidence = max(minConfidenceFloor, confidence - (confidenceDecayPerDay × days_elapsed))
```

With defaults, a belief decays at **1% per day** and is auto-archived below **0.3** confidence.

### Evidence tracking

Each belief tracks:
- **`supporting_count`** — events that reinforce the belief
- **`contradicting_count`** — events that conflict with it

When `contradicting_count` reaches the `contradictionThreshold` (default: 3), the belief is flagged for review.

## Architecture

```
User / Claude Code
       │
   /recall skill
       │
  mem-reason CLI (Commander.js)
       │
   Command Router
   ├── capture ──────→ EventStore ────→ SQLite (append-only)
   ├── add-belief ───→ BeliefStore ──→ SQLite + Embeddings
   ├── search ───────→ Hybrid Search → FTS5 + Cosine Similarity
   ├── reason ───────→ Prompt Builder → Formatted prompt output
   └── context ──────→ BeliefStore ──→ Formatted context output
```

### Storage layer

SQLite database (`.memorai/memory.db`) with WAL mode for concurrent access and FTS5 virtual tables for full-text search. Tables: `events`, `beliefs`, `predictions`, `sessions`, `events_fts`, `beliefs_fts`.

### Belief store

CRUD operations on beliefs with hybrid search (keyword + semantic), confidence decay, and domain-based aggregation. Beliefs are stored with 384-dimensional embeddings for semantic similarity.

### Event store

Append-only log of raw events. Each event generates searchable text from its type, tool name, output, message, file path, and error fields. Events can be marked as processed after reasoning analysis.

### Prediction store

Stores system predictions with a feedback loop — predictions are evaluated against actual outcomes to calibrate belief confidence over time.

### Session management

Sessions group events by conversation. A session tracks start/end timestamps, event count, and an optional summary.

### Embeddings

Lightweight 384-dimensional hash-based embeddings generated locally — no external ML model or API calls required. Uses multiple hash functions (primary, bigram, word-boundary) normalized to unit vectors for cosine similarity.

### Reasoning prompts

Structured prompts for Claude to:
- **Infer beliefs** from recent events (`buildInferencePrompt`) — analyzes events against existing beliefs and derives 0–3 new beliefs
- **Detect contradictions** (`buildContradictionPrompt`) — classifies events as `SUPPORTS`, `NEUTRAL`, `WEAKLY_CONTRADICTS`, or `STRONGLY_CONTRADICTS`

## Claude Code integration

The `/recall` skill integrates `mem-reason` into Claude Code:

```
/recall                    # Show current memory context
/recall reason             # Analyze recent activity, derive beliefs
/recall search <query>     # Search beliefs and events
/recall add <belief>       # Add a new belief interactively
```

Memory is project-scoped (each project has its own `.memorai/` directory) and persists across Claude Code sessions.

## Configuration

Configuration lives in `.memorai/config.json` (created on `init`, git-ignored):

```json
{
  "dataDir": ".memorai",
  "embeddingModel": "bge-large-en-v1.5",
  "contradictionThreshold": 3,
  "confidenceDecayPerDay": 0.01,
  "minConfidenceFloor": 0.3,
  "consolidationEventThreshold": 50,
  "consolidationIntervalMinutes": 30
}
```

| Property | Default | Description |
|----------|---------|-------------|
| `dataDir` | `.memorai` | Storage directory |
| `embeddingModel` | `bge-large-en-v1.5` | Embedding model identifier |
| `contradictionThreshold` | `3` | Contradictions before review |
| `confidenceDecayPerDay` | `0.01` | Confidence loss per day |
| `minConfidenceFloor` | `0.3` | Auto-archive threshold |
| `consolidationEventThreshold` | `50` | Events before consolidation |
| `consolidationIntervalMinutes` | `30` | Min minutes between consolidations |

Set `ANTHROPIC_API_KEY` as an environment variable to enable Claude-powered reasoning.

## Project structure

```
memory-as-reasoning/
├── src/
│   ├── index.ts                  # CLI entry point and command definitions
│   ├── types.ts                  # TypeScript type definitions
│   ├── reasoning/
│   │   └── prompts.ts            # Inference and contradiction prompts
│   ├── storage/
│   │   ├── sqlite.ts             # Database initialization and schema
│   │   ├── belief-store.ts       # Belief CRUD, search, and decay
│   │   ├── event-store.ts        # Event capture and retrieval
│   │   ├── prediction-store.ts   # Prediction storage and feedback
│   │   └── session-store.ts      # Session lifecycle management
│   └── utils/
│       ├── config.ts             # Configuration loading and defaults
│       └── embeddings.ts         # Hash-based embedding generation
├── dist/                         # Compiled output
├── package.json
├── tsconfig.json
└── bunfig.toml
```
