# Personas

Kronus supports per-project personas — different personalities for different Telegram groups.

## How It Works

A persona is a `.claude/rules/persona.md` file in the project directory. Claude Code reads it automatically on every session. The daemon just provides tooling to create and manage these files.

## Creating a Persona

### From Telegram
```
/persona set Dobby
```
Interactive 3-step setup:
1. **Style** — professional / casual / sassy / custom
2. **Language** — English / Hindi-English / Urdu-English / custom
3. **Responsibilities** — comma-separated list (e.g., "track plans, code review, brainstorm")

### From Dashboard
Navigate to `http://localhost:8420/personas`:
1. Click a project card
2. Click "Create Persona"
3. Fill in name, style, language, responsibilities
4. Click "Create"

### Manually
Create `.claude/rules/persona.md` in your project directory with the persona content.

## Managing Personas

| Command | What |
|---------|------|
| `/persona` | View current persona |
| `/persona set <name>` | Create/update persona |
| `/persona edit` | Modify existing persona |
| `/persona clear` | Remove persona |

## Persona Template

The generated persona includes:

- **Who You Are** — name and personality description
- **Your Voice** — tone, language, behavior rules
- **Privacy & Access** — isolation rules (what stays in this project)
- **Output Rules** — conversational vs structured output

## Privacy Isolation

Each persona is scoped to its project directory:
- Memory and context live only in that project
- Other personas are private — they don't exist in each other's world
- Conversations in one group never leak to another
- The scope guard enforces file-level isolation

## Examples

### Professional (Dobby)
- Clear, structured, business-appropriate
- Direct communication without unnecessary formality
- Leads with business outcomes

### Casual (Chotu - Yolo)
- Witty, sharp, English-first
- Tracks plans, holds people accountable
- Meme-literate, concise

### Sassy (Chotu - Friend Group)
- Sweet with bite, Urdu-English mix
- Mediates, jokes, roasts lovingly
- Proactive recall of past conversations

## Persona + CLAUDE.md

If a project already has persona content in `CLAUDE.md`, Kronus detects it automatically. You can either:
- Keep it in `CLAUDE.md` (works fine)
- Use `/persona set` to create a standard `persona.md` (recommended for new projects)

Both are read by Claude Code. The `persona.md` approach keeps persona separate from project technical docs.
