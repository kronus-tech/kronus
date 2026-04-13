# Kronus Roadmap

## v1.0 — Current Release

Everything below is built and shipping.

### Telegram Control Plane
- Bun daemon manages per-project Claude Code sessions
- Telegram groups mapped to project directories
- Interactive prompts forwarded as inline keyboard buttons
- Collaborator mode — multi-user groups with `/c` prefix
- Sender attribution — Claude knows who's talking (admin vs collaborator)
- Permission approval flow via Telegram buttons
- Photo and document upload support
- Session persistence across daemon restarts

### Agents & Skills
- 10 specialized agents (planner, code-reviewer, security-auditor, ai-engineer, etc.)
- 19 quick workflow skills (/test-gen, /standup, /review, /audit, etc.)
- 4 composite skills that chain multiple tools
- 4 team configurations for parallel agent swarms
- Agents and skills defined as markdown files — no compilation needed

### Knowledge Graph (Brain)
- SQLite-backed knowledge graph with FTS5 search
- 14 MCP tools for note queries and graph traversal
- D3-powered visualization UI
- Auto-indexes notes, extracts entities and relationships
- Multi-root support — index notes from multiple directories
- Cross-project search with source filters

### Dashboard
- React + Tailwind web UI at localhost:8420
- Sessions, usage tracking, knowledge graph, project overview
- Served automatically by the daemon

### Security
- Scope guard — blocks file access outside project directory
- Pre-bash hook — blocks destructive and secret-leaking commands
- Collaborator trust model — admin vs collaborator permissions
- Per-project permission modes (default, acceptEdits, plan, bypassPermissions)

### Hub & Connect (Marketplace)
- JWT auth with Ed25519 signing
- WebSocket relay for cross-device connections
- Stripe billing integration
- App registry with developer API
- MCP gateway proxy
- Connect SDK with Ed25519 identity

### Setup & Onboarding
- Interactive install.sh — 5 questions, profession-aware configuration
- Profession templates (developer, lawyer, researcher, consultant, writer, student)
- Docker support via docker-compose.yml
- Autostart via macOS launchd

### MCP Servers (10)
GitHub, Playwright, Brave Search, Context7, Filesystem, Memory, Notion, Slack, Linear, Brain

---

## v2.0 — Planned

- Voice mode — talk to Kronus instead of typing
- Scheduled tasks — cron-based agents that run on a schedule
- Notification digests — daily/weekly summaries of activity
- Screen control — natural language desktop automation
- Profession templates marketplace — community-contributed templates
- Shared memory — team members accessing common knowledge
- Tool ecosystem — community-built MCP servers and skills
- Remote deployment — run daemon on a server, no local Mac required
- Google Drive integration — sync files to cloud

---

## Contributing

Want to help build v2? See [CONTRIBUTING.md](../CONTRIBUTING.md) and [the issues page](https://github.com/kronus-tech/kronus/issues).
