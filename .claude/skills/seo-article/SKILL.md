---
name: seo-article
description: Write an SEO-optimized technical blog post or article. Invoke with topic, target keywords, and optional word count. Auto-invoked when user says "write article", "blog post about", "write content about".
model: sonnet
context: fork
allowed-tools: Read, Write, Glob, Grep, WebSearch
---

Write an SEO-optimized article right now:

**Topic and keywords:** $ARGUMENTS

Steps:
1. Define primary keyword and 3-5 secondary keywords
2. Write the full article (1500-2500 words) with this structure:
   - **Title (H1):** Include primary keyword, under 60 chars
   - **Meta description:** 150-155 chars with keyword and benefit
   - **Intro:** Hook with surprising stat or contrarian take
   - **H2/H3 sections:** Logical flow, keyword-rich headings
   - **Code examples** where relevant
   - **Conclusion:** Key takeaways + CTA
3. Follow SEO rules: keyword density 1-1.5%, short paragraphs, bullet points, internal/external link suggestions

Output the full article in markdown, followed by:
- Meta title
- Meta description
- URL slug
- Target keywords
- Word count
- Heading count
