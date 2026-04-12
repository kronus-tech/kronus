# Security

Kronus has multiple layers of security for multi-user, multi-project environments.

## Scope Guard

The scope guard prevents Claude sessions from reading files outside their project directory.

### How It Works

1. A `PreToolUse` hook intercepts Read/Glob/Grep/Edit/Write tool calls
2. Checks if the file path is within the project directory
3. If outside scope: blocks the call and requests admin approval via Telegram
4. Admin approves (once / always) or denies via inline buttons
5. Hook waits up to 120 seconds for a decision, then auto-denies

### Always-Allowed Paths

These paths are always accessible without approval:
- Project directory and subdirectories
- `~/.claude/` (Claude's own config and rules)
- `~/second-brain/` (read-only knowledge base)
- `/tmp/` and `/private/tmp/`

### Per-Project Allowlists

Add trusted paths per project in `.claude/scope-allowlist.json`:
```json
{
  "allowed_paths": [
    "/path/to/shared/lib",
    "/path/to/data"
  ]
}
```

Manage via dashboard: Security → Allowlists tab.

### Terminal Sessions

The scope guard only activates in daemon-spawned sessions (`KRONUS_SCOPE_GUARD=1` env var). Terminal sessions are unaffected — you can read any file normally.

### Approving from Dashboard

Navigate to `http://localhost:8420/security`:
- **Pending tab** — approve, always-allow, or deny requests
- **History tab** — audit log of all past decisions
- **Allowlists tab** — manage per-project allowed paths

## Access Control

### Who Can Message the Bot

Controlled by `~/.claude/channels/telegram/access.json`:

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["YOUR_USER_ID"],
  "groups": {
    "GROUP_ID": {
      "requireMention": false,
      "allowFrom": ["USER_ID"],
      "collaboratorMode": "auto",
      "collaborators": [],
      "adminUsers": ["USER_ID"]
    }
  }
}
```

### Collaborator Mode

In groups with 3+ members, collaborator mode activates automatically:
- Regular messages are human-to-human chat (bot ignores)
- `/c <message>` sends a message to Claude
- New users need admin approval to use `/c`

### Admin Hierarchy

1. **Global admin** (`allowFrom` at root) — access to everything, all groups
2. **Group admin** (`adminUsers` per group) — manage collaborators for that group
3. **Collaborators** — can use `/c` in their approved groups

## Bash Safety

The `pre-bash-check.sh` hook blocks dangerous commands:
- `rm -rf /`, `rm -rf ~`
- `sudo rm`, `mkfs`, `dd if=`
- `git push --force origin main`
- `DROP TABLE`, `DROP DATABASE`
- Fork bombs

## Scope Guard Hook Installation

The hook is configured in `~/.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Glob|Grep|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash $HOME/.claude/daemon/scripts/scope-guard.sh",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```
