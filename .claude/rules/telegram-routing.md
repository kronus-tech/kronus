# Telegram Project Routing

When you receive a Telegram message from a group chat (indicated by `chat_id` in the `<channel>` tag), check `~/.claude/channels/telegram/projects.json` to determine which project the group is mapped to.

If the group is mapped:
- Use the project's `path` as the working directory for file operations and git commands
- Apply the project's `permissionMode` and `allowedTools` constraints
- Keep responses focused on that project's codebase

If the group is NOT mapped:
- Ask the user which project they want to work on
- Suggest running `kronus-init --group <group_id>` to set up the mapping

The daemon handles routing automatically when running. This rule applies when Claude is running directly (not via daemon).
