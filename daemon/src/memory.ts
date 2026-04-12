/**
 * Cross-Session Memory System for Kronus v5.0
 *
 * Extracts decisions, todos, people context, and project state from session
 * turns and stores them in ~/second-brain/kronus/memory/. Provides retrieval
 * for system prompt injection.
 *
 * Design principles:
 * - Lightweight extraction (regex/keyword, not LLM) to avoid cost
 * - Append-only JSONL for durability
 * - Per-project subdirectories for isolation
 * - Cross-project search for personal DM
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"

const MEMORY_ROOT = join(homedir(), "second-brain", "kronus", "memory")

export type MemoryType = "decision" | "todo" | "person" | "state" | "note"

export interface MemoryEntry {
  id: string
  type: MemoryType
  content: string
  project: string
  groupId: string
  timestamp: string
  source: "assistant" | "user"
  done?: boolean
}

/** Patterns that indicate meaningful content worth remembering */
const DECISION_PATTERNS = [
  /(?:we|i|let'?s)\s+(?:decided?|agreed?|chose?|going?\s+(?:to|with))\s+(.+)/i,
  /(?:decision|verdict|conclusion|final\s+answer):\s*(.+)/i,
  /(?:we'?ll|i'?ll|let'?s)\s+(?:go\s+with|use|pick|choose)\s+(.+)/i,
]

const TODO_PATTERNS = [
  /(?:todo|to-do|action\s*item|task):\s*(.+)/i,
  /(?:need\s+to|have\s+to|should|must|will)\s+(.{10,80}?)(?:\.|$)/i,
  /(?:by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|end\s+of|next\s+week))/i,
  /(?:deadline|due|deliver|ship|finish|complete)\s+(?:by|before|on)\s+(.+)/i,
]

const PERSON_PATTERNS = [
  /(\w+)\s+(?:is\s+(?:a|the|our|my)|works\s+(?:on|at|with))\s+(.+)/i,
  /(?:client|team\s*mate|collaborator|partner):\s*(\w+)/i,
]

const STATE_PATTERNS = [
  /(?:status|progress|update):\s*(.+)/i,
  /(?:currently|right\s+now|at\s+this\s+point)\s+(?:we'?re|i'?m|it'?s)\s+(.+)/i,
  /(?:blocked|stuck|waiting)\s+(?:on|for)\s+(.+)/i,
  /(?:shipped|deployed|released|merged|completed|finished)\s+(.+)/i,
]

/** Extract memory entries from a session turn */
export function extractMemories(
  text: string,
  project: string,
  groupId: string,
  source: "assistant" | "user"
): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  const timestamp = new Date().toISOString()

  // Split into sentences for better matching
  const sentences = text
    .replace(/\n+/g, ". ")
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10 && s.length < 300)

  for (const sentence of sentences) {
    // Check decisions
    for (const pattern of DECISION_PATTERNS) {
      const match = sentence.match(pattern)
      if (match) {
        entries.push({
          id: generateId(),
          type: "decision",
          content: sentence,
          project,
          groupId,
          timestamp,
          source,
        })
        break
      }
    }

    // Check todos
    for (const pattern of TODO_PATTERNS) {
      const match = sentence.match(pattern)
      if (match) {
        entries.push({
          id: generateId(),
          type: "todo",
          content: sentence,
          project,
          groupId,
          timestamp,
          source,
          done: false,
        })
        break
      }
    }

    // Check people
    for (const pattern of PERSON_PATTERNS) {
      const match = sentence.match(pattern)
      if (match) {
        entries.push({
          id: generateId(),
          type: "person",
          content: sentence,
          project,
          groupId,
          timestamp,
          source,
        })
        break
      }
    }

    // Check state
    for (const pattern of STATE_PATTERNS) {
      const match = sentence.match(pattern)
      if (match) {
        entries.push({
          id: generateId(),
          type: "state",
          content: sentence,
          project,
          groupId,
          timestamp,
          source,
        })
        break
      }
    }
  }

  // Deduplicate by content similarity
  const seen = new Set<string>()
  return entries.filter(entry => {
    const key = entry.content.toLowerCase().slice(0, 50)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Save memory entries to disk */
export function saveMemories(entries: MemoryEntry[]): void {
  if (entries.length === 0) return

  // Ensure root exists
  if (!existsSync(MEMORY_ROOT)) {
    mkdirSync(MEMORY_ROOT, { recursive: true })
  }

  // Group by project
  const byProject = new Map<string, MemoryEntry[]>()
  for (const entry of entries) {
    const existing = byProject.get(entry.project) ?? []
    existing.push(entry)
    byProject.set(entry.project, existing)
  }

  // Append to per-project JSONL files
  for (const [project, projectEntries] of byProject) {
    const projectDir = join(MEMORY_ROOT, sanitizeFilename(project))
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true })
    }

    // Daily file: YYYY-MM-DD.jsonl
    const dateStr = new Date().toISOString().slice(0, 10)
    const filePath = join(projectDir, `${dateStr}.jsonl`)

    const lines = projectEntries.map(e => JSON.stringify(e)).join("\n") + "\n"
    appendFileSync(filePath, lines, "utf8")
  }

  // Also append to the global index
  const indexPath = join(MEMORY_ROOT, "memory-index.jsonl")
  const indexLines = entries.map(e => JSON.stringify({
    id: e.id,
    type: e.type,
    content: e.content.slice(0, 200),
    project: e.project,
    timestamp: e.timestamp,
  })).join("\n") + "\n"
  appendFileSync(indexPath, indexLines, "utf8")
}

