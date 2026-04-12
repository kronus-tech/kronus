---
name: github-readme
description: Generate or improve a project README.md for open-source presence and GitHub visibility. Auto-invoked when user says "write readme", "improve readme", "github readme".
model: sonnet
context: fork
allowed-tools: Read, Write, Glob, Grep
---

Generate a professional README for this project right now.

Target: $ARGUMENTS (project path, defaults to current directory)

Steps:
1. Read package.json/pyproject.toml/Cargo.toml for project metadata
2. Scan the source directory structure
3. Understand the project's purpose, tech stack, and features

Write a README with these sections:
1. **Title + one-line description**
2. **Badges** (build, coverage, license, version — use shields.io format)
3. **Features** — Key capabilities as bullet points
4. **Quick Start** — Install + basic usage, must work with copy-paste
5. **Usage Examples** — 2-3 common use cases with code blocks
6. **Architecture** — Brief overview for contributors
7. **API Reference** — If applicable
8. **Contributing** — How to contribute
9. **License**

Make it scannable: heavy headings, code blocks, tables. Optimize title/description for GitHub search.
