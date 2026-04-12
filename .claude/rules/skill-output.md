# Skill Output Rules

## Output Format for Skills

Skills return **markdown** by default (not JSON like agents), unless the skill is chaining to another agent/skill that needs structured input.

### Standard Skill Output
- Lead with the deliverable (the content, code, or analysis)
- Follow with a brief summary of what was produced
- End with suggested next actions if applicable

### When to Use JSON Instead
- When the skill output feeds into another agent (e.g., lead-qualify → upwork-proposal)
- When the output needs programmatic parsing (CI comments, test results)
- When explicitly requested by the user

### Quality Standards
- Be concise — skills are for quick workflows, not essays
- Include file paths with line numbers when referencing code
- Use severity levels where applicable (critical, high, medium, low)
- Provide actionable recommendations, not vague suggestions

### Content Skills (articles, posts, proposals)
- Always provide the full content ready to use
- Include metadata (word count, keywords, character count where relevant)
- Provide 2 variants when generating creative content (posts, headlines)

### Analysis Skills (reviews, scans, audits)
- Categorize findings by severity
- Include specific file:line references
- Provide fix suggestions, not just problem identification
- Flag false positives explicitly
