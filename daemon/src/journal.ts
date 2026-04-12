/**
 * Personal Journal System for Kronus v5.0
 *
 * Automatically logs all personal DM conversations to ~/second-brain/kronus/journal/.
 * Daily markdown files accumulate conversations throughout the day.
 * JSONL index enables search and proactive recall.
 *
 * The journal is the owner's private space — ideas, thoughts, notes, and
 * conversations with Kronus across the day.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const JOURNAL_DIR = join(homedir(), "second-brain", "kronus", "journal")
const INDEX_FILE = join(JOURNAL_DIR, "journal-index.jsonl")

export interface JournalEntry {
  timestamp: string
  date: string         // YYYY-MM-DD
  time: string         // HH:MM
  userMessage: string
  assistantResponse: string
  topics: string[]     // auto-extracted topic keywords
}

/** Save a conversation turn to the daily journal */
export function saveJournalEntry(
  userMessage: string,
  assistantResponse: string
): void {
  if (!userMessage && !assistantResponse) return

  // Ensure journal dir exists
  if (!existsSync(JOURNAL_DIR)) {
    mkdirSync(JOURNAL_DIR, { recursive: true })
  }

  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toTimeString().slice(0, 5)
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" })

  // Daily journal file: YYYY-MM-DD.md
  const journalFile = join(JOURNAL_DIR, `${date}.md`)

  // Create header if new file
  if (!existsSync(journalFile)) {
    const header = `# Journal — ${dayName}, ${date}\n\n`
    writeFileSync(journalFile, header, "utf8")
  }

  // Append conversation entry
  const entry = [
    `---`,
    ``,
    `### ${time}`,
    ``,
    `**User:** ${userMessage.slice(0, 2000)}`,
    ``,
    `**Kronus:** ${assistantResponse.slice(0, 3000)}`,
    ``,
  ].join("\n")

  appendFileSync(journalFile, entry + "\n", "utf8")

  // Extract topics and save to index
  const topics = extractTopics(userMessage, assistantResponse)
  const indexEntry: JournalEntry = {
    timestamp: now.toISOString(),
    date,
    time,
    userMessage: userMessage.slice(0, 500),
    assistantResponse: assistantResponse.slice(0, 500),
    topics,
  }

  appendFileSync(INDEX_FILE, JSON.stringify(indexEntry) + "\n", "utf8")
}

/** Load recent journal entries (for system prompt or /journal command) */
export function loadRecentJournal(daysBack: number = 3, limit: number = 20): JournalEntry[] {
  if (!existsSync(INDEX_FILE)) return []

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const entries: JournalEntry[] = []

  try {
    const content = readFileSync(INDEX_FILE, "utf8")
    const lines = content.split("\n").filter(Boolean).reverse()

    for (const line of lines) {
      if (entries.length >= limit) break
      try {
        const entry: JournalEntry = JSON.parse(line)
        if (entry.date >= cutoffStr) {
          entries.push(entry)
        } else {
          break // Index is chronological, so we can stop
        }
      } catch {}
    }
  } catch {}

  return entries.reverse() // Chronological order
}

/** Search journal by keyword */
export function searchJournal(query: string, limit: number = 10): JournalEntry[] {
  if (!existsSync(INDEX_FILE)) return []

  const queryLower = query.toLowerCase()
  const results: JournalEntry[] = []

  try {
    const content = readFileSync(INDEX_FILE, "utf8")
    const lines = content.split("\n").filter(Boolean).reverse()

    for (const line of lines) {
      if (results.length >= limit) break
      try {
        const entry: JournalEntry = JSON.parse(line)
        const searchText = `${entry.userMessage} ${entry.assistantResponse} ${entry.topics.join(" ")}`.toLowerCase()
        if (searchText.includes(queryLower)) {
          results.push(entry)
        }
      } catch {}
    }
  } catch {}

  return results
}

/** Get journal file list (for browsing) */
export function listJournalDays(limit: number = 30): Array<{ date: string; size: number }> {
  if (!existsSync(JOURNAL_DIR)) return []

  try {
    return readdirSync(JOURNAL_DIR)
      .filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse()
      .slice(0, limit)
      .map(f => {
        const fullPath = join(JOURNAL_DIR, f)
        const { statSync } = require("fs")
        return {
          date: f.replace(".md", ""),
          size: statSync(fullPath).size,
        }
      })
  } catch {
    return []
  }
}

/** Read a specific journal day */
export function readJournalDay(date: string): string | null {
  const filePath = join(JOURNAL_DIR, `${date}.md`)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

/** Format recent journal for system prompt injection */
export function formatJournalForPrompt(entries: JournalEntry[]): string {
  if (entries.length === 0) return ""

  const lines: string[] = ["RECENT JOURNAL (personal notes from past conversations):"]

  // Group by date
  const byDate = new Map<string, JournalEntry[]>()
  for (const entry of entries) {
    const existing = byDate.get(entry.date) ?? []
    existing.push(entry)
    byDate.set(entry.date, existing)
  }

  for (const [date, dayEntries] of byDate) {
    lines.push(`\n${date}:`)
    for (const entry of dayEntries.slice(0, 5)) {
      const summary = entry.userMessage.slice(0, 80)
      const topicStr = entry.topics.length > 0 ? ` [${entry.topics.join(", ")}]` : ""
      lines.push(`  ${entry.time} — ${summary}${topicStr}`)
    }
    if (dayEntries.length > 5) {
      lines.push(`  ...and ${dayEntries.length - 5} more entries`)
    }
  }

  lines.push("")
  return lines.join("\n")
}

// ─── Helpers ──────────────────────────────────

/** Extract topic keywords from conversation text */
function extractTopics(userMessage: string, assistantResponse: string): string[] {
  const text = `${userMessage} ${assistantResponse}`.toLowerCase()
  const topics: string[] = []

  // Project-related
  const projectKeywords = [
    "kronus", "daemon", "telegram", "dashboard", "persona", "scope",
    "chotu", "yolo", "brainstorm", "contentgen", "kronus-hub", "upwork",
    "proposal", "invoice", "client", "lead",
  ]
  for (const kw of projectKeywords) {
    if (text.includes(kw)) topics.push(kw)
  }

  // Action-related
  const actionKeywords = [
    "todo", "plan", "idea", "decision", "deploy", "ship", "build",
    "fix", "bug", "feature", "design", "review", "test",
  ]
  for (const kw of actionKeywords) {
    if (text.includes(kw)) topics.push(kw)
  }

  // Personal
  const personalKeywords = [
    "goal", "schedule", "meeting", "call", "travel", "health",
    "learn", "read", "write", "think",
  ]
  for (const kw of personalKeywords) {
    if (text.includes(kw)) topics.push(kw)
  }

  return [...new Set(topics)].slice(0, 8) // Max 8 topics
}
