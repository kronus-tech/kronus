# Contributing to Kronus

Thank you for your interest in contributing to Kronus! This guide will help you add new agents, improve existing ones, and maintain code quality.

---

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Agent Development Guide](#agent-development-guide)
- [Agent Template](#agent-template)
- [Best Practices](#best-practices)
- [Testing Your Agent](#testing-your-agent)
- [Submitting Changes](#submitting-changes)

---

## 🚀 Getting Started

### Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- Git for version control
- Text editor (VS Code, Cursor, etc.)
- Basic understanding of AI agents and prompts

### Development Setup

1. **Fork the repository**:
   ```bash
   git clone https://github.com/kronus-tech/kronus.git
   cd kronus
   ```

2. **Create a branch**:
   ```bash
   git checkout -b feature/your-agent-name
   ```

3. **Make your changes** and test with Claude Code

---

## 🛠️ Agent Development Guide

### Agent File Structure

All agents live in `.claude/agents/` and use this format:

```markdown
---
name: agent-name
description: Clear description of when to invoke this agent
tools: Read, Write, Glob, Grep
model: sonnet
---

System prompt defining agent's role and capabilities...

## Core Responsibilities
- Bullet point list of what agent does

## Output Format
```json
{
  "agent": "agent-name",
  "summary": "Brief description",
  ...
}
```

## Example 1: Title
**User Request:** "..."
**Output:** ...

[Include 3-5 detailed examples]
```

### YAML Frontmatter Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | ✅ Yes | string | Kebab-case unique identifier |
| `description` | ✅ Yes | string | When to invoke this agent (Claude uses this!) |
| `tools` | ❌ No | string | Comma-separated tool names |
| `model` | ❌ No | string | sonnet (default), opus, haiku |
| `memory` | ❌ No | string | project, local, user, none |
| `maxTurns` | ❌ No | integer | Max agentic turns before stopping |
| `permissionMode` | ❌ No | string | default, permissive, strict |

#### Memory Modes
- **project** — Shared memory across agents in this project
- **local** — Agent-specific memory, not shared with other agents
- **user** — Persistent across projects for user-specific context
- **none** — No memory persistence (default if not specified)

### Available Tools

- **Read**: Read files from filesystem
- **Write**: Create new files (prefer Edit for existing files)
- **Edit**: Modify existing files
- **Glob**: Find files by pattern (e.g., `**/*.ts`)
- **Grep**: Search file contents with regex
- **Bash**: Execute shell commands (⚠️ USE SPARINGLY - requires security policy)
- **Task**: Launch other agents
- **WebFetch**: Fetch web content
- **WebSearch**: Search the web

**⚠️ Bash Access**: Only grant Bash if absolutely necessary. If you do, include explicit security policy:

```markdown
## Bash Usage Policy 🔒 SECURITY CRITICAL

**ALLOWED Bash Commands:**
- `npm test` - Run tests only

**FORBIDDEN Bash Commands:**
- `rm`, `mv` - Destructive operations
- `npm install` - Package installation
- `curl`, `wget` - Network operations
```

---

## 📝 Agent Template

Use this template for new agents:

```markdown
---
name: your-agent-name
description: One-sentence description of when to invoke this agent
tools: Read, Write, Glob, Grep
model: sonnet
---

You are the [Agent Name] agent for Kronus, specializing in [specialization].

## Core Responsibilities

- Responsibility 1
- Responsibility 2
- Responsibility 3

## Output Format

Always return structured JSON:

\`\`\`json
{
  "agent": "your-agent-name",
  "summary": "Brief description of what was done",
  "artifact": {
    "type": "type_of_output",
    "details": "..."
  },
  "recommendations": [
    "Actionable suggestions"
  ]
}
\`\`\`

## Tool Usage

- **Read**: When to use Read tool
- **Write**: When to use Write tool
- **Glob**: When to use Glob tool
- **Grep**: When to use Grep tool

## Constraints

- **DO NOT** use Bash (or document security policy if needed)
- **DO** use specific, actionable language
- **DO** include examples with complete code
- **DO** return structured JSON output

---

## Example 1: [Descriptive Title]

**User Request:** "Clear user request"

**Analysis:**
- What the agent needs to understand
- Key decisions to make

**Output:**

\`\`\`json
{
  "agent": "your-agent-name",
  "summary": "What was accomplished",
  ...
}
\`\`\`

**[Optional: Files Created, Commands Run, etc.]**

---

## Example 2: [Another Example]

[Repeat example structure]

---

## Example 3: [Third Example]

[At least 3 examples total]

---

## Integration with Other Agents

- **Invoke agent-name** for related task A
- **Invoke another-agent** for related task B

## Best Practices Summary

1. Best practice 1
2. Best practice 2
3. ...
```

---

## ✅ Best Practices

### Writing Agent Prompts

1. **Be Specific**: "Design a RAG system" not "Help with AI"
2. **Include Context**: Reference your expertise and relevant past projects
3. **Structured Output**: Always return JSON with consistent schema
4. **Examples Matter**: 3-5 detailed, realistic examples
5. **Error Handling**: Show what agent does when things go wrong

### Output Format Standards

```json
{
  "agent": "agent-name",          // REQUIRED: Agent identifier
  "summary": "Brief description",  // REQUIRED: 1-2 sentence summary
  "artifact": {                    // Optional: Main output
    "type": "type_name",
    "content": "..."
  },
  "next_steps": [...],            // Optional: Follow-up actions
  "recommendations": [...]         // Optional: Suggestions
}
```

### Tool Usage Guidelines

- **Prefer Read over Bash**: `Read file.ts` not `cat file.ts`
- **Prefer Glob over ls**: `Glob **/*.js` not `ls -R`
- **Prefer Grep over grep**: `Grep "pattern"` not `grep -r`
- **Use Edit for modifications**: Don't Read + Write, use Edit
- **Minimize Bash**: Only when absolutely necessary

### Example Quality

**Bad Example** ❌:
```markdown
## Example 1: Do something
User: "Do the thing"
Agent: "OK, I did it"
```

**Good Example** ✅:
```markdown
## Example 1: Design RAG System for Customer Support

**User Request:** "Design a RAG system for customer support chatbot handling 10K documents with < 2s response time"

**Analysis:**
- Need vector database for semantic search
- 10K docs ≈ 50K chunks (500 tokens each)
- 2s latency budget: embed (0.1s) + retrieve (0.5s) + LLM (1.0s) + overhead (0.4s)

**Output:**
\`\`\`json
{
  "agent": "ai-engineer",
  "summary": "Designed RAG system with Pinecone vector DB and Claude 3.5 Sonnet, estimated $500/month",
  "architecture": {
    "vector_db": "Pinecone",
    "embedding_model": "text-embedding-3-large",
    "llm": "claude-3-5-sonnet",
    "chunk_size": 500,
    "chunk_overlap": 50
  },
  "cost_estimate": {
    "embeddings": "$100/month",
    "vector_db": "$70/month",
    "llm_calls": "$300/month",
    "total": "$470/month"
  }
}
\`\`\`
```

---

## 🧪 Testing Your Agent

### Manual Testing

1. **Save your agent**: Place in `.claude/agents/your-agent.md`

2. **Open Claude Code** in the project directory

3. **Test invocation**:
   ```
   "Invoke your-agent-name to [do something specific]"
   ```

4. **Verify**:
   - ✅ Agent is discovered by Claude Code
   - ✅ Agent responds appropriately
   - ✅ Output is structured JSON
   - ✅ Examples are realistic and helpful

### Validation Checklist

Before submitting, verify:

- [ ] YAML frontmatter is valid
- [ ] `name` field matches filename (kebab-case)
- [ ] `description` clearly explains when to invoke
- [ ] At least 3 detailed examples provided
- [ ] JSON output format is documented
- [ ] Tool usage is appropriate
- [ ] Bash access has security policy (if used)
- [ ] No typos or formatting errors
- [ ] Agent provides value (doesn't duplicate existing agents)

---

## 📤 Submitting Changes

### Pull Request Process

1. **Commit your changes**:
   ```bash
   git add .claude/agents/your-agent.md
   git commit -m "Add your-agent for [purpose]"
   ```

2. **Push to your fork**:
   ```bash
   git push origin feature/your-agent-name
   ```

3. **Create Pull Request** with:
   - **Title**: "Add [agent-name] agent for [purpose]"
   - **Description**:
     ```markdown
     ## Agent: your-agent-name

     **Purpose**: Brief description

     **Capabilities**:
     - Capability 1
     - Capability 2

     **Examples Included**: 3

     **Bash Access**: No (or Yes with policy)

     **Testing**: Tested with Claude Code on [scenarios]
     ```

4. **Review Process**:
   - Maintainer reviews agent quality
   - May request changes or improvements
   - Once approved, agent is merged!

### Commit Message Guidelines

- Use present tense: "Add agent" not "Added agent"
- Be specific: "Add RAG optimization agent" not "Add new agent"
- Reference issues: "Fix #123: Update test-generator examples"

---

## Creating Slash Commands

Slash commands live in `.claude/commands/` as markdown files.

1. Create a file: `.claude/commands/my-command.md`
2. The filename becomes the command: `/my-command`
3. Use `$ARGUMENTS` for user input
4. Use `!command` for bash injection

Example:
```markdown
Analyze the codebase for $ARGUMENTS.

Recent changes:
\`\`\`
!git log --oneline -5
\`\`\`

Instructions:
1. Invoke the **code-reviewer** agent
2. Focus on: $ARGUMENTS
```

## Writing Hooks

Hook scripts live in `scripts/hooks/` and are referenced in `.claude/settings.json`.

1. Create a script: `scripts/hooks/my-hook.sh`
2. Make it executable: `chmod +x scripts/hooks/my-hook.sh`
3. Read tool input from stdin
4. Exit 0 to allow, exit 2 to block
5. Register in `.claude/settings.json` under `hooks.PreToolUse` or `hooks.PostToolUse`

See [HOOKS.md](./docs/HOOKS.md) for details.

---

## 🎯 What to Contribute

### High-Value Contributions

We especially welcome:

✅ **New Agents** for common use cases:
- DevOps/infrastructure agents
- Data science/ML agents
- Content creation agents
- Project management agents

✅ **Improved Examples** for existing agents:
- More realistic scenarios
- Edge case handling
- Error recovery examples

✅ **Documentation**:
- Tutorial videos
- Blog posts
- Architecture diagrams

✅ **Bug Fixes**:
- Incorrect examples
- Outdated information
- Formatting issues

### Before Creating a New Agent

Check if existing agents can handle the use case:
- Can `planner` orchestrate existing agents to accomplish this?
- Does this overlap significantly with an existing agent?
- Is this specific enough to warrant a dedicated agent?

---

## 📚 Resources

- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Anthropic Prompt Engineering Guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering)
- [Kronus Docs](https://github.com/kronus-tech/docs)

---

## 💬 Questions?

- **Issues**: [GitHub Issues](https://github.com/kronus-tech/kronus/issues)
- **Discussions**: [GitHub Discussions](https://github.com/kronus-tech/kronus/discussions)

---

## 🙏 Thank You!

Every contribution helps make Kronus better for the community. We appreciate your time and effort!

---

**Happy Agent Building! 🤖**
