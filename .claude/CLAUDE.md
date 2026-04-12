# Kronus — Architecture Reference

## System Architecture

Kronus is a hybrid agent + skill system with a Telegram control plane daemon. Agents handle complex multi-turn work. Skills handle repeatable quick workflows. MCP servers connect external tools. Teams coordinate parallel swarms. The daemon routes Telegram messages to per-project Claude Code sessions.

## Daemon

The daemon (`daemon/src/`) is a Bun/TypeScript process that:
1. Runs a grammy bot for Telegram message handling
2. Routes group messages to per-project Claude Code sessions
3. Spawns Claude in headless mode: `claude -p --output-format stream-json --resume`
4. Parses stream-json output and forwards responses to Telegram
5. Intercepts AskUserQuestion tool calls and renders them as Telegram inline buttons
6. Manages session lifecycle (spawn, resume, cleanup, graceful shutdown)

Source of truth for daemon code: [kronus-tech/daemon](https://github.com/kronus-tech/daemon)

## Agents (10)

| Agent | Model | Domain |
|-------|-------|--------|
| planner | opus | Task orchestration, dispatch, parallel planning |
| team-lead | opus | Agent swarm coordination |
| ai-engineer | sonnet | RAG, prompt engineering, model selection |
| frontend-dev | sonnet | React/Next.js/Tailwind |
| backend-infra | sonnet | APIs, databases, Docker, Terraform |
| code-reviewer | sonnet | PR analysis, quality/security review |
| security-auditor | sonnet | SAST, dependency scanning, OWASP |
| fuzzing-agent | sonnet | Fuzz testing, edge case generation |
| proposal-writer | sonnet | Proposals, SOWs, RFP responses |
| memory-retriever | sonnet | Query past project context |

## Skills (19 + 4 composite)

### Quick workflows
test-gen, test-run, ci-comment, quick-review, upwork-proposal, lead-qualify, cold-outreach, invoice-gen, seo-article, profile-optimize, linkedin-post, case-study, github-readme, meeting-notes, daily-briefing, project-summary, standup-update, dep-check, secret-scan

### Composite (chain multiple tools)
/plan, /review, /test, /audit

## MCP Servers (10)

github, playwright, brave-search, context7, filesystem, memory, notion, slack, linear, brain

## Routing Rules

- **Simple extraction/formatting** -> Skill (haiku)
- **Implementation/analysis** -> Skill (sonnet) or Agent
- **Multi-file architecture** -> Agent (sonnet)
- **Orchestration/planning** -> Agent (opus)
- **External systems** -> MCP server
- **Multiple independent tasks** -> Parallel execution
- **Large cross-cutting work** -> Team swarm

## Security Notes

- Only 2 agents have Bash: code-reviewer, security-auditor
- Pre-bash-check hook blocks destructive commands globally
- Post-write-lint hook validates all file changes
- Secrets use environment variables, never hardcoded
