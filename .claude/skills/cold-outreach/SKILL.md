---
name: cold-outreach
description: Draft a personalized outreach email or LinkedIn message for a prospect. Auto-invoked when user says "outreach email", "cold email", "reach out to", "DM this person".
model: sonnet
context: fork
allowed-tools: Read, Write, Glob, Grep
---

Draft personalized outreach messages right now for:

**Prospect:** $ARGUMENTS (name, company, role, any context)

Generate three things:

## 1. Email Version (under 150 words)
- **Subject line:** Specific, curiosity-driven, no spam triggers
- **Body:** Open with specific insight about their business → identify a pain point → concrete value prop → CTA ("15-min call this week?")

## 2. LinkedIn DM Version (under 300 characters)
Shorter, more casual, still personalized. One clear ask.

## 3. Follow-Up Template (for no-reply after 3-5 days)
Short, adds new value (share an article, case study, or insight). Never just "checking in."

Tone: peer-to-peer, conversational. You're an engineer reaching out to a professional, not a salesperson pitching.
