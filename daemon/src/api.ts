/**
 * REST API server for Kronus Dashboard
 * Runs alongside the Telegram bot on port 8420
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "fs"
import { join, resolve } from "path"
import { homedir } from "os"
import { randomBytes } from "crypto"
import type { SessionManager } from "./session-manager"
import { loadProjects, loadAccess, saveProjects, saveAccess, Logger } from "./config"
import { loadSessionHistory } from "./session-discovery"
import { readPersona, writePersona, clearPersona, generatePersonaMd } from "./persona"
import type { ActivityTracker } from "./activity"
import { ScopeGuard } from "./scope-guard"
import { getUsageRange, getProjectTotals, getProjectUsage, getDailySummary } from "./usage"
import { loadAllMemories, loadProjectMemories, searchMemories, markTodoDone, markTodoUndone, getDoneIds, type MemoryEntry } from "./memory"
import { listJournalDays, readJournalDay, searchJournal, loadRecentJournal } from "./journal"
import type { PersonaOptions } from "./types"

const STATE_DIR = join(homedir(), ".claude", "channels", "telegram")
const TRANSCRIPTS_DIR = join(STATE_DIR, "transcripts")
const LOG_FILE = join(STATE_DIR, "logs", "daemon.log")
const DASHBOARD_DIR = join(homedir(), ".claude", "daemon", "dashboard", "dist")

const startTime = Date.now()
const API_TOKEN_FILE = join(STATE_DIR, "api.token")

/** Generate or load API token for dashboard auth */
function getOrCreateApiToken(): string {
  try {
    if (existsSync(API_TOKEN_FILE)) {
      return readFileSync(API_TOKEN_FILE, "utf8").trim()
    }
  } catch {}
  const token = randomBytes(32).toString("hex")
  writeFileSync(API_TOKEN_FILE, token, { mode: 0o600 })
  return token
}

let API_TOKEN = ""

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  })
}

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase()
  const types: Record<string, string> = {
    html: "text/html",
    js: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
  }
  return types[ext ?? ""] ?? "application/octet-stream"
}

