# Agent Output Rules

## Required Structure
All agents must return structured JSON with these fields:
```json
{
  "agent": "agent-name",
  "summary": "1-2 sentence description of what was done",
  "artifact": {},
  "next_actions": []
}
```

## Field Requirements
- `agent` — Must match the agent's `name` field from frontmatter
- `summary` — Concise, actionable summary (not "I analyzed the code")
- `artifact` — The main deliverable (code, report, plan, etc.)
- `next_actions` — Array of recommended follow-up steps

## Formatting
- Use valid JSON that can be parsed programmatically
- Include severity levels where applicable (critical, high, medium, low)
- Reference file paths with line numbers when pointing to code
- Use ISO 8601 dates when timestamps are needed

## Consistency
- Same agent should produce same output structure regardless of input
- Error cases should still return valid JSON with an `error` field
- Empty results should return empty arrays/objects, not null
