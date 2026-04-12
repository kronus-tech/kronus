---
name: profile-optimize
description: Optimize LinkedIn, Upwork, or GitHub profile sections for visibility and client conversion. Auto-invoked when user says "optimize my profile", "improve my headline", "update my bio".
model: sonnet
context: fork
allowed-tools: Read, Write, Glob, Grep
---

Optimize the profile right now:

**Input:** $ARGUMENTS (platform: linkedin/upwork/github, and section: headline/summary/all, plus current content if provided)

For **LinkedIn:**
- Headline (120 chars): seniority + specialty + value prop + 2-3 keywords
- Summary: Hook (first 2 visible lines) → Expertise → Proof (metrics) → CTA
- Experience bullets: start with numbers and achievements

For **Upwork:**
- Title: client-focused, keyword-rich
- Overview: Hook → Differentiation → Services → Proof → CTA (under 2000 chars)
- Portfolio descriptions with before/after metrics

For **GitHub:**
- Bio: specialty + what you build
- Profile README suggestions
- Repo descriptions: keyword-optimized

Output: before/after comparison (if current content provided), 2 alternative headline options, keyword strategy, and platform-specific recommendations.