export function startApiServer(
  sessionManager: SessionManager,
  logger: Logger,
  port: number = 8420,
  activityTracker?: ActivityTracker,
  scopeGuard?: ScopeGuard,
  ownerName: string = "owner"
): void {
  // Generate API token on startup
  API_TOKEN = getOrCreateApiToken()
  logger.info(`API token: ${API_TOKEN_FILE} (use X-Kronus-Token header for mutating requests)`)

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // CORS — same-origin only (dashboard is served from same port)
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Kronus-Token",
          },
        })
      }

      // Auth — require token for mutating requests (PUT, POST, DELETE)
      if (req.method !== "GET" && path.startsWith("/api/")) {
        const token = req.headers.get("X-Kronus-Token") ?? url.searchParams.get("token")
        if (token !== API_TOKEN) {
          return json({ error: "Unauthorized — provide X-Kronus-Token header" }, 401)
        }
      }

      // ─── API Routes ──────────────────────────────────────

      // Status
      if (path === "/api/status") {
        return json({
          status: "running",
          pid: process.pid,
          version: "5.5",
          owner: process.env["KRONUS_OWNER"] ?? ownerName,
          uptime: Date.now() - startTime,
          uptimeFormatted: formatUptime(Date.now() - startTime),
          home: homedir(),
          apiToken: API_TOKEN,
        })
      }

      // System health — comprehensive system status for dashboard
      if (path === "/api/system") {
        const projects = loadProjects()
        const projectCount = Object.keys(projects.projects).length
        const sessions = sessionManager.getStatus()
        const activeSessions = sessions.filter(s => s.isRunning).length

        // Check knowledge graph
        let brainOnline = false
        let brainHealth = 0
        let brainNodes = 0
        let brainEdges = 0
        try {
          const brainRes = await fetch("http://localhost:4242/api/map", { signal: AbortSignal.timeout(2000) })
          if (brainRes.ok) {
            const brainData = await brainRes.json() as Record<string, unknown>
            brainOnline = true
            const totals = brainData.totals as Record<string, number> | undefined
            brainHealth = (brainData.health_score as number) ?? 0
            brainNodes = totals?.nodes ?? (brainData.total_nodes as number) ?? 0
            brainEdges = totals?.edges ?? (brainData.total_edges as number) ?? 0
          }
        } catch {}

        // Check hub
        let hubOnline = false
        let hubVersion = ""
        try {
          const hubRes = await fetch("http://localhost:3100/health", { signal: AbortSignal.timeout(2000) })
          if (hubRes.ok) {
            const hubData = await hubRes.json() as Record<string, unknown>
            hubOnline = true
            hubVersion = (hubData.version as string) ?? ""
          }
        } catch {}

        // Autostart status
        const plistPath = join(homedir(), "Library", "LaunchAgents", "com.kronus.daemon.plist")
        const autostartEnabled = existsSync(plistPath)

        // Log file size
        let logSizeBytes = 0
        try {
          logSizeBytes = statSync(LOG_FILE).size
        } catch {}

        // Memory stats (quick count)
        let memoryCount = 0
        try {
          const mems = loadAllMemories(30, 1000)
          memoryCount = mems.length
        } catch {}

        // Domains config
        let domainsConfig = null
        const domainsFile = join(homedir(), ".kronus", "domains.json")
        try {
          if (existsSync(domainsFile)) {
            domainsConfig = JSON.parse(readFileSync(domainsFile, "utf8"))
          }
        } catch {}

        // Recent log lines
        let recentLogs: string[] = []
        try {
          const content = readFileSync(LOG_FILE, "utf8")
          recentLogs = content.split("\n").filter(Boolean).slice(-10)
        } catch {}

        // Per-project details
        const projectList = Object.entries(projects.projects).map(([groupId, config]) => ({
          groupId,
          name: config.name,
          path: config.path,
          permissionMode: config.permissionMode ?? "default",
          hasPersona: !!config.persona,
        }))

        return json({
          daemon: {
            status: "running",
            pid: process.pid,
            version: "5.5",
            owner: process.env["KRONUS_OWNER"] ?? ownerName,
            uptime: Date.now() - startTime,
            uptimeFormatted: formatUptime(Date.now() - startTime),
          },
          services: {
            dashboard: { online: true, port: port },
            telegram: { online: true },
            brain: { online: brainOnline, health: brainHealth, nodes: brainNodes, edges: brainEdges },
            hub: { online: hubOnline, version: hubVersion },
          },
          autostart: autostartEnabled,
          projects: { count: projectCount, list: projectList },
          sessions: { total: sessions.length, active: activeSessions },
          stats: {
            logSizeBytes,
            memoryCount,
          },
          domains: domainsConfig,
          recentLogs,
        })
      }

      // Sessions
      if (path === "/api/sessions") {
        const sessions = sessionManager.getStatus()
        const projects = loadProjects()
        const enriched = sessions.map((s) => ({
          ...s,
          projectName: projects.projects[s.groupId]?.name ?? "unknown",
          projectPath: projects.projects[s.groupId]?.path ?? "",
          permissionMode: projects.projects[s.groupId]?.permissionMode ?? "default",
          shortSessionId: s.sessionId?.slice(0, 8) ?? null,
        }))
        return json(enriched)
      }

      // Projects
      if (path === "/api/projects") {
        const projects = loadProjects()
        const entries = Object.entries(projects.projects).map(([groupId, config]) => {
          // Enrich with detected persona if not in metadata
          let persona = config.persona
          if (!persona) {
            const detected = readPersona(config.path)
            if (detected) {
              persona = { name: detected.name, configuredAt: "" }
            }
          }
          return { groupId, ...config, persona }
        })
        return json({ projects: entries, defaults: projects.defaults })
      }

      // ─── Persona API ──────────────────────────────────

      // Read persona
      if (path.match(/^\/api\/projects\/[^/]+\/persona$/) && req.method === "GET") {
        const groupId = path.replace("/api/projects/", "").replace("/persona", "")
        const project = loadProjects().projects[groupId]
        if (!project) return json({ error: "Project not found" }, 404)

        const persona = readPersona(project.path)
        return json({
          exists: !!persona,
          name: persona?.name ?? null,
          source: persona?.source ?? null,
          content: persona?.content ?? null,
          metadata: project.persona ?? null,
        })
      }

      // Write/update persona
      if (path.match(/^\/api\/projects\/[^/]+\/persona$/) && req.method === "PUT") {
        const groupId = path.replace("/api/projects/", "").replace("/persona", "")
        const projects = loadProjects()
        const project = projects.projects[groupId]
        if (!project) return json({ error: "Project not found" }, 404)

        const body = await req.json() as Record<string, unknown>

        if (body.content && typeof body.content === "string") {
          // Direct content write
          writePersona(project.path, body.content)
          const nameMatch = (body.content as string).match(/^# (.+)$/m)
          projects.projects[groupId].persona = {
            name: nameMatch?.[1] ?? body.name as string ?? "Custom",
            configuredAt: new Date().toISOString(),
          }
        } else if (body.name) {
          // Generate from options
          const options: PersonaOptions = {
            name: body.name as string,
            style: (body.style as PersonaOptions["style"]) ?? "casual",
            language: (body.language as PersonaOptions["language"]) ?? "english",
            responsibilities: (body.responsibilities as string[]) ?? ["Help with tasks", "Answer questions"],
            people: (body.people as PersonaOptions["people"]) ?? [],
            projectPath: project.path,
            projectName: project.name,
          }
          const content = generatePersonaMd(options)
          writePersona(project.path, content)
          projects.projects[groupId].persona = {
            name: options.name,
            configuredAt: new Date().toISOString(),
          }
        }

        saveProjects(projects)
        return json({ ok: true })
      }

      // Delete persona
      if (path.match(/^\/api\/projects\/[^/]+\/persona$/) && req.method === "DELETE") {
        const groupId = path.replace("/api/projects/", "").replace("/persona", "")
        const projects = loadProjects()
        const project = projects.projects[groupId]
        if (!project) return json({ error: "Project not found" }, 404)

        clearPersona(project.path)
        delete projects.projects[groupId].persona
        saveProjects(projects)
        return json({ ok: true })
      }

      // Update project
      if (path.startsWith("/api/projects/") && req.method === "PUT") {
        const groupId = path.replace("/api/projects/", "")
        const body = await req.json() as Record<string, unknown>
        const projects = loadProjects()
        if (!projects.projects[groupId]) return json({ error: "Not found" }, 404)

        if (body.permissionMode) projects.projects[groupId].permissionMode = body.permissionMode as any
        if (body.allowedTools) projects.projects[groupId].allowedTools = body.allowedTools as string[]
        saveProjects(projects)
        return json({ ok: true })
      }

      // Access
      if (path === "/api/access") {
        return json(loadAccess())
      }

      // Update access
      if (path.startsWith("/api/access/") && req.method === "PUT") {
        const groupId = path.replace("/api/access/", "")
        const body = await req.json() as Record<string, unknown>
        const access = loadAccess()
        if (!access.groups[groupId]) return json({ error: "Not found" }, 404)

        if (body.collaboratorMode) access.groups[groupId].collaboratorMode = body.collaboratorMode as any
        if (body.allowFrom) access.groups[groupId].allowFrom = body.allowFrom as string[]
        saveAccess(access)
        return json({ ok: true })
      }

      // Session history
      if (path.match(/^\/api\/history\/[^/]+$/)) {
        const groupId = path.replace("/api/history/", "")
        const history = loadSessionHistory(groupId)
        return json(history)
      }

      // Transcript list
      if (path.match(/^\/api\/transcripts\/[^/]+$/)) {
        const groupId = path.replace("/api/transcripts/", "")
        const dir = join(TRANSCRIPTS_DIR, groupId)
        if (!existsSync(dir)) return json([])
        const files = readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .reverse()
          .slice(0, 50)
          .map((f) => ({
            name: f,
            size: statSync(join(dir, f)).size,
            modified: statSync(join(dir, f)).mtimeMs,
          }))
        return json(files)
      }

      // Read transcript
      if (path.match(/^\/api\/transcripts\/[^/]+\/[^/]+$/)) {
        const parts = path.replace("/api/transcripts/", "").split("/")
        const file = join(TRANSCRIPTS_DIR, parts[0], parts[1])
        if (!existsSync(file)) return json({ error: "Not found" }, 404)
        return new Response(readFileSync(file, "utf8"), {
          headers: { "Content-Type": "text/markdown", "Access-Control-Allow-Origin": "*" },
        })
      }

      // Logs
      if (path === "/api/logs") {
        const lines = parseInt(url.searchParams.get("lines") ?? "100")
        const level = url.searchParams.get("level") ?? ""
        const group = url.searchParams.get("group") ?? ""

        try {
          const content = readFileSync(LOG_FILE, "utf8")
          let logLines = content.split("\n").filter(Boolean).slice(-lines * 2) // Read extra, filter later

          if (level) {
            logLines = logLines.filter((l) => l.includes(`[${level.toUpperCase()}]`))
          }
          if (group) {
            logLines = logLines.filter((l) => l.includes(group))
          }

          return json(logLines.slice(-lines))
        } catch {
          return json([])
        }
      }

      // Stop session
      if (path.match(/^\/api\/sessions\/[^/]+\/stop$/) && req.method === "POST") {
        const groupId = path.replace("/api/sessions/", "").replace("/stop", "")
        const stopped = await sessionManager.stopSession(groupId)
        return json({ ok: stopped })
      }

      // Reset session
      if (path.match(/^\/api\/sessions\/[^/]+\/new$/) && req.method === "POST") {
        const groupId = path.replace("/api/sessions/", "").replace("/new", "")
        const reset = sessionManager.resetSession(groupId)
        return json({ ok: reset })
      }

      // ─── Activity / Live Viewer ──────────────────────────

      // Activity events (REST — recent buffer)
      if (path.match(/^\/api\/activity\/[^/]+$/) && activityTracker) {
        const groupId = path.replace("/api/activity/", "")
        const since = parseInt(url.searchParams.get("since") ?? "0") || undefined
        const limit = parseInt(url.searchParams.get("limit") ?? "50")
        const events = groupId === "all"
          ? activityTracker.getGlobalEvents(since, limit)
          : activityTracker.getGroupEvents(groupId, since, limit)
        return json(events)
      }

      // Activity SSE stream (real-time)
      if (path.match(/^\/api\/activity\/[^/]+\/stream$/) && activityTracker) {
        const groupId = path.replace("/api/activity/", "").replace("/stream", "")
        const streamGroupId = groupId === "all" ? "*" : groupId

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()

            // Send initial keepalive
            controller.enqueue(encoder.encode(": connected\n\n"))

            // Subscribe to events
            const unsubscribe = activityTracker!.subscribe(streamGroupId, (event) => {
              try {
                const data = JSON.stringify(event)
                controller.enqueue(encoder.encode(`data: ${data}\n\n`))
              } catch {
                // Controller closed
              }
            })

            // Keepalive every 15s
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": keepalive\n\n"))
              } catch {
                clearInterval(keepalive)
              }
            }, 15000)

            // Clean up on close (controller.close is called by the browser)
            // Note: Bun handles this via the AbortSignal on the request
            req.signal.addEventListener("abort", () => {
              unsubscribe()
              clearInterval(keepalive)
            })
          },
        })

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        })
      }

      // ─── Memory / Brain API ──────────────────────────

      // All memories (cross-project)
      if (path === "/api/memory") {
        const days = parseInt(url.searchParams.get("days") ?? "7", 10)
        const type = url.searchParams.get("type") ?? ""
        const project = url.searchParams.get("project") ?? ""
        let entries = project
          ? loadProjectMemories(project, days, 500)
          : loadAllMemories(days, 500)

        if (type) {
          entries = entries.filter(e => e.type === type)
        }

        return json(entries)
      }

      // Memory search
      if (path === "/api/memory/search") {
        const q = url.searchParams.get("q") ?? ""
        const project = url.searchParams.get("project") ?? ""
        if (!q) return json([])
        return json(searchMemories(q, project || undefined, 50))
      }

      // Memory stats
      if (path === "/api/memory/stats") {
        const all = loadAllMemories(30, 1000)
        const byType: Record<string, number> = {}
        const byProject: Record<string, number> = {}
        for (const entry of all) {
          byType[entry.type] = (byType[entry.type] ?? 0) + 1
          byProject[entry.project] = (byProject[entry.project] ?? 0) + 1
        }
        return json({ total: all.length, byType, byProject })
      }

      // ─── Journal API ──────────────────────────

      // Journal days list
      if (path === "/api/journal/days") {
        const limit = parseInt(url.searchParams.get("limit") ?? "30", 10)
        return json(listJournalDays(limit))
      }

      // Read journal day
      if (path.match(/^\/api\/journal\/\d{4}-\d{2}-\d{2}$/)) {
        const date = path.replace("/api/journal/", "")
        const content = readJournalDay(date)
        if (!content) return json({ error: "Not found" }, 404)
        return new Response(content, {
          headers: { "Content-Type": "text/markdown" },
        })
      }

      // Journal search
      if (path === "/api/journal/search") {
        const q = url.searchParams.get("q") ?? ""
        if (!q) return json([])
        return json(searchJournal(q, 20))
      }

      // Todos (pending memory entries of type "todo")
      if (path === "/api/todos" && req.method === "GET") {
        const showDone = url.searchParams.get("done") === "true"
        const all = loadAllMemories(30, 500)
        const doneIds = new Set(getDoneIds())
        const todos = all
          .filter(e => e.type === "todo")
          .map(e => ({ ...e, done: doneIds.has(e.id) }))
          .filter(e => showDone || !e.done)
        // Deduplicate
        const seen = new Set<string>()
        const unique = todos.filter(t => {
          const key = t.content.toLowerCase().slice(0, 40)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        return json(unique)
      }

      // Mark todo done/undone
      if (path.match(/^\/api\/todos\/[^/]+\/(done|undone)$/) && req.method === "POST") {
        const parts = path.replace("/api/todos/", "").split("/")
        const todoId = parts[0]
        const action = parts[1]
        if (action === "done") {
          markTodoDone(todoId)
        } else {
          markTodoUndone(todoId)
        }
        return json({ ok: true, id: todoId, done: action === "done" })
      }

      // ─── Usage / Cost API ──────────────────────────

      // Usage overview (daily summaries for last N days)
      if (path === "/api/usage") {
        const days = parseInt(url.searchParams.get("days") ?? "7")
        return json(getUsageRange(days))
      }

      // Per-project totals (last 30 days)
      if (path === "/api/usage/totals") {
        return json(getProjectTotals())
      }

      // Today's summary
      if (path === "/api/usage/today") {
        const today = new Date().toISOString().slice(0, 10)
        return json(getDailySummary(today))
      }

      // Usage for a specific project
      if (path.match(/^\/api\/usage\/project\/[^/]+$/)) {
        const groupId = path.replace("/api/usage/project/", "")
        const days = parseInt(url.searchParams.get("days") ?? "7")
        return json(getProjectUsage(groupId, days))
      }

      // ─── Scope / Security API ──────────────────────────

      // Pending scope approvals
      if (path === "/api/scope/pending" && scopeGuard) {
        return json(scopeGuard.getPending())
      }

      // Scope approval history
      if (path === "/api/scope/history" && scopeGuard) {
        const limit = parseInt(url.searchParams.get("limit") ?? "50")
        return json(scopeGuard.getHistory(limit))
      }

      // Approve/deny a scope request from dashboard
      if (path.match(/^\/api\/scope\/[^/]+\/(approve|deny|always)$/) && scopeGuard && req.method === "POST") {
        const parts = path.replace("/api/scope/", "").split("/")
        const requestId = parts[0]
        const action = parts[1]

        const statusMap: Record<string, "approved" | "denied" | "approved_always"> = {
          approve: "approved",
          deny: "denied",
          always: "approved_always",
        }
        const status = statusMap[action]
        if (!status) return json({ error: "Invalid action" }, 400)

        scopeGuard.writeDecision(requestId, status, "dashboard")
        return json({ ok: true, requestId, status })
      }

      // Per-project allowlist — read
      if (path.match(/^\/api\/scope\/allowlist\/[^/]+$/) && req.method === "GET") {
        const groupId = path.replace("/api/scope/allowlist/", "")
        const project = loadProjects().projects[groupId]
        if (!project) return json({ error: "Project not found" }, 404)
        return json({ paths: ScopeGuard.getAllowlist(project.path) })
      }

      // Per-project allowlist — update
      if (path.match(/^\/api\/scope\/allowlist\/[^/]+$/) && req.method === "PUT") {
        const groupId = path.replace("/api/scope/allowlist/", "")
        const project = loadProjects().projects[groupId]
        if (!project) return json({ error: "Project not found" }, 404)
        const body = await req.json() as { paths: string[] }
        ScopeGuard.setAllowlist(project.path, body.paths ?? [])
        return json({ ok: true })
      }

      // ─── Static Dashboard Files ──────────────────────────

      // Serve dashboard SPA (with path traversal protection)
      let filePath = path === "/" ? "/index.html" : path
      const staticFile = resolve(DASHBOARD_DIR, filePath.slice(1)) // remove leading /

      // SECURITY: verify resolved path stays within DASHBOARD_DIR
      if (staticFile.startsWith(DASHBOARD_DIR + "/") && existsSync(staticFile) && statSync(staticFile).isFile()) {
        return new Response(readFileSync(staticFile), {
          headers: { "Content-Type": getMimeType(staticFile) },
        })
      }

      // SPA fallback — serve index.html for client-side routing
      const indexFile = join(DASHBOARD_DIR, "index.html")
      if (existsSync(indexFile)) {
        return new Response(readFileSync(indexFile), {
          headers: { "Content-Type": "text/html" },
        })
      }

      // No dashboard built yet
      if (path === "/" || !path.startsWith("/api")) {
        return new Response(
          `<html><body style="background:#000;color:#fff;font-family:monospace;padding:40px">
          <h1>Kronus Dashboard</h1>
          <p>API is running. Dashboard not built yet.</p>
          <p>Try: <a href="/api/status" style="color:#888">/api/status</a> |
          <a href="/api/sessions" style="color:#888">/api/sessions</a> |
          <a href="/api/projects" style="color:#888">/api/projects</a></p>
          </body></html>`,
          { headers: { "Content-Type": "text/html" } }
        )
      }

      return json({ error: "Not found" }, 404)
    },
  })

  logger.info(`Dashboard API running on http://localhost:${port}`)
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}
