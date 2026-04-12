---
name: kronus
description: Show Kronus v4.1 quick reference — skills, agents, teams, Telegram commands, and daily usage. Auto-invoked when user says "kronus", "what can I do", "show commands", "help skills".
model: haiku
context: fork
allowed-tools: Read
disable-model-invocation: true
---

Print the following reference card right now. Do not summarize or modify — output it exactly:

---

# Kronus v4.1 — Quick Reference

## Telegram Commands (from any mapped group)

### Session Control
```
/mode plan           → Switch to plan mode (Claude plans, doesn't change files)
/mode accept         → Switch to acceptEdits (auto-approve file changes)
/mode default        → Standard mode (ask before dangerous ops)
/mode dontask        → Don't ask, just do
/mode bypass         → Skip all permission checks
/new                 → Start fresh session (discard conversation history)
/stop                → Kill running session
/resume <session_id> → Attach to an existing Claude session
```

### Info & Management
```
/sessions            → List all daemon + terminal sessions
/status              → This group's project info, mode, and session
/trust <tool>        → Add tool to allowed list (e.g., /trust WebSearch)
/help                → Show Telegram commands
```

### Files
```
Send a photo         → Downloaded and passed to Claude for analysis
Send a document      → Downloaded and passed to Claude
```

## Daily Workflows

### Morning
```
/daily-briefing              → What happened, what's open, priorities
/standup-update              → Ready-to-paste standup for Slack/Telegram
```

### During Work
```
/quick-review file.ts        → Fast review of a single file
/test src/auth/              → Generate + run tests for a module
/review                      → Full code review of recent changes
/audit                       → Security scan (SAST + deps + secrets)
/secret-scan                 → Quick check for hardcoded credentials
/dep-check                   → Dependency vulnerability scan
```

### End of Day
```
/project-summary             → Wrap up today's work in 2-4 sentences
```

## Lead & Business

### New Lead Comes In
```
/lead-qualify [paste job/lead info]     → Score it (Hot/Warm/Cold)
/upwork-proposal [paste job posting]    → Generate cover letter
```

### Client Work
```
/cold-outreach [prospect info]          → Email + LinkedIn DM drafts
/invoice-gen [client, project, hours]   → Professional invoice
/case-study [project notes]             → Portfolio-ready case study
/meeting-notes [paste transcript]       → Action items + decisions
```

### Complex Proposals
```
"Invoke proposal-writer to draft an SOW for [project]"
```

## Content & Brand

```
/linkedin-post [topic]          → 2 post variants to choose from
/seo-article [topic, keywords]  → Full SEO blog post (1500-2500 words)
/profile-optimize linkedin      → Optimize LinkedIn profile
/github-readme                  → Generate/improve project README
```

## Planning & Orchestration

```
/plan [describe task]           → Break into agent/skill-assigned steps
"Invoke planner to..."         → Complex multi-step planning
"Launch engineering team..."   → Parallel agent swarm
```

## Agents (for complex multi-turn work)

Use these by saying "Invoke [agent] to...":

| Agent | When to Use |
|-------|-------------|
| `ai-engineer` | Design RAG systems, prompt engineering, model selection |
| `frontend-dev` | Build React/Next.js components, pages, forms |
| `backend-infra` | APIs, databases, Docker, Terraform |
| `code-reviewer` | Full PR review across multiple files |
| `security-auditor` | Deep security audit, OWASP compliance |
| `fuzzing-agent` | Generate edge cases for API testing |
| `proposal-writer` | Multi-section proposals, SOWs, RFPs |

## Teams (for parallel swarms)

```
"Launch engineering team to build [feature]"
"Run security team audit on this codebase"
"Spin up business team for [lead pipeline]"
```

| Team | What It Does |
|------|-------------|
| engineering | Design → parallel build → test → review |
| security | Parallel scan (SAST + fuzz + deps + secrets) → review |
| full-stack | Design → parallel frontend+backend → test+security |
| business | Context → parallel content generation → review |

## Tips

- **From Telegram?** Say it naturally — "generate a standup", "review changes", "write tests for auth.ts". Don't use /slash syntax for skills — just describe what you want.
- **From terminal?** Use `/skill` syntax: `/standup-update`, `/quick-review file.ts`
- **Switch modes:** `/mode plan` before big changes, `/mode accept` for trusted work
- **Fresh start:** `/new` clears conversation context
- **Upload files:** Send screenshots, logs, or code files directly in chat
- **Complex task?** "Invoke [agent]" — multi-turn, thorough (sonnet)
- **Multiple tasks?** "Launch [team]" — parallel execution
- **Cost conscious?** Skills use haiku where possible, agents use sonnet, only planner uses opus

---
