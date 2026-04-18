<p align="center">
  <a href="https://kronus.tech"><strong>🌐 kronus.tech</strong></a>
</p>

<p align="center">
  <img src="assets/kronus-logo.svg" alt="Kronus" width="80" />
</p>

<h1 align="center">Kronus (Private)</h1>

<p align="center"><strong>Private fork of <a href="https://github.com/kronus-tech/kronus">kronus-tech/kronus</a>.</strong></p>
<p align="center">Personal configs, internal docs, build plans. Public release lives at kronus-tech.</p>

<p align="center">
  <img src="https://img.shields.io/badge/v1.0-stable-green" alt="v1.0" />
  <img src="https://img.shields.io/badge/private-fork-red" alt="Private Fork" />
</p>

---

## Repo Strategy

| Repo | Purpose | Visibility |
|------|---------|-----------|
| **kronus-tech/kronus** | Public release, community contributions | Public |
| **kronus-tech/daemon** | Public daemon release | Public |
| **par1kahl/kronus-par1k** (this) | Private fork — personal configs, internal docs | Private |
| **par1kahl/kronus-par1k-daemon** | Private daemon — live running process | Private |

**Workflow:** Development happens in kronus-tech. Pull updates here with `git pull kronus-tech main`.

## What is Kronus?

Kronus turns Claude Code into a complete AI system you can run from anywhere. It adds three things Claude Code doesn't have out of the box: **mobile access** (via Telegram), **persistent memory** (a knowledge graph that spans sessions and projects), and **a team of specialized agents** that handle different types of work.

