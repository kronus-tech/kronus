/**
 * Activity Tracker for Kronus v5.0 Dashboard
 *
 * Captures session events (tool calls, responses, errors) and persists
 * them to daily JSONL files. Survives daemon restarts.
 *
 * Storage: ~/second-brain/kronus/activity/<date>.jsonl
 * Per-group: ~/second-brain/kronus/activity/groups/<groupId>/<date>.jsonl
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const ACTIVITY_DIR = join(homedir(), "second-brain", "kronus", "activity")
const GROUPS_DIR = join(ACTIVITY_DIR, "groups")

export interface ActivityEvent {
  id: number
  timestamp: number
  groupId: string
  type: "tool_use" | "text" | "status" | "error" | "result" | "question" | "file_send" | "memory"
  data: Record<string, unknown>
}

const MAX_MEMORY_EVENTS = 500 // in-memory buffer for SSE (not the persistence limit)

export class ActivityTracker {
  private memoryBuffer: ActivityEvent[] = [] // in-memory for SSE only
  private nextId = 1
  private sseClients: Map<string, Set<(event: ActivityEvent) => void>> = new Map()
  private writeBuffer: string[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Ensure directories exist
    if (!existsSync(ACTIVITY_DIR)) mkdirSync(ACTIVITY_DIR, { recursive: true })
    if (!existsSync(GROUPS_DIR)) mkdirSync(GROUPS_DIR, { recursive: true })

    // Load recent events into memory buffer for SSE
    this.loadRecentIntoMemory()
  }

  /** Record an activity event — persists to disk + notifies SSE */
  emit(groupId: string, type: ActivityEvent["type"], data: Record<string, unknown>): void {
    const event: ActivityEvent = {
      id: this.nextId++,
      timestamp: Date.now(),
      groupId,
      type,
      data,
    }

    // In-memory buffer for SSE (circular)
    this.memoryBuffer.push(event)
    if (this.memoryBuffer.length > MAX_MEMORY_EVENTS) {
      this.memoryBuffer.shift()
    }

    // Persist to disk (batched for performance)
    this.writeBuffer.push(JSON.stringify(event))
    this.scheduleFlush(groupId)

    // Notify SSE clients
    const clients = this.sseClients.get(groupId)
    if (clients) {
      for (const cb of clients) {
        try { cb(event) } catch {}
      }
    }
    const globalClients = this.sseClients.get("*")
    if (globalClients) {
      for (const cb of globalClients) {
        try { cb(event) } catch {}
      }
    }
  }

  /** Batch writes to disk every 500ms */
  private scheduleFlush(groupId: string): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushToDisk()
      this.flushTimer = null
    }, 500)
  }

  /** Write buffered events to disk */
  private flushToDisk(): void {
    if (this.writeBuffer.length === 0) return

    const date = new Date().toISOString().slice(0, 10)
    const globalFile = join(ACTIVITY_DIR, `${date}.jsonl`)

    // Group events by groupId for per-group files
    const byGroup = new Map<string, string[]>()

    for (const line of this.writeBuffer) {
      try {
        const event: ActivityEvent = JSON.parse(line)
        const groupLines = byGroup.get(event.groupId) ?? []
        groupLines.push(line)
        byGroup.set(event.groupId, groupLines)
      } catch {}
    }

    // Write global file
    try {
      appendFileSync(globalFile, this.writeBuffer.join("\n") + "\n", "utf8")
    } catch {}

    // Write per-group files
    for (const [groupId, lines] of byGroup) {
      try {
        const groupDir = join(GROUPS_DIR, groupId)
        if (!existsSync(groupDir)) mkdirSync(groupDir, { recursive: true })
        const groupFile = join(groupDir, `${date}.jsonl`)
        appendFileSync(groupFile, lines.join("\n") + "\n", "utf8")
      } catch {}
    }

    this.writeBuffer = []
  }

  /** Load recent events from disk into memory buffer (on startup) */
  private loadRecentIntoMemory(): void {
    try {
      // Load today + yesterday from global file
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

      for (const date of [yesterday, today]) {
        const file = join(ACTIVITY_DIR, `${date}.jsonl`)
        if (!existsSync(file)) continue

        const content = readFileSync(file, "utf8")
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const event: ActivityEvent = JSON.parse(line)
            event.id = this.nextId++
            this.memoryBuffer.push(event)
          } catch {}
        }
      }

      // Trim to max
      if (this.memoryBuffer.length > MAX_MEMORY_EVENTS) {
        this.memoryBuffer = this.memoryBuffer.slice(-MAX_MEMORY_EVENTS)
      }
    } catch {}
  }

  /** Get recent events for a group (from disk if needed) */
  getGroupEvents(groupId: string, since?: number, limit: number = 50): ActivityEvent[] {
    // Try memory first
    let events = this.memoryBuffer.filter(e => e.groupId === groupId)

    // If memory is sparse, load from disk
    if (events.length < limit) {
      events = this.loadGroupFromDisk(groupId, 2, limit)
    }

    const filtered = since
      ? events.filter(e => e.id > since)
      : events.slice(-limit)
    return filtered.slice(-limit)
  }

  /** Get recent events across all groups */
  getGlobalEvents(since?: number, limit: number = 100): ActivityEvent[] {
    const filtered = since
      ? this.memoryBuffer.filter(e => e.id > since)
      : this.memoryBuffer.slice(-limit)
    return filtered.slice(-limit)
  }

  /** Load events for a group from disk files */
  private loadGroupFromDisk(groupId: string, daysBack: number, limit: number): ActivityEvent[] {
    const groupDir = join(GROUPS_DIR, groupId)
    if (!existsSync(groupDir)) return []

    const events: ActivityEvent[] = []
    try {
      const files = readdirSync(groupDir)
        .filter(f => f.endsWith(".jsonl"))
        .sort()
        .reverse()
        .slice(0, daysBack)

      for (const file of files) {
        const content = readFileSync(join(groupDir, file), "utf8")
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            events.push(JSON.parse(line))
          } catch {}
        }
        if (events.length >= limit) break
      }
    } catch {}

    return events.slice(-limit)
  }

  /** Subscribe to SSE events for a group (or "*" for all) */
  subscribe(groupId: string, callback: (event: ActivityEvent) => void): () => void {
    let clients = this.sseClients.get(groupId)
    if (!clients) {
      clients = new Set()
      this.sseClients.set(groupId, clients)
    }
    clients.add(callback)

    return () => {
      clients!.delete(callback)
      if (clients!.size === 0) {
        this.sseClients.delete(groupId)
      }
    }
  }

  /** Flush any pending writes (call on shutdown) */
  shutdown(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushToDisk()
  }

  /** Get SSE client count */
  getClientCount(): number {
    let count = 0
    for (const clients of this.sseClients.values()) {
      count += clients.size
    }
    return count
  }
}
