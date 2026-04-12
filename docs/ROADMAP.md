# Kronus Roadmap

## v4.0 — Complete
- 10 agents + 24 skills + 9 MCP servers + 4 teams
- Telegram channel with pairing and allowlist
- Global install with second-brain PARA structure
- Directive skill instructions that execute instead of describe

## v4.1 — Telegram as Full Control Plane ✅

### Multi-Project Routing via Group Chats ✅
- Node.js/Bun daemon (`daemon/`) manages per-project Claude Code sessions
- Telegram groups mapped to project directories via `~/.claude/channels/telegram/projects.json`
- `kronus-init.sh` registers projects with `--group <id>`
- `kronus-daemon.sh` manages daemon lifecycle (start/stop/status/logs)
- Session continuity via `claude -p --resume $session_id --output-format stream-json`

### Interactive Prompts via Telegram ✅
- Claude's AskUserQuestion prompts forwarded to Telegram as inline keyboard buttons
- MCQ questions rendered with A/B/C/D buttons
- Yes/No questions rendered with two buttons
- Free-text questions sent as regular messages
- 2-minute timeout with automatic fallback
- Replaced PTY parsing approach with headless stream-json (more reliable)

### Reduce Approval Friction ✅
- Expanded `permissions.allow` with 30+ safe command patterns
- Per-project permission profiles in `projects.json` (allowedTools, permissionMode)
- `pre-bash-check.sh` hook blocks dangerous operations as defense in depth
- Default permissionMode is `"default"` — opt into `"acceptEdits"` per project

## v4.2 — Frictionless Setup + Business Automation

### Bot Commands for Session Control ✅ (implemented in v4.1)
- `/mode`, `/new`, `/stop`, `/resume`, `/sessions`, `/status`, `/trust`, `/help`
- Photo and document upload support
- Implemented in `daemon/src/telegram-router.ts`

### Merge v4 → main
- Verify stability after Telegram testing
- Merge v4 branch into main
- Tag v4.1.0 release

## v4.2 — Onboarding, Session Intelligence & Collaborator Mode ✅

### Easy Project Onboarding from Existing Terminal Sessions ✅
- `/setup` command in a new Telegram group
- Daemon scans running `claude` processes on the system, shows their cwds
- User picks which terminal session to connect: `/setup 1` (by index) or `/setup /path/to/project`
- Auto-registers the group in access.json + projects.json in one step
- `/setup` creator auto-becomes group admin
- If sessions exist on disk, grabs the most recent session_id for `--resume`

### Full Session Management from Telegram ✅
- `/sessions` shows daemon sessions + terminal processes + recent disk sessions
- `/resume <session_id>` attaches to ANY Claude session (terminal or daemon)
- `/switch <session_id>` changes which session this group talks to without starting fresh
- `/history` shows past session IDs for this group (stored in session-history.json)
- Session IDs displayed as short 8-char IDs for easy copy-paste
- Disk session discovery: reads `~/.claude/projects/<mangled-path>/` for `.jsonl` files

### Collaborator Mode (Multi-User Groups) ✅
- Auto-activates when group has >2 members (user + bot + others)
- In collaborator mode: only `/c <message>` forwarded to Claude
- Regular messages are human-to-human chat (bot ignores them)
- `/c` with a reply → sends the replied message + additional text to Claude
- Bot shows typing indicator while Claude is working
- `/collab list/add/remove` for access control
- `/collab on/off/auto` for explicit mode control
- New collaborator approval flow via inline keyboard buttons
- Global `allowFrom` users are always admins across all groups

### UX Improvements ✅
- `/menu` — interactive command menu with emoji inline buttons
- `/setup` pins a quick-start intro message to the group
- Markdown formatting for responses (with plain text fallback)
- Session persistence across daemon restarts
- Transcripts saved to disk for review
- Auto-commit + push after each session

### Daemon Separation ✅ (stability fix)
- Daemon moved to separate repo: `github.com/kronus-tech/kronus`
- Installed at `~/.claude/daemon/` — isolated from project code
- Prevents self-modification: Claude sessions can't edit daemon source
- See `docs/v4.1-youtube-content.md` for the full story

### New Files
- `daemon/src/session-discovery.ts` — Disk/terminal session scanning, session history
- `daemon/src/collaborator.ts` — Collaborator mode logic, approval flow, member count caching

## v4.3 — Persistent Sessions & Permission Forwarding ✅

### Persistent Claude Sessions ✅
- One long-running Claude process per group via `--input-format stream-json`
- Messages sent via stdin NDJSON, responses read continuously
- Auto-restart on process death, falls back gracefully
- Session state lives in running process — no `--resume` needed within session

### Permission Forwarding ✅
- Detects `permission_denials` in result events
- Shows Approve / Always Allow / Deny buttons in Telegram
- Deduplicated, bash-only (non-bash tools auto-allowed)
- "Always Allow" persists to projects.json

