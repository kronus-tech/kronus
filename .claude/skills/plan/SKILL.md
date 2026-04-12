---
name: plan
description: Break down a task into agent-assigned steps with dependencies and priorities. Invoke with a high-level task description.
model: opus
context: fork
allowed-tools: Read, Write, Glob, Grep
agent: planner
---

Break down the following task into actionable steps right now:

**Task:** $ARGUMENTS

For each step, specify:
- Step ID (T001, T002, etc.)
- Description (clear, actionable)
- Handler: `agent:name` or `skill:name` from the v4.0 roster
- Priority: high/medium/low
- Dependencies (which steps must complete first)
- Parallel group (steps that can run simultaneously)
- Estimated duration

**Available agents:** planner, team-lead, ai-engineer, frontend-dev, backend-infra, code-reviewer, security-auditor, fuzzing-agent, proposal-writer, memory-retriever

**Available skills:** test-gen, test-run, ci-comment, quick-review, upwork-proposal, lead-qualify, cold-outreach, invoice-gen, seo-article, profile-optimize, linkedin-post, case-study, github-readme, meeting-notes, daily-briefing, project-summary, standup-update, dep-check, secret-scan

Maximize parallel execution. Use skills for simple tasks, agents for complex multi-turn work.
