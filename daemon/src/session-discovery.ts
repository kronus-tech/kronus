import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, renameSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { SessionInfo, TerminalSession, SessionHistoryEntry, SessionHistoryFile } from "./types"

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects")
const SESSION_HISTORY_FILE = join(homedir(), ".claude", "channels", "telegram", "session-history.json")

/** Convert a filesystem path to Claude's mangled directory name */
export function pathToMangled(projectPath: string): string {
  // /Users/username/Desktop/foo → -Users-username-Desktop-foo
  return projectPath.replace(/\//g, "-")
}

/** Discover sessions stored on disk for a given project path */
export function discoverDiskSessions(projectPath: string): SessionInfo[] {
  const mangled = pathToMangled(projectPath)
  const sessionsDir = join(CLAUDE_PROJECTS_DIR, mangled)

  if (!existsSync(sessionsDir)) return []

  try {
    const entries = readdirSync(sessionsDir)
    const sessions: SessionInfo[] = []

    for (const entry of entries) {
      // Only .jsonl files are sessions
      if (!entry.endsWith(".jsonl")) continue

      const sessionId = entry.replace(".jsonl", "")
      const fullPath = join(sessionsDir, entry)

      try {
        const stat = statSync(fullPath)
        sessions.push({
          sessionId,
          shortId: sessionId.slice(0, 8),
          projectPath,
          source: "disk",
          isRunning: false,
          lastModified: stat.mtimeMs,
        })
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by most recent first
    sessions.sort((a, b) => b.lastModified - a.lastModified)
    return sessions
  } catch {
    return []
  }
}

/** Detect running Claude processes on the system */
export function detectTerminalSessions(): TerminalSession[] {
  try {
    const result = Bun.spawnSync(["ps", "aux"], { stdout: "pipe" })
    const output = result.stdout.toString()
    const sessions: TerminalSession[] = []

    for (const line of output.split("\n")) {
      // Match interactive claude processes (not our daemon's -p calls)
      if (
        line.includes("claude") &&
        !line.includes("-p ") &&
        !line.includes("grep") &&
        !line.includes("bun run src/index")
      ) {
        const parts = line.trim().split(/\s+/)
        const pid = parseInt(parts[1])
        if (isNaN(pid)) continue

        // Try to get cwd of the process
        try {
          const lsofResult = Bun.spawnSync(
            ["lsof", "-p", String(pid), "-d", "cwd", "-Fn"],
            { stdout: "pipe" }
          )
          const lsofOutput = lsofResult.stdout.toString()
          const cwdMatch = lsofOutput.match(/n(\/[^\n]+)/)
          const cwd = cwdMatch ? cwdMatch[1] : "unknown"
          sessions.push({ pid, cwd, args: parts.slice(10).join(" ") })
        } catch {
          sessions.push({ pid, cwd: "unknown", args: parts.slice(10).join(" ") })
        }
      }
    }

    return sessions
  } catch {
    return []
  }
}

/** Resolve a short 8-char session ID to the full UUID */
export function resolveShortId(shortId: string, projectPath: string): string | null {
  const diskSessions = discoverDiskSessions(projectPath)
  const matches = diskSessions.filter((s) => s.sessionId.startsWith(shortId))

  if (matches.length === 1) return matches[0].sessionId
  if (matches.length > 1) return null // Ambiguous
  return null // Not found
}

// ─── Session History ──────────────────────────────────────────────────

/** Load the session history file */
function loadHistoryFile(): SessionHistoryFile {
  try {
    const content = readFileSync(SESSION_HISTORY_FILE, "utf8")
    return JSON.parse(content) as SessionHistoryFile
  } catch {
    return { version: 1, groups: {} }
  }
}

/** Save the session history file atomically */
function saveHistoryFile(history: SessionHistoryFile): void {
  const tmpFile = SESSION_HISTORY_FILE + ".tmp"
  writeFileSync(tmpFile, JSON.stringify(history, null, 2) + "\n")
  renameSync(tmpFile, SESSION_HISTORY_FILE)
}

/** Load session history for a specific group */
export function loadSessionHistory(groupId: string): SessionHistoryEntry[] {
  const history = loadHistoryFile()
  return history.groups[groupId] ?? []
}

/** Append a session history entry for a group */
export function appendSessionHistory(groupId: string, entry: SessionHistoryEntry): void {
  const history = loadHistoryFile()

  if (!history.groups[groupId]) {
    history.groups[groupId] = []
  }

  history.groups[groupId].push(entry)

  // Keep last 50 entries per group to prevent unbounded growth
  if (history.groups[groupId].length > 50) {
    history.groups[groupId] = history.groups[groupId].slice(-50)
  }

  saveHistoryFile(history)
}

/** Get the most recent session ID for a group from history */
export function getLastSessionId(groupId: string): string | null {
  const entries = loadSessionHistory(groupId)
  if (entries.length === 0) return null
  return entries[entries.length - 1].sessionId
}

/** Get all last session IDs across all groups (for daemon startup restore) */
export function getAllLastSessions(): Record<string, string> {
  const history = loadHistoryFile()
  const result: Record<string, string> = {}
  for (const [groupId, entries] of Object.entries(history.groups)) {
    if (entries.length > 0) {
      result[groupId] = entries[entries.length - 1].sessionId
    }
  }
  return result
}

/** Format a timestamp as relative time (e.g., "2h ago", "3d ago") */
export function formatRelativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs
  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return `${seconds}s ago`
}
