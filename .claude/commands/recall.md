---
description: "Memory-as-reasoning system for storing and recalling beliefs. Usage: /recall [reason|search <query>|add <belief>]"
---

# Recall: $ARGUMENTS

Dynamic memory system that stores beliefs derived from session activity. Unlike static storage, this system maintains mutable beliefs with confidence levels that can be updated based on new evidence.

## Parse Arguments

Extract from `$ARGUMENTS`:
- **No args**: Auto-detect phase — load beliefs at session start, or derive/save beliefs after work
- **reason**: Analyze recent events and derive new beliefs
- **search <query>**: Search beliefs and events
- **add <belief>**: Add a new belief manually

---

## Instructions

You have access to a memory system via the globally installed `mem-reason` CLI. The memory database is stored in the current project's `.memorai` directory.

### Available Commands

```bash
# Initialize (run once per project)
mem-reason init

# Show status
mem-reason status

# Show current beliefs (memory context)
mem-reason context

# List all beliefs
mem-reason beliefs

# Search beliefs and events
mem-reason search "<query>"

# Get reasoning prompt (analyze recent activity)
mem-reason reason

# Capture an event
mem-reason capture -t <type> [--tool <name>] [--file <path>] [--message <text>]
# Types: tool_call, user_message, file_change, error, observation

# Add a belief
mem-reason add-belief -t "<text>" -d <domain> [-c <confidence>] [-i <importance>] [--tags <tags>]
# Domains: code_pattern, user_preference, project_structure, workflow, decision, constraint

# Update a belief
mem-reason update-belief <id> [-c <confidence>] [--add-support] [--add-contradict]

# Invalidate a belief
mem-reason invalidate <id> -r "<reason>"
```

### Workflow

Based on `$ARGUMENTS`:

1. **Default (no args)**: Auto-detect session phase:
   - Run `mem-reason init` if `.memorai/` doesn't exist
   - Run `mem-reason events -l 5` to check for recent activity
   - **If no/few events** (start of session): Run `mem-reason context` to load existing beliefs into your working context. Briefly summarize what you remember.
   - **If events exist** (after work): Run `mem-reason reason`, analyze the output, then derive 0-3 new beliefs using `mem-reason add-belief`. Update or invalidate any contradicted beliefs.
2. **`reason`**: Run `mem-reason reason` to get analysis prompt, then:
   - Analyze the events and existing beliefs
   - Derive 0-3 new beliefs based on patterns you observe
   - For each belief, use `mem-reason add-belief` to store it
   - If an existing belief is contradicted, use `mem-reason update-belief --add-contradict` or `mem-reason invalidate`
3. **`search <query>`**: Run `mem-reason search` with the query
4. **`add <belief text>`**: Ask for domain and confidence, then use `mem-reason add-belief`

### Belief Domains

- `code_pattern` - Patterns in how code is written (e.g., "Uses async/await over callbacks")
- `user_preference` - User's stated or inferred preferences
- `project_structure` - How the project is organized
- `workflow` - Common workflows or sequences of actions
- `decision` - Architectural or design decisions made
- `constraint` - Requirements or limitations

### Confidence Levels

- 0.9-1.0: Very confident, multiple strong evidence
- 0.7-0.9: Confident, clear evidence
- 0.5-0.7: Moderate, some evidence
- 0.3-0.5: Low, weak or conflicting evidence
- Below 0.3: Auto-archive threshold

### Example Session

```
User: /recall reason

Claude: [Runs `mem-reason reason` command, analyzes output]
Based on recent activity, I derived these beliefs:

1. "User prefers explicit error handling with try/catch" (user_preference, 0.8)
   Evidence: Multiple messages requesting error handling

[Runs add-belief commands]
Added 1 new belief to memory.
```

### Important Notes

- Initialize with `mem-reason init` before first use in a project
- The `.memorai` directory should be gitignored
- Beliefs decay over time without supporting evidence
- Contradicting evidence reduces confidence
- Focus on actionable, specific beliefs