/** Load recent memories for a project (last N days) */
export function loadProjectMemories(
  project: string,
  daysBack: number = 7,
  limit: number = 50
): MemoryEntry[] {
  const projectDir = join(MEMORY_ROOT, sanitizeFilename(project))
  if (!existsSync(projectDir)) return []

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const entries: MemoryEntry[] = []

  try {
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith(".jsonl") && f >= cutoffStr)
      .sort()
      .reverse()

    for (const file of files) {
      if (entries.length >= limit) break
      const content = readFileSync(join(projectDir, file), "utf8")
      for (const line of content.split("\n").filter(Boolean)) {
        if (entries.length >= limit) break
        try {
          entries.push(JSON.parse(line))
        } catch {}
      }
    }
  } catch {}

  return entries
}

/** Load recent memories across ALL projects (for personal DM) */
export function loadAllMemories(
  daysBack: number = 3,
  limit: number = 100
): MemoryEntry[] {
  if (!existsSync(MEMORY_ROOT)) return []

  const entries: MemoryEntry[] = []

  try {
    const projectDirs = readdirSync(MEMORY_ROOT)
      .filter(f => {
        const fullPath = join(MEMORY_ROOT, f)
        try { return require("fs").statSync(fullPath).isDirectory() } catch { return false }
      })

    for (const dir of projectDirs) {
      const projectEntries = loadProjectMemories(dir, daysBack, Math.floor(limit / projectDirs.length))
      entries.push(...projectEntries)
    }
  } catch {}

  // Sort by timestamp descending
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return entries.slice(0, limit)
}

/** Search memories by keyword */
export function searchMemories(
  query: string,
  project?: string,
  limit: number = 20
): MemoryEntry[] {
  const queryLower = query.toLowerCase()
  const allEntries = project
    ? loadProjectMemories(project, 30, 500)
    : loadAllMemories(30, 500)

  return allEntries
    .filter(e => e.content.toLowerCase().includes(queryLower))
    .slice(0, limit)
}

/** Format memories for system prompt injection */
export function formatMemoriesForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ""

  const lines: string[] = ["RECENT MEMORY (from past sessions):"]

  // Group by type
  const todos = entries.filter(e => e.type === "todo" && !e.done)
  const decisions = entries.filter(e => e.type === "decision")
  const states = entries.filter(e => e.type === "state")

  if (todos.length > 0) {
    lines.push("\nPending Todos:")
    for (const t of todos.slice(0, 10)) {
      const age = formatAge(t.timestamp)
      lines.push(`- [${t.project}] ${t.content} (${age})`)
    }
  }

  if (decisions.length > 0) {
    lines.push("\nRecent Decisions:")
    for (const d of decisions.slice(0, 10)) {
      const age = formatAge(d.timestamp)
      lines.push(`- [${d.project}] ${d.content} (${age})`)
    }
  }

  if (states.length > 0) {
    lines.push("\nProject State:")
    for (const s of states.slice(0, 5)) {
      const age = formatAge(s.timestamp)
      lines.push(`- [${s.project}] ${s.content} (${age})`)
    }
  }

  lines.push("")
  return lines.join("\n")
}

// ─── Helpers ──────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

const DONE_FILE = join(MEMORY_ROOT, "done-todos.json")

/** Load set of done todo IDs */
function loadDoneIds(): Set<string> {
  try {
    if (!existsSync(DONE_FILE)) return new Set()
    const data = JSON.parse(readFileSync(DONE_FILE, "utf8"))
    return new Set(data.ids ?? [])
  } catch {
    return new Set()
  }
}

/** Mark a todo as done by ID */
export function markTodoDone(todoId: string): boolean {
  const doneIds = loadDoneIds()
  doneIds.add(todoId)
  if (!existsSync(MEMORY_ROOT)) mkdirSync(MEMORY_ROOT, { recursive: true })
  const { writeFileSync } = require("fs")
  writeFileSync(DONE_FILE, JSON.stringify({ ids: [...doneIds] }), "utf8")
  return true
}

/** Mark a todo as not done */
export function markTodoUndone(todoId: string): boolean {
  const doneIds = loadDoneIds()
  doneIds.delete(todoId)
  const { writeFileSync } = require("fs")
  writeFileSync(DONE_FILE, JSON.stringify({ ids: [...doneIds] }), "utf8")
  return true
}

/** Check if a todo is done */
export function isTodoDone(todoId: string): boolean {
  return loadDoneIds().has(todoId)
}

/** Get all done IDs */
export function getDoneIds(): string[] {
  return [...loadDoneIds()]
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
}

function formatAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime()
  const hours = Math.floor(ms / 3600000)
  if (hours < 1) return "just now"
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  return `${days}d ago`
}
