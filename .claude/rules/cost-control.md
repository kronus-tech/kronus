# Cost Control Rules

## Model Routing

Route tasks to the cheapest model that can handle them well:

### Haiku (fast, cheap) — Use for:
- Text extraction and formatting (meeting notes, CI comments, standup updates)
- Pattern matching and scanning (secret scan, dependency check)
- Lead qualification scoring
- Invoice generation
- Project summaries from git log

### Sonnet (balanced) — Use for:
- Code implementation and review
- Test generation and execution
- Content writing (articles, posts, proposals)
- Profile optimization
- Architecture analysis
- Security auditing

### Opus (expensive, powerful) — Use ONLY for:
- Task orchestration and planning (planner agent)
- Agent team coordination (team-lead agent)
- Complex multi-step reasoning across many files
- Never for formatting, extraction, or simple generation

## Cost Guidelines

- Prefer skills over agents when the task is template-driven
- Use parallel execution to reduce wall-clock time (not token cost)
- Cache and reuse context — don't re-read files unnecessarily
- For content generation, generate once and iterate — don't regenerate from scratch
- Monitor token usage with /cost command
