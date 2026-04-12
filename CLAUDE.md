# Kronus v1.0

## Overview

Kronus is an open-source AI agent system built on Claude Code. It adds mobile access (Telegram), persistent memory (knowledge graph), and specialized agents/skills on top of Claude Code's core capabilities.

**Architecture:** 10 agents + 19 skills + 10 MCP servers + 4 teams + Telegram daemon + knowledge graph.

## Directory Structure

```
.claude/agents/    — 10 specialized agents (markdown + YAML frontmatter)
.claude/skills/    — 19 quick workflow skills
.claude/rules/     — Coding standards, security, testing rules
.claude/teams/     — Team configs for parallel agent swarms
.claude/mcp.json   — MCP server configuration
brain/             — Knowledge graph (SQLite indexer, D3 UI, MCP server)
dashboard/         — React web UI (sessions, usage, graph)
hub/               — Marketplace server (auth, billing, WebSocket relay)
connect/           — SDK for Hub connections
daemon/            — Telegram daemon (reference copy; source: kronus-tech/daemon)
scripts/           — Install, init, publish scripts
config/            — Example configs
templates/         — Profession-specific starter templates
docs/              — Guides and references
```

## Key Patterns

- **Agents** are markdown files in `.claude/agents/`. YAML frontmatter defines name, model, tools, max turns. The markdown body is the system prompt.
- **Skills** are directories in `.claude/skills/` with a `SKILL.md` file. Same frontmatter pattern.
- **MCP servers** are configured in `.claude/mcp.json`. Environment variables reference `$ENV_VAR` (never hardcoded).
- **Teams** coordinate multiple agents in parallel. Defined in `.claude/teams/`.
- **The daemon** spawns Claude Code in headless mode (`--output-format stream-json`) and routes Telegram messages to per-project sessions.

## Running Locally

```bash
# Install everything
./scripts/install.sh

# Start Telegram daemon
~/.claude/daemon/scripts/kronus-daemon.sh start

# Start knowledge graph (optional)
cd brain && bun install && bun run start

# Dashboard runs automatically with daemon at http://localhost:8420
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Add agents in `.claude/agents/`, skills in `.claude/skills/`
4. Test locally with Claude Code
5. Submit a PR

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md).
