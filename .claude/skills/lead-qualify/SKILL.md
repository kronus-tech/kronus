---
name: lead-qualify
description: Score and qualify an inbound lead based on budget, timeline, technical fit, and engagement signals. Auto-invoked when user says "qualify this lead", "score this lead", "is this worth pursuing".
model: haiku
context: fork
allowed-tools: Read, Write
---

Analyze the following lead and score it right now:

**Lead info:** $ARGUMENTS

Score on these 5 criteria (1-10 each):

| Criteria | Weight | Score | Reasoning |
|----------|--------|-------|-----------|
| Technical fit (AI/RAG/full-stack match) | 30% | ? | |
| Budget (realistic for scope) | 25% | ? | |
| Client quality (communication, clarity, hire history) | 20% | ? | |
| Timeline (feasible delivery) | 15% | ? | |
| Growth potential (repeat work, referrals, portfolio) | 10% | ? | |

**Overall:** weighted average

**Verdict:**
- Hot (8+): Apply immediately
- Warm (6-7.9): Worth pursuing
- Cold (below 6): Skip or low-effort

Then provide:
- Recommended response approach
- Key questions to ask the client
- Red flags (if any)
- Estimated effort to complete the work
