---
name: upwork-proposal
description: Generate a tailored Upwork cover letter from a job posting. Invoke with the job posting text or URL. Auto-invoked when user says "cover letter", "upwork proposal", "apply to this job".
model: sonnet
context: fork
allowed-tools: Read, Write, WebFetch, Glob, Grep
---

Read the following job posting and write a tailored Upwork cover letter right now:

**Job posting:** $ARGUMENTS

Steps:
1. Identify the client's core pain point and what they actually need
2. Match against your expertise (AI/RAG, LLM apps, full-stack, agents, prompt engineering)
3. Write the cover letter following this structure:

**Structure (keep under 2000 characters total):**

**Hook** (2 lines) — Lead with a relevant result or insight showing you understand their problem. Never start with "I'm excited to..." or "Dear hiring manager".

**Understanding** (2-3 lines) — Show you read and understood their specific needs. Reference their tech stack if mentioned.

**Approach** (3-4 lines) — Brief technical approach. Don't over-explain.

**Proof** (2-3 lines) — Reference relevant past work with specific metrics.

**CTA** (1-2 lines) — Clear next step. Include a question to start conversation.

Tone: professional, confident, concise. Peer-to-peer, not vendor-to-client.

After the cover letter, list **2-3 questions** to ask the client.

Output the cover letter as plain text ready to paste into Upwork.
