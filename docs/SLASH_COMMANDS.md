# Slash Commands

## Overview

Kronus provides 8 slash commands for common workflows. Use them in Claude Code by typing `/command-name`.

## Available Commands

### /plan
**Break down a task into agent-assigned steps.**

```
/plan Build a user notification system with email and push
```

What happens:
1. Gathers recent git activity for context
2. Invokes the **planner** agent
3. Returns task breakdown with agent assignments, dependencies, and priorities

### /review
**Run code review on recent changes.**

```
/review
/review focus on security in auth module
```

What happens:
1. Gets `git diff` of recent changes
2. Invokes **code-reviewer** on the diff
3. If auth-related files changed, also invokes **security-auditor**
4. Returns combined review with severity ratings

### /test
**Generate and run tests.**

```
/test src/api/users.ts
/test all source files missing coverage
```

What happens:
1. Invokes **test-generator** to create tests
2. Invokes **test-runner** to execute them
3. Triages any failures with root-cause analysis
4. Reports coverage and gaps

### /audit
**Run security audit pipeline.**

```
/audit
/audit focus on authentication and API endpoints
```

What happens:
1. Invokes **security-auditor** for vulnerability scanning
2. Invokes **fuzzing-agent** for adversarial input generation
3. Returns prioritized security report

### /briefing
**Generate daily project briefing.**

```
/briefing
/briefing focus on backend progress
```

What happens:
1. Invokes **memory-retriever** for recent context
2. Invokes **planner** to compile briefing
3. Returns summary of recent activity, priorities, and suggested tasks

### /propose
**Draft a client proposal.**

```
/propose AI chatbot project, $45K budget, 10 weeks
```

What happens:
1. Invokes **memory-retriever** for relevant past proposals
2. Invokes **proposal-writer** to draft complete proposal
3. Returns proposal with executive summary, technical approach, pricing, timeline

### /summarize
**Summarize recent project activity.**

```
/summarize
/summarize last 2 weeks of activity
```

What happens:
1. Gathers recent git log
2. Invokes **project-summarizer** to compress activity
3. Returns concise summary with key changes and impact

### /deploy-agents
**Deploy agents to a target directory.**

```
/deploy-agents ~/projects/myapp
/deploy-agents --dry-run ~/projects/myapp
```

What happens:
1. Runs the deploy script to copy agents, commands, and rules
2. Verifies deployment

## Creating Custom Commands

1. Create a markdown file in `.claude/commands/`:

```markdown
Your command instructions here.

Use $ARGUMENTS for user input.
Use !command for bash injection.
```

2. The filename becomes the command name (e.g., `my-command.md` → `/my-command`)
