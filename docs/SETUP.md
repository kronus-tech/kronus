# Get Started with Kronus

## The Simple Way (5 minutes)

You need three things installed: **git**, **Bun**, and **Claude Code**. If you don't have them:

| Tool | How to install |
|------|---------------|
| git | [git-scm.com](https://git-scm.com) (probably already on your computer) |
| Bun | `curl -fsSL https://bun.sh/install \| bash` |
| Claude Code | `npm install -g @anthropic-ai/claude-code` (needs an [Anthropic account](https://console.anthropic.com)) |

Then run:

```bash
git clone https://github.com/kronus-tech/kronus.git
cd kronus && ./scripts/install.sh
```

The setup asks you 5 questions: your name, what you do, how you like to work, whether you take notes, and what would be most useful. Then it sets everything up for you.

That's it. You're ready.

---

## What Happens During Setup

1. **Your name** — personalizes your AI assistant
2. **Your profession** — configures folder structure, starter notes, and suggestions tailored to your work
3. **How you work** — computer only, phone (Telegram), or both
4. **Your notes** — point to existing notes, create a new knowledge base, or auto-detect past Claude conversations
5. **Your priority** — what would help you most right now

Based on your answers, Kronus:
- Creates a knowledge base organized for your profession
- Adds starter notes with templates relevant to your work
- Sets up an AI profile that knows your preferences
- (If you chose phone) Walks you through creating a Telegram bot
- Scans your existing notes and shows your knowledge graph

---

## Using Kronus

### From Your Computer

Just run `claude` in any directory and start talking:

```
"Help me organize my research papers"
"Build me a client intake form"
"Review this contract and flag issues"
"Create a weekly report template"
```

### From Your Phone (Telegram)

If you set up Telegram during install:

1. Start Kronus: `~/.claude/daemon/scripts/kronus-daemon.sh start`
2. Find your Telegram user ID: message [@userinfobot](https://t.me/userinfobot)
3. Add your ID to `~/.claude/channels/telegram/access.json` → `allowFrom`
4. Create a Telegram group, add your bot, and send `/setup /path/to/project`
5. Start chatting — the AI works on your project

### Dashboard

The dashboard starts automatically with the daemon. Open **http://localhost:8420** to see:
- Active conversations and session status
- AI usage and costs
- Project overview

### Knowledge Graph

The knowledge graph is a separate process. Start it once after install:

```bash
cd ~/path/to/kronus/brain
bun install    # first time only
bun run start
```

Then open **http://localhost:4242** for a full-screen view of how your notes connect. You only need to start it when you want to use it — the daemon works without it.

---

## Docker Setup

If you prefer Docker:

```bash
git clone https://github.com/kronus-tech/kronus.git
cd kronus
cp config/.env.example .env    # Edit with your name and (optional) bot token
docker-compose up -d
```

Dashboard: `http://localhost:8420`
Knowledge Graph: `http://localhost:4242`

---

## Managing Kronus

```bash
# Start/stop phone access (Telegram)
~/.claude/daemon/scripts/kronus-daemon.sh start
~/.claude/daemon/scripts/kronus-daemon.sh stop
~/.claude/daemon/scripts/kronus-daemon.sh status

# Connect a new project to a Telegram group
./scripts/kronus-init.sh --group <group_id> --path /path/to/project

# Remove Kronus (keeps your notes and data)
./scripts/install.sh --uninstall
```

---

## Advanced: External Integrations

Connect to other tools by setting environment variables:

```bash
export GITHUB_TOKEN="your-github-token"       # GitHub access
export BRAVE_API_KEY="your-brave-api-key"     # Web search
export NOTION_TOKEN="your-notion-token"       # Notion pages
```

## Advanced: Manual Installation

```bash
# Install AI capabilities
cp -r .claude/agents/* ~/.claude/agents/
cp -r .claude/skills/* ~/.claude/skills/
cp -r .claude/rules/* ~/.claude/rules/

# Set up phone access (optional)
git clone https://github.com/kronus-tech/kronus ~/.claude/daemon
cd ~/.claude/daemon && bun install
cd dashboard && bun install && bun run build

# Configure Telegram (optional)
mkdir -p ~/.claude/channels/telegram/logs
cp config/.env.example ~/.claude/channels/telegram/.env
cp config/projects.example.json ~/.claude/channels/telegram/projects.json
cp config/access.example.json ~/.claude/channels/telegram/access.json
```

## Advanced: Custom Knowledge Base

Edit `~/.kronus/.env` to change where your notes are stored:

```bash
# Point to your existing notes folder
BRAIN_ROOTS=/path/to/your/notes|personal,~/.claude/projects|project

# Change the knowledge graph port
BRAIN_UI_PORT=4242
```
