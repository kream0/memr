#!/usr/bin/env bash
# memr SessionStart hook — generic, project-agnostic
# Provides belief context and active recall protocol at session start.
# Install: mem-reason setup  (auto-registers this hook)

set -euo pipefail

# ── Curate beliefs silently (non-blocking) ────────────────────────────────────
mem-reason curate >/dev/null 2>&1 &

# ── Orient: get compact belief context ────────────────────────────────────────
orient_output=""
if command -v mem-reason >/dev/null 2>&1; then
  orient_output=$(mem-reason orient 2>/dev/null || true)
fi

# ── Build context block ──────────────────────────────────────────────────────
read -r -d '' CONTEXT_BLOCK << 'MEMR_EOF' || true
## Active Recall Protocol

You have a persistent belief store via `mem-reason`. Use it throughout this session:

### Retrieve before acting
- Before starting any task, run `mem-reason check "<topic>"` to recall relevant beliefs.
- At session start, review `mem-reason orient` output (included below) for current context.

### Store before ending
- Before this session ends, encode any new lessons, decisions, or handoffs:
  - `mem-reason remember "<lesson>"` for quick storage
  - `mem-reason handoff "<state>"` for session continuity
- If something broke and you fixed it, store the lesson as a belief.

### Commands reference
- `mem-reason check <topic>` — quick lookup (top 3)
- `mem-reason remember <text>` — store a new belief
- `mem-reason handoff <text>` — session handoff (auto-supersedes previous)
- `mem-reason search <query>` — full-text search
- `mem-reason beliefs` — list all active beliefs
- `mem-reason curate` — auto-cleanup (decay, dedup, expire)
MEMR_EOF

# Append orient output if non-empty
if [ -n "$orient_output" ]; then
  CONTEXT_BLOCK="${CONTEXT_BLOCK}

## Current Belief Context
$orient_output"
fi

# ── Output as Claude Code hook JSON ──────────────────────────────────────────
if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "$CONTEXT_BLOCK" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
else
  # Manual JSON escaping fallback
  escaped=$(printf '%s' "$CONTEXT_BLOCK" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$escaped"
fi
