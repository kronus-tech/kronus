# Kronus v5.5 — Global Agent + Skill System

Kronus is installed globally. Agents and skills are available in any directory via Claude Code.

## Quick Reference

### Agents (10 — complex multi-turn work)
```
planner          — Task orchestration, parallel planning (opus)
team-lead        — Agent swarm coordination (opus)
ai-engineer      — RAG, prompt engineering, model selection
frontend-dev     — React/Next.js/Tailwind
backend-infra    — APIs, databases, Docker, Terraform
code-reviewer    — PR analysis, quality/security review
security-auditor — SAST, dependency scanning, OWASP
fuzzing-agent    — Fuzz testing, edge cases
proposal-writer  — Proposals, SOWs, RFP responses
memory-retriever — Query past project context
```

### Skills (19 — quick single-command workflows)
```
/test-gen         — Generate tests for a file
/test-run         — Execute tests, triage failures
/ci-comment       — Generate PR comment from CI output
/quick-review     — Lightweight single-file review
/upwork-proposal  — Tailored Upwork cover letter
/lead-qualify     — Score and qualify a lead
/cold-outreach    — Personalized outreach email/DM
/invoice-gen      — Generate professional invoice
/seo-article      — SEO-optimized blog post
/profile-optimize — Optimize LinkedIn/Upwork/GitHub profile
/linkedin-post    — LinkedIn thought leadership post
/case-study       — Client case study from project notes
/github-readme    — Generate/improve project README
/meeting-notes    — Extract action items from transcript
/daily-briefing   — Morning briefing with git activity
/project-summary  — Compress recent activity
/standup-update   — Generate standup update
/dep-check        — Dependency vulnerability scan
/secret-scan      — Scan for hardcoded secrets
```

### Composite Commands
```
/plan    — Break task into agent/skill-assigned steps
/review  — Code review pipeline
/test    — Generate + execute tests
/audit   — Security audit pipeline
```

### MCP Servers (9)
```
github, playwright, brave-search, context7, filesystem, memory, notion, slack, linear
```

## How to Invoke

### Agents (for complex work)
```
"Invoke ai-engineer to design a RAG system"
"Use code-reviewer to review PR #42"
"Launch team-lead with engineering team for this feature"
```

### Skills (for quick workflows)
```
/upwork-proposal [paste job posting]
/lead-qualify [paste lead info]
/linkedin-post [topic]
/test src/auth/login.ts
/audit
```

### Teams (for parallel swarms)
```
"Launch engineering team to build this feature"
"Run security team audit on this codebase"
"Spin up business team for lead pipeline"
```

## Routing Rules

- **Simple task** (extraction, formatting, scanning) → Skill (haiku)
- **Medium task** (implementation, review, content) → Skill (sonnet) or Agent
- **Complex task** (multi-file, architecture, multi-step) → Agent (sonnet)
- **Orchestration** (planning, swarms) → Agent (opus)
- **External systems** (GitHub, Slack, Notion) → MCP server
- **Multiple independent tasks** → Parallel execution
- **Large cross-domain work** → Team swarm

## Project-Level Override

If a project has its own `.claude/agents/` or `.claude/skills/` directory, those take priority over global ones with the same name.

## Source

Installed from Kronus: https://github.com/kronus-tech/kronus
Version: 5.5 — Agents, skills, MCP servers, swarm mode, Telegram daemon, knowledge graph
