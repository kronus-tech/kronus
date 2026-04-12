# Hooks

## Overview

Kronus uses Claude Code hooks to enforce safety checks and quality gates. Hooks are shell scripts that run automatically before or after specific tool executions.

## Configuration

Hooks are configured in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/hooks/pre-bash-check.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/hooks/post-write-lint.sh"
          }
        ]
      }
    ]
  }
}
```

## Hook Events

| Event | When it fires | Use case |
|-------|--------------|----------|
| `PreToolUse` | Before a tool executes | Block dangerous commands, validate inputs |
| `PostToolUse` | After a tool completes | Lint files, validate outputs, log actions |

## Included Hooks

### pre-bash-check.sh
**Event:** PreToolUse (Bash)
**Purpose:** Blocks destructive bash commands before execution.

**Blocked patterns:**
- `rm -rf /`, `rm -rf ~` — filesystem destruction
- `sudo rm` — privileged deletion
- `git push --force origin main` — force push to main
- `git reset --hard` — discard changes
- `DROP TABLE`, `DROP DATABASE` — database destruction
- `dd if=`, `mkfs` — disk operations

**Exit codes:**
- `0` — Command allowed
- `2` — Command blocked (with error message)

### post-write-lint.sh
**Event:** PostToolUse (Write|Edit)
**Purpose:** Runs appropriate linter after file writes.

**Supported file types:**
- `.ts`, `.tsx`, `.js`, `.jsx` — ESLint (if available)
- `.py` — Python compile check
- `.json` — JSON validation (jq or python)
- `.yaml`, `.yml` — YAML validation (python)

## Writing Custom Hooks

1. Create a script in `scripts/hooks/`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Read tool input from stdin
INPUT=$(cat)

# Your validation logic here

# Exit 0 to allow, exit 2 to block
exit 0
```

2. Make it executable: `chmod +x scripts/hooks/my-hook.sh`

3. Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ToolName",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/hooks/my-hook.sh"
          }
        ]
      }
    ]
  }
}
```

## Matcher Patterns

- Single tool: `"Bash"`
- Multiple tools: `"Write|Edit"`
- All tools: `".*"`
