/**
 * Daily Briefing System for Kronus v5.0
 *
 * Sends a structured morning briefing to the admin's DM with:
 * - Git activity across all projects (last 24h)
 * - Pending todos from cross-session memory
 * - Recent decisions
 * - Active sessions status
 * - Pending scope approvals
 *
 * Runs on a configurable timer (default: 9:00 AM local time).
 */

import { execSync } from "child_process"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Bot } from "grammy"
import { loadProjects, loadAccess, Logger } from "./config"
import { loadAllMemories, type MemoryEntry } from "./memory"
import type { SessionManager } from "./session-manager"

const APPROVAL_DIR = join(homedir(), ".claude", "channels", "telegram", "scope-approvals")

interface BriefingConfig {
  hour: number      // 0-23, local time
  minute: number    // 0-59
  enabled: boolean
}

interface GitActivity {
  project: string
  commits: number
  lastCommit: string
  branch: string
}

export class BriefingScheduler {
  private bot: Bot
  private logger: Logger
  private sessionManager: SessionManager
  private adminChatId: string
  private config: BriefingConfig
  private timer: ReturnType<typeof setInterval> | null = null
  private lastBriefingDate: string = ""

  constructor(
    bot: Bot,
    logger: Logger,
    sessionManager: SessionManager,
    config?: Partial<BriefingConfig>
  ) {
    this.bot = bot
    this.logger = logger
    this.sessionManager = sessionManager

    // Get admin chat ID (owner's user ID = DM chat ID)
    const access = loadAccess()
    this.adminChatId = access.allowFrom[0] ?? ""

    this.config = {
      hour: config?.hour ?? 9,
      minute: config?.minute ?? 0,
      enabled: config?.enabled ?? true,
    }
  }

  /** Start the briefing scheduler — checks every minute if it's time */
  start(): void {
    if (!this.config.enabled || !this.adminChatId) {
      this.logger.info("Daily briefing disabled or no admin configured")
      return
    }

    this.logger.info(`Daily briefing scheduled for ${String(this.config.hour).padStart(2, "0")}:${String(this.config.minute).padStart(2, "0")} local time`)

    // Check every 60 seconds
    this.timer = setInterval(() => this.checkAndSend(), 60000)
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Send a briefing immediately (for /briefing command) */
  async sendNow(): Promise<void> {
    await this.sendBriefing()
  }

  /** Check if it's time to send the briefing */
  private async checkAndSend(): Promise<void> {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)

    // Already sent today?
    if (this.lastBriefingDate === today) return

    // Is it the right time?
    if (now.getHours() === this.config.hour && now.getMinutes() === this.config.minute) {
      this.lastBriefingDate = today
      await this.sendBriefing()
    }
  }

  /** Generate and send the briefing */
  private async sendBriefing(): Promise<void> {
    this.logger.info("Generating daily briefing...")

    try {
      const sections: string[] = []
      const now = new Date()
      const dayName = now.toLocaleDateString("en-US", { weekday: "long" })
      const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

      sections.push(`<b>☀️ Morning Briefing — ${dayName}, ${dateStr}</b>\n`)

      // 1. Git activity
      const gitSection = this.getGitActivity()
      if (gitSection) sections.push(gitSection)

      // 2. Pending todos from memory
      const todosSection = this.getTodos()
      if (todosSection) sections.push(todosSection)

      // 3. Recent decisions
      const decisionsSection = this.getDecisions()
      if (decisionsSection) sections.push(decisionsSection)

      // 4. Active sessions
      const sessionsSection = this.getSessionStatus()
      if (sessionsSection) sections.push(sessionsSection)

      // 5. Pending scope approvals
      const approvalsSection = this.getPendingApprovals()
      if (approvalsSection) sections.push(approvalsSection)

      // Send
      const message = sections.join("\n")
      if (this.adminChatId) {
        // Split if too long (Telegram limit is 4096)
        if (message.length > 4000) {
          const mid = message.lastIndexOf("\n", 2000)
          await this.bot.api.sendMessage(parseInt(this.adminChatId, 10), message.slice(0, mid), { parse_mode: "HTML" })
          await this.bot.api.sendMessage(parseInt(this.adminChatId, 10), message.slice(mid), { parse_mode: "HTML" })
        } else {
          await this.bot.api.sendMessage(parseInt(this.adminChatId, 10), message, { parse_mode: "HTML" })
        }
        this.logger.info("Daily briefing sent to admin DM")
      }
    } catch (error) {
      this.logger.error(`Failed to send briefing: ${error}`)
    }
  }

