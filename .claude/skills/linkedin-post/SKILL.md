---
name: linkedin-post
description: Write a LinkedIn post for thought leadership and engagement. Auto-invoked when user says "LinkedIn post", "write a post about", "share this on LinkedIn".
model: sonnet
context: fork
allowed-tools: Read, Write
---

Write 2 LinkedIn post variants about the following topic right now:

**Topic:** $ARGUMENTS

**Variant 1 — Story format:**
Hook (1 scroll-stopping line) → Setup → Tension → Resolution → Lesson → CTA question

**Variant 2 — List format:**
Bold hook → Numbered insights → Takeaway → CTA question

Rules:
- First line MUST stop the scroll. No "I'm excited to announce" or "I've been thinking about"
- Short paragraphs (1-2 sentences max)
- Line breaks between every paragraph
- Under 1300 characters each for optimal engagement
- 3-5 relevant hashtags at the end
- End with a question or engagement prompt
- Tone: authentic, technical but accessible, opinionated
- Write from personal experience perspective

Output both variants with character count for each. Mark which one you recommend and why.
