---
name: meeting-notes
description: Extract action items, decisions, and key points from a meeting transcript. Auto-invoked when a meeting transcript is pasted or user says "meeting notes", "extract action items", "summarize this meeting".
model: haiku
context: fork
allowed-tools: Read, Write
---

Process the following meeting transcript right now and extract structured notes:

**Transcript:** $ARGUMENTS

Extract and output:

## Summary
2-4 sentence overview of what was discussed and decided.

## Key Decisions
- [ ] Decision: [what] — Rationale: [why]

## Action Items
- [ ] **[Owner]**: [task] — Due: [date] — Priority: [high/medium/low]

(Convert relative dates to absolute, e.g. "Friday" → actual date. Flag items missing owners or deadlines with "NEEDS OWNER" or "NEEDS DEADLINE".)

## Blockers
- [what's blocking] → [who's affected] → [resolution needed]

## Open Questions
- [unanswered items for follow-up]

## Next Steps
- [immediate actions, 24-48 hours]

Output as markdown ready to paste into Slack or Notion.
