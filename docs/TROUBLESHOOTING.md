# Troubleshooting: Agents Not Showing in Claude Code

## Issue: `/agents` command shows no agents

### Quick Fixes (Try These First)

#### 1. **Restart Claude Code**
   - Close Claude Code completely
   - Reopen it in the `kronus` directory
   - Try `/agents` again

#### 2. **Verify Directory**
   Make sure Claude Code is running in the correct directory:
   ```bash
   pwd
   # Should show the path to your kronus installation
   ```

#### 3. **Check Agent Files Exist**
   ```bash
   ls -la .claude/agents/
   # Should show 16 .md files (plus README.md)
   ```

#### 4. **Test with Simple Agent**
   Try invoking directly instead of using `/agents`:
   ```
   "Invoke planner to help me plan my day"
   ```

---

## Detailed Debugging Steps

### Step 1: Verify File Structure

Run this command:
```bash
find .claude/agents -name "*.md" -type f | grep -v README
```

**Expected output:** List of 16 agent files

**Your output:**
```bash
# Run the command above and paste output here
```

---

### Step 2: Check YAML Frontmatter

Run this to check if YAML is valid:
```bash
head -7 .claude/agents/planner.md
```

**Expected output:**
```yaml
---
name: planner
description: Top-level orchestrator...
tools: Read, Write, Task, Glob, Grep
model: sonnet
---
```

**Your output:**
```bash
# Run the command above and paste output here
```

---

### Step 3: Check Permissions

```bash
ls -l .claude/agents/*.md | head -5
```

All files should be readable (`-rw-r--r--`).

---

### Step 4: Test Direct Invocation

In Claude Code, try:
```
"Invoke planner to create a plan for building a todo app"
```

**Does this work?**
- ✅ **Yes** → Agents are working! `/agents` command might just not show them in UI
- ❌ **No** → Continue to Step 5

---

### Step 5: Check Claude Code Version

Make sure you have the latest Claude Code:
- Go to https://claude.ai/claude-code
- Check for updates
- Claude Code should be version 0.5+ (subagent support)

---

### Step 6: Manual Agent Registration (Fallback)

If agents still don't work, you can use the **Task tool** directly:

Instead of:
```
"Invoke planner to..."
```

Try:
```
"Use the Task tool to launch the planner agent with this prompt: [your task]"
```

---

## Common Issues & Solutions

### Issue: "Agent not found"

**Cause:** YAML frontmatter might have syntax error

**Fix:**
1. Check for proper YAML formatting (no tabs, correct indentation)
2. Ensure `name` field exactly matches filename (without .md)
3. Run: `head -10 .claude/agents/planner.md` to verify

---

### Issue: `/agents` command doesn't exist

**Cause:** Older Claude Code version

**Solution:**
- Update Claude Code to latest version
- Use direct invocation: `"Invoke agent-name to..."`

---

### Issue: Agents work but don't show in `/agents` list

**Not a problem!** The `/agents` command UI might not populate, but if you can invoke agents directly, they're working fine.

**Test it:**
```
"Invoke ai-engineer to explain RAG systems"
```

If this works, your agents are functional!

---

## Alternative: Test in Different Directory

If agents still don't work, try this test:

1. **Create a test directory:**
   ```bash
   mkdir -p ~/test-agents/.claude/agents
   ```

2. **Copy one agent:**
   ```bash
   cp .claude/agents/planner.md ~/test-agents/.claude/agents/
   ```

3. **Open Claude Code in test directory:**
   ```bash
   cd ~/test-agents
   # Open Claude Code here
   ```

4. **Test:**
   ```
   "Invoke planner to plan my day"
   ```

If this works, the agents are fine - there might be a directory-specific issue.

---

## Still Not Working?

### Check These:

1. **File encoding:** Files should be UTF-8
   ```bash
   file .claude/agents/planner.md
   # Should say: UTF-8 Unicode text
   ```

2. **No hidden characters:**
   ```bash
   cat -A .claude/agents/planner.md | head -10
   # Should show clean YAML
   ```

3. **Correct line endings:** (Unix LF, not Windows CRLF)
   ```bash
   file .claude/agents/planner.md
   # Should NOT say "with CRLF line terminators"
   ```

---

## Workaround: Use Task Tool Directly

If you can't get agents to auto-discover, you can still use them via Task tool:

**Instead of this:**
```
"Invoke planner to build a feature"
```

**Use this:**
```
"Use the Task tool with subagent_type='general-purpose' and this prompt:
'Act as the planner agent from .claude/agents/planner.md and help me build a feature...'"
```

Then manually read the agent file:
```
"Read .claude/agents/planner.md and follow its instructions to plan my task"
```

---

## Verification Checklist

Before asking for help, verify:

- [ ] Claude Code is running in your kronus installation directory
- [ ] Directory `.claude/agents/` exists
- [ ] 16 agent `.md` files exist (not counting README.md)
- [ ] Files have correct YAML frontmatter (---name:...---)
- [ ] Files are readable (check with `ls -l`)
- [ ] Tried restarting Claude Code
- [ ] Tried direct invocation: `"Invoke planner to..."`
- [ ] Claude Code is up to date

---

## Success Test

Run this exact test:

```
"Invoke planner to create a simple plan for making dinner tonight"
```

**If this works:** ✅ Your agents are functional!

**If this doesn't work:** Share the error message and we'll debug further.

---

## Getting Help

If none of this works:

1. **Capture error message:** Screenshot or copy the exact error
2. **Check Claude Code docs:** https://docs.claude.com/claude-code
3. **File an issue:** Include:
   - Error message
   - Output of: `ls -la .claude/agents/`
   - Output of: `head -10 .claude/agents/planner.md`
   - Claude Code version

---

## Expected Behavior

When working correctly:

1. **Direct invocation works:**
   ```
   "Invoke planner to plan my day"
   → Planner agent responds with task breakdown
   ```

2. **Agents are context-aware:**
   ```
   "Invoke ai-engineer to design a RAG system"
   → ai-engineer provides architecture recommendations
   ```

3. **Multi-agent workflows possible:**
   ```
   "Invoke planner to build a feature, then have planner dispatch to other agents"
   → Planner coordinates multiple agents
   ```

---

**Note:** The `/agents` UI command is nice-to-have, but not required. As long as `"Invoke agent-name to..."` works, your agents are fully functional!