  /** Scan git activity across all projects (last 24h) */
  private getGitActivity(): string {
    const projects = loadProjects()
    const activities: GitActivity[] = []

    for (const [, project] of Object.entries(projects.projects)) {
      if (!existsSync(join(project.path, ".git"))) continue

      try {
        const sinceDate = new Date(Date.now() - 86400000).toISOString()

        // Count commits in last 24h
        const countOutput = execSync(
          `git -C "${project.path}" log --oneline --since="${sinceDate}" 2>/dev/null | wc -l`,
          { encoding: "utf8", timeout: 5000 }
        ).trim()
        const commits = parseInt(countOutput, 10) || 0

        if (commits === 0) continue

        // Get last commit message
        const lastCommit = execSync(
          `git -C "${project.path}" log --oneline -1 2>/dev/null`,
          { encoding: "utf8", timeout: 5000 }
        ).trim()

        // Get current branch
        const branch = execSync(
          `git -C "${project.path}" branch --show-current 2>/dev/null`,
          { encoding: "utf8", timeout: 5000 }
        ).trim()

        activities.push({
          project: project.name,
          commits,
          lastCommit: lastCommit.slice(9), // Skip hash
          branch,
        })
      } catch {
        // Skip projects with git errors
      }
    }

    if (activities.length === 0) return ""

    const lines = ["<b>📊 Git Activity (24h)</b>"]
    for (const act of activities) {
      lines.push(`  <b>${act.project}</b> (${act.branch}) — ${act.commits} commit${act.commits > 1 ? "s" : ""}`)
      lines.push(`  └ ${act.lastCommit}`)
    }
    return lines.join("\n") + "\n"
  }

  /** Get pending todos from memory */
  private getTodos(): string {
    const memories = loadAllMemories(7, 200)
    const todos = memories.filter(m => m.type === "todo" && !m.done)

    if (todos.length === 0) return ""

    // Deduplicate by content
    const seen = new Set<string>()
    const unique = todos.filter(t => {
      const key = t.content.toLowerCase().slice(0, 40)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const lines = ["<b>📋 Pending Todos</b>"]
    for (const todo of unique.slice(0, 10)) {
      const age = formatAge(todo.timestamp)
      lines.push(`  ☐ [${todo.project}] ${escapeHtml(todo.content.slice(0, 100))} <i>(${age})</i>`)
    }
    if (unique.length > 10) {
      lines.push(`  <i>...and ${unique.length - 10} more</i>`)
    }
    return lines.join("\n") + "\n"
  }

  /** Get recent decisions from memory */
  private getDecisions(): string {
    const memories = loadAllMemories(3, 200)
    const decisions = memories.filter(m => m.type === "decision")

    if (decisions.length === 0) return ""

    const seen = new Set<string>()
    const unique = decisions.filter(d => {
      const key = d.content.toLowerCase().slice(0, 40)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const lines = ["<b>🎯 Recent Decisions</b>"]
    for (const dec of unique.slice(0, 5)) {
      const age = formatAge(dec.timestamp)
      lines.push(`  • [${dec.project}] ${escapeHtml(dec.content.slice(0, 100))} <i>(${age})</i>`)
    }
    return lines.join("\n") + "\n"
  }

  /** Get active session status */
  private getSessionStatus(): string {
    const sessions = this.sessionManager.getStatus()
    const projects = loadProjects()
    const running = sessions.filter(s => s.isRunning)
    const total = sessions.length

    const lines = [`<b>⚡ Sessions:</b> ${running.length} running / ${total} total`]

    if (running.length > 0) {
      for (const s of running) {
        const age = Math.round((Date.now() - s.lastActivity) / 60000)
        const name = projects.projects[s.groupId]?.name ?? s.groupId
        lines.push(`  🟢 ${name} (${age}m ago)`)
      }
    }

    return lines.join("\n") + "\n"
  }

  /** Check for pending scope approvals */
  private getPendingApprovals(): string {
    if (!existsSync(APPROVAL_DIR)) return ""

    try {
      const files = readdirSync(APPROVAL_DIR).filter(f => f.endsWith(".json"))
      let pending = 0

      for (const file of files) {
        try {
          const content = readFileSync(join(APPROVAL_DIR, file), "utf8")
          const req = JSON.parse(content)
          if (req.status === "pending") pending++
        } catch {}
      }

      if (pending === 0) return ""
      return `<b>🔒 Scope Approvals:</b> ${pending} pending — use /approve to review\n`
    } catch {
      return ""
    }
  }
}

// ─── Helpers ──────────────────────────────────

function formatAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime()
  const hours = Math.floor(ms / 3600000)
  if (hours < 1) return "just now"
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  return `${days}d ago`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