### Formatting & UX Fixes ✅
- Fixed double HTML conversion (persistent-session → router)
- Fixed nested bold tags in headings
- Added table conversion for Telegram
- `[TELEGRAM MODE]` prefix for self-contained responses
- `registerProject` defaults: Bash + acceptEdits for all new projects

### Streaming ⚠️ (CLI limitation)
- Claude CLI sends full content blocks, not token-level deltas
- Real-time text streaming not possible with current `--input-format stream-json`
- Workaround: typing indicator + tool use status updates (📖 ✏️ 🔧 🔍 🤖)

### Google Drive Module (built, needs GCP setup to test)
- `google-drive.ts` — service account auth, upload, share
- `/drive <file>` and `/share <file> <email>` commands ready
- Mirrors local paths to Kronus/ folder in Drive

## v4.4 — Personas, Scope Guard & Dashboard Skeleton ✅

### Per-Project Persona System ✅
- `/persona set <name>` — interactive 3-step setup (style → language → responsibilities)
- `/persona edit`, `/persona clear`, `/persona` (view status)
- Generates `.claude/rules/persona.md` — Claude reads it automatically
- Persona step integrated into `/setup` flow (skippable)
- Persona shown in `/status`, `/help`, `/menu`
- Auto-detects existing personas in CLAUDE.md (chotu, yolo)
- Privacy isolation: each persona scoped to project directory

### Scope Guard ✅
- PreToolUse hook blocks Read/Glob/Grep/Edit/Write outside project directory
- File-based IPC: hook writes approval request, polls for decision (120s timeout)
- Daemon watches approval dir, sends Telegram inline buttons to admin DM
- Three options: Approve Once / Always Allow Dir / Deny
- Per-project allowlist: `.claude/scope-allowlist.json`
- Only activates in daemon mode — terminal sessions unaffected
- Case-insensitive path matching for macOS APFS

### Dashboard Skeleton ✅
- React + Tailwind, black/white minimalist design
- Served by daemon on localhost:8420
- Pages: Overview, Sessions, Projects, Logs
- API endpoints: /api/status, /api/sessions, /api/projects, /api/access, /api/logs, /api/transcripts
- Project config editor (permissionMode, allowedTools)
- Session controls (stop, reset)

### Inline Photo/Document Delivery ✅
- Auto-detects image files written by Claude (Write tool_use tracking)
- Also regex-matches file paths in response text
- Sends .png/.jpg/.webp as inline photos, other files as documents
- onFileSend callback properly wired through SessionManager → PersistentSession

### Bug Fixes ✅
- Fixed migration handler swallowing all bot commands (missing `next()`)
- Debug logging for gate rejections and collaborator mode ignores
- Case-insensitive scope guard for macOS filesystem

### Google Drive Module (built, needs GCP setup to test)
- `google-drive.ts` — service account auth, upload, share
- `/drive <file>` and `/share <file> <email>` commands ready

## v5.0 — Personal AI + Dashboard + Open Source ✅

### Phase 1: Personal Kronus DM ✅
- Personal DM session mapped to ~/second-brain/kronus/ with Kronus persona
- Cross-session memory: decisions, todos, people, state extracted from every turn
- Memory stored in JSONL files, injected into system prompts on session start
- Daily briefing at 9am local time (configurable) + /briefing on-demand
- Admin commands: /projects, /todos, /approve, /journal, /briefing
- Personal journal: auto-saved DM conversations with keyword search

### Phase 2: Dashboard v2 ✅
- 8 pages: Overview, Sessions, Session Detail, Projects, Personas, Security, Costs, Logs
- Live session viewer with SSE real-time activity feed
- Persona manager: create/edit/preview/delete from dashboard
- Scope & security panel: approve/deny from dashboard, audit history, allowlist editor
- Cost tracking: per-project token usage, daily bar chart
- Nav bar: live uptime badge, today's cost, pending approval count, v5.0 version

### Phase 3: Open Source Release ✅
- install.sh wizard: interactive setup (name, bot token, deps check, install all)
- Docker: Dockerfile (multi-stage) + docker-compose.yml with named volumes
- Config templates: .env.example, projects.example.json, access.example.json
- Zero hardcoded paths: all use homedir(), dynamic API home field
- Full docs: README, SETUP, PERSONAS, SECURITY, DASHBOARD (30+ API endpoints)

## v6.0 — Claude Code as a Service

### Remote/Server Deployment
- Run the daemon + Claude Code on a remote server (VPS/cloud)
- No local Mac required — Telegram talks to a server running Claude
- Persistent sessions that survive laptop sleep/shutdown
- SSH key management for git operations on the server
- Project syncing: git clone on server, push results back
- Auth: Telegram access control is the auth layer
- Cost: track API usage per project for client billing
- Multi-user: multiple people can use the same server instance
- Deploy via Docker or systemd service

## Future Ideas (Unscheduled)
- Business automation: proposal context system, lead pipeline, calendar sync
- Brave Search API integration (when free tier available)
- GitHub token with fine-grained scopes for PR automation
- Notion MCP for knowledge base management
- Cron-based scheduled briefings via Telegram
