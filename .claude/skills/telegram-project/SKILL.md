---
name: telegram-project
description: Manage Telegram group → project directory mappings for the kronus daemon. Use when the user wants to map a Telegram group to a project, list mappings, or configure project settings.
user-invocable: false
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(pwd)
---

# Telegram Project Mapping

Manages project-to-group mappings in `~/.claude/channels/telegram/projects.json`.
The kronus daemon reads this file to route Telegram group messages to the correct Claude Code session.

Arguments passed: `$ARGUMENTS`

---

## State shape

`~/.claude/channels/telegram/projects.json`:

```json
{
  "projects": {
    "<group_id>": {
      "name": "project-name",
      "path": "/absolute/path/to/project",
      "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      "permissionMode": "acceptEdits",
      "addedAt": "2026-03-22T00:00:00Z"
    }
  },
  "defaults": {
    "allowedTools": ["Read", "Glob", "Grep"],
    "permissionMode": "default"
  }
}
```

Missing file = create with empty projects and safe defaults.

---

## Dispatch on arguments

Parse `$ARGUMENTS` (space-separated). If empty or unrecognized, show status.

### No args — status

1. Read `~/.claude/channels/telegram/projects.json` (handle missing file).
2. Show: number of mapped projects, each with name, path, group_id, permissionMode.

### `add <group_id>` (optional: `--name <name>`, `--path <path>`, `--mode <permissionMode>`)

1. Read projects.json (create default if missing).
2. Default `--path` to current working directory (run `pwd`).
3. Default `--name` to basename of the path.
4. Default `--mode` to `"acceptEdits"`.
5. Default `allowedTools` to `["Read", "Write", "Edit", "Glob", "Grep", "Bash"]`.
6. Set `projects[<group_id>]` with the config and current ISO timestamp.
7. Write back.
8. Check if group exists in `~/.claude/channels/telegram/access.json` groups. If not, warn user to run `/telegram:access group add <group_id>`.
9. Confirm the mapping.

### `rm <group_id>`

1. Read, delete `projects[<group_id>]`, write.
2. Confirm.

### `set <group_id> <key> <value>`

1. Read projects.json.
2. Validate group_id exists.
3. Supported keys: `name`, `path`, `permissionMode`, `allowedTools` (JSON array string).
4. Update the key, write back.
5. Confirm.

### `init`

1. Run `pwd` to get current directory.
2. Read projects.json.
3. Tell user: "To map this project, provide the Telegram group ID. You can find it by adding @raw_data_bot to your group."
4. If group_id provided as additional arg: proceed like `add <group_id> --path <cwd>`.

---

## Implementation notes

- Always Read the file before Write — don't clobber.
- Pretty-print JSON (2-space indent).
- Group IDs are negative numbers (e.g., `-1001234567890`) — store as strings.
- Validate paths exist before saving (run `ls` on the path).
- The daemon re-reads this file on each incoming message, so changes take effect immediately.
