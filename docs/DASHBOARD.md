# Dashboard

The Kronus dashboard runs at `http://localhost:8420`, served by the daemon process.

## Pages

### Overview (`/`)
- Daemon status (running/stopped, uptime, PID, version)
- Today's cost and turn count
- Pending scope approvals count
- Clickable session cards — navigate to live viewer

### Sessions (`/sessions`)
- Table of all sessions with status, mode, queue size
- **Live** button — opens real-time activity viewer
- **Stop** / **Reset** buttons per session
- Transcript browser — view past session transcripts

### Session Detail (`/sessions/:groupId`)
- Real-time activity feed via Server-Sent Events (SSE)
- Events: tool use, responses, errors, file sends
- Color-coded by type with timestamps
- Auto-scrolling with connection status indicator

### Projects (`/projects`)
- All projects with path, mode, allowed tools
- Inline editor for permission mode and tool toggles

### Personas (`/personas`)
- Grid of all projects with persona status
- **Create** — name, style (4 options), language (4 options), responsibilities
- **Edit** — full markdown editor for persona.md
- **Preview** — read-only view of current persona
- **Delete** — removes persona.md

### Security (`/security`)
- **Pending** — scope approval requests with Approve/Always/Deny buttons
- **History** — audit log of all past decisions (time, tool, path, decision, source)
- **Allowlists** — per-project path editor (add/remove trusted paths)

### Costs (`/costs`)
- Summary: today's cost, 30-day total, total tokens, total turns
- Per-project table: input/output tokens, cost, turns, distribution bar
- Daily usage chart: horizontal bars showing cost per day

### Logs (`/logs`)
- Filtered daemon log viewer
- Level filter: ALL, INFO, WARN, ERROR, DEBUG
- Auto-scroll toggle
- Configurable line count (50-500)

## API Reference

All endpoints are at `http://localhost:8420/api/`.

### Status
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/status` | `{ status, pid, version, uptime, uptimeFormatted, home }` |

### Sessions
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/sessions` | Array of session objects |
| POST | `/api/sessions/:groupId/stop` | `{ ok: boolean }` |
| POST | `/api/sessions/:groupId/new` | `{ ok: boolean }` |

### Projects
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/projects` | `{ projects: [...], defaults: {...} }` |
| PUT | `/api/projects/:groupId` | Update permissionMode, allowedTools |

### Personas
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/projects/:groupId/persona` | `{ exists, name, source, content, metadata }` |
| PUT | `/api/projects/:groupId/persona` | Create/update with content or options |
| DELETE | `/api/projects/:groupId/persona` | Remove persona |

### Scope / Security
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/scope/pending` | Array of pending scope requests |
| GET | `/api/scope/history` | Array of past decisions |
| POST | `/api/scope/:id/approve` | Approve once |
| POST | `/api/scope/:id/always` | Always allow directory |
| POST | `/api/scope/:id/deny` | Deny access |
| GET | `/api/scope/allowlist/:groupId` | `{ paths: [...] }` |
| PUT | `/api/scope/allowlist/:groupId` | Update allowlist |

### Usage / Costs
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/usage` | Daily summaries (query: `?days=7`) |
| GET | `/api/usage/totals` | Per-project 30-day totals |
| GET | `/api/usage/today` | Today's summary |
| GET | `/api/usage/project/:groupId` | Usage for one project |

### Activity (Live Viewer)
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/activity/:groupId` | Recent events (query: `?since=&limit=`) |
| GET | `/api/activity/:groupId/stream` | SSE stream (real-time) |
| GET | `/api/activity/all` | Events across all groups |
| GET | `/api/activity/all/stream` | Global SSE stream |

### Logs
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/logs` | Array of log lines (query: `?lines=100&level=INFO&group=ID`) |

### Transcripts
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/transcripts/:groupId` | List of transcript files |
| GET | `/api/transcripts/:groupId/:filename` | Transcript content (markdown) |

### Access Control
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/access` | Full access config |
| PUT | `/api/access/:groupId` | Update group access settings |

### Session History
| Method | Path | Response |
|--------|------|----------|
| GET | `/api/history/:groupId` | Past session IDs for a group |

## Tech Stack

- **Backend:** Bun + Bun.serve (daemon serves API alongside bot)
- **Frontend:** React 19 + React Router + Tailwind CSS 4 + Vite
- **Design:** Black/white minimalist, monospace font, dark mode only
- **Real-time:** Server-Sent Events (SSE) for live session viewer
