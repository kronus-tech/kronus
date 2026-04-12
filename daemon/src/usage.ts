/**
 * Token Usage Tracking for Kronus v5.0
 *
 * Persists per-project token usage to daily JSONL files.
 * Provides aggregation for dashboard cost views.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const USAGE_DIR = join(homedir(), "second-brain", "kronus", "usage")

// Approximate API pricing for reference (not actual cost for subscription users)
// Claude Code subscription has its own billing — these are estimates only
const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000   // ~$3/1M input (API rate)
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000  // ~$15/1M output (API rate)

export interface UsageEntry {
  timestamp: string
  groupId: string
  project: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface ProjectUsageSummary {
  project: string
  groupId: string
  totalInput: number
  totalOutput: number
  totalCost: number
  turns: number
}

export interface DailyUsageSummary {
  date: string
  totalInput: number
  totalOutput: number
  totalCost: number
  turns: number
  byProject: Record<string, ProjectUsageSummary>
}

/** Record a usage event */
export function recordUsage(
  groupId: string,
  project: string,
  inputTokens: number,
  outputTokens: number
): void {
  if (!existsSync(USAGE_DIR)) {
    mkdirSync(USAGE_DIR, { recursive: true })
  }

  const cost = (inputTokens * COST_PER_INPUT_TOKEN) + (outputTokens * COST_PER_OUTPUT_TOKEN)
  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    groupId,
    project,
    inputTokens,
    outputTokens,
    costUsd: Math.round(cost * 10000) / 10000, // 4 decimal places
  }

  const date = entry.timestamp.slice(0, 10)
  const filePath = join(USAGE_DIR, `${date}.jsonl`)
  appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8")
}

/** Load usage for a specific date */
function loadDayUsage(date: string): UsageEntry[] {
  const filePath = join(USAGE_DIR, `${date}.jsonl`)
  if (!existsSync(filePath)) return []

  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as UsageEntry[]
  } catch {
    return []
  }
}

/** Get daily summary for a specific date */
export function getDailySummary(date: string): DailyUsageSummary {
  const entries = loadDayUsage(date)

  const byProject: Record<string, ProjectUsageSummary> = {}
  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0

  for (const entry of entries) {
    totalInput += entry.inputTokens
    totalOutput += entry.outputTokens
    totalCost += entry.costUsd

    if (!byProject[entry.project]) {
      byProject[entry.project] = {
        project: entry.project,
        groupId: entry.groupId,
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
        turns: 0,
      }
    }
    byProject[entry.project].totalInput += entry.inputTokens
    byProject[entry.project].totalOutput += entry.outputTokens
    byProject[entry.project].totalCost += entry.costUsd
    byProject[entry.project].turns++
  }

  return {
    date,
    totalInput,
    totalOutput,
    totalCost: Math.round(totalCost * 10000) / 10000,
    turns: entries.length,
    byProject,
  }
}

/** Get usage summaries for a range of days */
export function getUsageRange(daysBack: number = 7): DailyUsageSummary[] {
  const summaries: DailyUsageSummary[] = []

  for (let i = 0; i < daysBack; i++) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)
    const summary = getDailySummary(dateStr)
    if (summary.turns > 0) {
      summaries.push(summary)
    }
  }

  return summaries
}

/** Get per-project totals across all time */
export function getProjectTotals(): ProjectUsageSummary[] {
  if (!existsSync(USAGE_DIR)) return []

  const totals: Record<string, ProjectUsageSummary> = {}

  try {
    const files = readdirSync(USAGE_DIR).filter(f => f.endsWith(".jsonl")).sort().reverse()

    // Limit to last 30 days of files
    for (const file of files.slice(0, 30)) {
      const date = file.replace(".jsonl", "")
      const entries = loadDayUsage(date)

      for (const entry of entries) {
        if (!totals[entry.project]) {
          totals[entry.project] = {
            project: entry.project,
            groupId: entry.groupId,
            totalInput: 0,
            totalOutput: 0,
            totalCost: 0,
            turns: 0,
          }
        }
        totals[entry.project].totalInput += entry.inputTokens
        totals[entry.project].totalOutput += entry.outputTokens
        totals[entry.project].totalCost += entry.costUsd
        totals[entry.project].turns++
      }
    }
  } catch {}

  // Round costs
  for (const t of Object.values(totals)) {
    t.totalCost = Math.round(t.totalCost * 100) / 100
  }

  return Object.values(totals).sort((a, b) => b.totalCost - a.totalCost)
}

/** Get usage for a specific project */
export function getProjectUsage(groupId: string, daysBack: number = 7): UsageEntry[] {
  const entries: UsageEntry[] = []

  for (let i = 0; i < daysBack; i++) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)
    const dayEntries = loadDayUsage(dateStr).filter(e => e.groupId === groupId)
    entries.push(...dayEntries)
  }

  return entries
}
