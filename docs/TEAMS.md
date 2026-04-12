# Agent Teams

## Overview

Agent teams allow multiple Kronus agents to work together on complex tasks. Teams use a shared context and coordinated execution to produce comprehensive results.

## Prerequisites

Enable agent teams:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Or add to `.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## Pre-Configured Teams

### Engineering
**Agents:** planner, ai-engineer, code-reviewer, test-generator, test-runner

Best for: Feature development, architecture decisions, code quality improvements.

```bash
./scripts/kronus-team.sh --team engineering --task "Build user auth" --dir ~/myapp
```

### Security Review
**Agents:** security-auditor, fuzzing-agent, test-generator, code-reviewer

Best for: Security audits, vulnerability assessment, penetration testing.

```bash
./scripts/kronus-team.sh --team security-review --task "Audit auth system" --dir ~/myapp
```

### Full-Stack
**Agents:** planner, frontend-dev, backend-infra, test-generator, security-auditor

Best for: End-to-end feature implementation across frontend and backend.

```bash
./scripts/kronus-team.sh --team full-stack --task "Build profile page" --dir ~/myapp
```

### Business
**Agents:** proposal-writer, profile-optimizer, seo-writer, memory-retriever

Best for: Client proposals, marketing content, profile optimization.

```bash
./scripts/kronus-team.sh --team business --task "Prepare proposal for AI project"
```

## Execution Strategies

### Sequential
Agents run one after another. Each agent completes before the next starts.

```bash
./scripts/kronus-team.sh --team engineering --task "..." --strategy sequential
```

### Parallel
All agents run simultaneously. Best for independent tasks.

```bash
./scripts/kronus-team.sh --team engineering --task "..." --strategy parallel
```

### Pipeline
Shared context flows through agents in order. Each agent's output is available to the next.

```bash
./scripts/kronus-team.sh --team engineering --task "..." --strategy pipeline
```

## Custom Teams

Use `--agents` to create ad-hoc teams:

```bash
./scripts/kronus-team.sh \
  --agents security-auditor,test-runner,code-reviewer \
  --task "Quick security check" \
  --dir ~/myapp
```

## Team Configuration Files

Team configs live in `.claude/teams/` as YAML files:

```yaml
name: my-team
description: Custom team for specific workflow
agents:
  - agent-name-1
  - agent-name-2
lead: agent-name-1
strategy: sequential
use_cases:
  - "Use case description"
```

See `templates/team-template.yaml` for the full template.

## The team-lead Agent

The `team-lead` agent is a meta-orchestrator that can coordinate any team configuration. Use it in Claude Code for interactive team sessions:

```
"Invoke team-lead to coordinate the engineering team for building a payment system"
```

## Listing Teams

```bash
./scripts/kronus-team.sh --list-teams
```