Full technical details: [kronus-tech/kronus README](https://github.com/kronus-tech/kronus)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    You                                    │
│          Terminal  ·  Telegram  ·  Dashboard               │
└─────────┬──────────────┬──────────────┬──────────────────┘
          │              │              │
┌─────────▼──────────────▼──────────────▼──────────────────┐
│                     Daemon                                │
│  Telegram bot · Session manager · Permission system       │
│  Message routing · Scope guard · Usage tracking           │
└─────────┬────────────────────────────────────────────────┘
          │ spawns per-project sessions
┌─────────▼────────────────────────────────────────────────┐
│              Claude Code Sessions                         │
│  One session per project · Resumes across restarts        │
│  Full tool access · Headless (stream-json I/O)            │
└─────────┬──────────────┬──────────────┬──────────────────┘
          │              │              │
┌─────────▼──┐  ┌───────▼─────┐  ┌────▼───────────────────┐
│   Agents   │  │   Skills    │  │     MCP Servers         │
│ 10 special-│  │ 19 quick    │  │ GitHub · Playwright     │
│ ized agents│  │ workflows   │  │ Brave · Notion · Slack  │
│ for complex│  │ for common  │  │ Linear · Memory · Brain │
│ multi-turn │  │ single-pass │  │ Context7 · Filesystem   │
│ tasks      │  │ tasks       │  │                         │
└────────────┘  └─────────────┘  └─────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────┐
│                     Brain                                 │
│  SQLite knowledge graph · D3 visualization                │
│  Auto-indexes notes · Cross-project search                │
│  14 MCP tools · Backlinks · Health scoring                │
└──────────────────────────────────────────────────────────┘
```

### How it works

The **daemon** is a Bun process that runs a Telegram bot and manages Claude Code sessions. Each Telegram group maps to a project directory. When you send a message, the daemon routes it to the right Claude session, which runs in headless mode with `--output-format stream-json`. Responses stream back to Telegram.

**Agents** handle complex multi-turn work (code review, security audits, architecture planning). **Skills** handle quick single-pass workflows (test generation, standup updates, dependency checks). Both are defined as markdown files with YAML frontmatter — adding a new agent is creating a `.md` file.

The **brain** is a SQLite-backed knowledge graph that indexes your notes, extracts entities and relationships, and serves them via MCP tools. A D3-powered UI lets you visualize how your knowledge connects.

**MCP servers** connect external tools — GitHub for PRs, Playwright for browser automation, Brave for web search, Notion/Slack/Linear for team workflows.

## Components

| Component | What it does | Tech |
|-----------|-------------|------|
| **Daemon** | Telegram routing, session management, permissions, usage tracking | Bun, grammy, stream-json |
| **Brain** | Knowledge graph indexer, search, MCP server, visualization | SQLite, D3.js, Bun |
| **Dashboard** | Web UI for sessions, usage, knowledge graph, project overview | React, Vite, Tailwind |
| **Agents** | 10 specialized AI agents (planner, code-reviewer, security-auditor, etc.) | Markdown + YAML frontmatter |
| **Skills** | 19 quick workflows (/test-gen, /standup, /review, /audit, etc.) | Markdown + YAML frontmatter |
| **Hub** | App marketplace server — auth, billing, WebSocket relay | Express, PostgreSQL, Redis, Stripe |
| **Connect** | SDK for Hub connections — identity, app management | TypeScript, Ed25519 |

## Quick Start

```bash
git clone https://github.com/kronus-tech/kronus.git
cd kronus && ./scripts/install.sh
```

The installer asks 5 questions (name, profession, how you work, your notes, your priority) and configures everything. Takes about 10 minutes.

**Requirements:** git, [Bun](https://bun.sh), [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (needs an Anthropic API key or Claude plan)

[Full setup guide ->](docs/SETUP.md)

## Building Your Own Agents

Creating an agent is writing a markdown file. Drop it in `.claude/agents/` and it's available immediately:

```markdown
---
name: my-agent
description: Does something useful
model: sonnet
tools: Read, Write, Glob, Grep
---

You are an agent that does something useful.

## Instructions
1. Read the relevant files
2. Analyze them
3. Produce the output
```

Skills work the same way in `.claude/skills/`. No compilation, no deployment, no framework to learn. The markdown IS the agent.

[Developer guide ->](docs/DEVELOPER-GUIDE.md)

## Using from Your Phone

Once the daemon is running, any Telegram group becomes a project workspace:

```bash
# Start the daemon
~/.claude/daemon/scripts/kronus-daemon.sh start

# In Telegram: add your bot to a group, then:
/setup /path/to/project
```

Messages in the group go to Claude. Files you send get downloaded and placed in the project. Photos get analyzed. Claude can send files back. The full power of Claude Code, from a chat interface.

[Telegram setup ->](docs/SETUP.md#from-your-phone-telegram)

## Documentation

| Resource | Link |
|----------|------|
| Website | [kronus.tech](https://kronus.tech) |
| Full docs | [kronus-tech/docs](https://github.com/kronus-tech/docs) |
| Setup guide | [docs/SETUP.md](docs/SETUP.md) |
| Developer guide | [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) |
| API reference | [docs/API-REFERENCE.md](docs/API-REFERENCE.md) |
| Security | [docs/SECURITY.md](docs/SECURITY.md) |
| Agent reference | [docs/AGENT_REFERENCE.md](docs/AGENT_REFERENCE.md) |
| Daemon repo | [kronus-tech/daemon](https://github.com/kronus-tech/daemon) |

## Directory Structure

```
.claude/
  agents/          # 10 specialized agents (markdown files)
  skills/          # 19 quick workflow skills (markdown dirs)
  rules/           # Coding standards, security rules, testing rules
  teams/           # Team configurations for parallel agent swarms
  mcp.json         # MCP server configuration
brain/             # Knowledge graph — indexer, MCP server, UI
dashboard/         # React web UI — sessions, usage, graph
hub/               # Marketplace server — auth, billing, relay
connect/           # SDK for Hub connections
daemon/            # Reference copy of the daemon (source: kronus-tech/daemon)
scripts/           # Install, init, publish scripts
config/            # Example configs (.env, projects.json, access.json)
templates/         # Profession-specific starter templates
docs/              # Guides, references, troubleshooting
```

## License

MIT. Use it however you want.

---

<p align="center">
  <a href="https://kronus.tech">kronus.tech</a> · <a href="https://github.com/kronus-tech">GitHub</a> · <a href="https://github.com/kronus-tech/docs">Docs</a>
</p>
