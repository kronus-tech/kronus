# Claude Code Subagents Directory

This directory contains custom subagent definitions for the Kronus system.

## What are Subagents?

Subagents are specialized AI assistants that Claude Code automatically invokes for specific tasks. Each subagent has:
- **Custom system prompt**: Defines expertise and behavior
- **Tool permissions**: Specific tools the agent can use
- **Isolated context**: Separate context window from main agent

## File Format

Each agent is a markdown file with YAML frontmatter:

```markdown
---
name: agent-name
description: Clear description of when this agent should be invoked
tools: Read, Write, Edit  # Optional - inherits all if omitted
model: sonnet  # Optional: sonnet, opus, haiku, inherit
memory: local  # Optional: project, local, user, none
maxTurns: 20  # Optional: max agentic turns
permissionMode: default  # Optional: default, permissive, strict
---

System prompt defining the agent's role, responsibilities, and capabilities...
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Kebab-case identifier matching filename |
| `description` | Yes | When to invoke (Claude uses this for routing) |
| `tools` | No | Comma-separated tool names |
| `model` | No | sonnet, opus, haiku |
| `memory` | No | project (shared), local (agent-only), user (cross-project), none |
| `maxTurns` | No | Maximum agentic turns before stopping |
| `permissionMode` | No | default, permissive, strict |

## Agent Tiers

**Tier 1: Orchestration**
- `planner.md` - Top-level task orchestrator
- `team-lead.md` - Agent team (swarm) meta-orchestrator

**Tier 2: Memory & Context**
- `project-summarizer.md` - Compress project updates
- `memory-retriever.md` - Query past context

**Tier 3: Engineering & Development**
- `ai-engineer.md` - AI system architecture
- `test-generator.md` - Auto-generate tests
- `test-runner.md` - Execute and triage tests
- `code-reviewer.md` - PR analysis
- `frontend-dev.md` - React/Next.js development
- `backend-infra.md` - APIs, databases, IaC
- `security-auditor.md` - Security scanning
- `fuzzing-agent.md` - Fuzz testing

**Tier 4: Business & Automation**
- `proposal-writer.md` - Technical proposals
- `profile-optimizer.md` - LinkedIn/Upwork optimization
- `seo-writer.md` - Content strategy
- `meeting-notes.md` - Extract action items
- `ci-commenter.md` - CI/CD integration
- `agent-tester.md` - Agent testing & validation

## Usage

Claude Code automatically discovers and invokes subagents based on:
1. Task description in your request
2. Agent's description field
3. Current context
4. Available tools

You can also explicitly invoke: "Use the test-generator to create tests for auth.js"

## Best Practices

1. **Single responsibility**: One expertise area per agent
2. **Descriptive names**: Use kebab-case (my-agent-name)
3. **Clear descriptions**: Help Claude know when to invoke
4. **Minimal tools**: Only grant necessary permissions
5. **Detailed prompts**: Provide examples and constraints

## Total Agents

18 agents across 4 tiers:
- Tier 1: 2 agents (Orchestration)
- Tier 2: 2 agents (Memory & Context)
- Tier 3: 8 agents (Engineering & Development)
- Tier 4: 6 agents (Business & Automation)

## Created By

Kronus Build System
Generated: 2025-11-11
Updated: 2026-02-13 (v2.0 restructure: added team-lead, memory/maxTurns/permissionMode fields)
