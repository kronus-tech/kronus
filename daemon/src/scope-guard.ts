/**
 * Scope Guard — daemon-side approval handler
 *
 * Watches the approval directory for pending scope violation requests
 * from the PreToolUse hook. Sends Telegram approval buttons to the admin.
 * Writes decisions back to the request file for the hook to read.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Bot } from "grammy"
import { InlineKeyboard } from "grammy"
import { Logger, loadAccess } from "./config"

const APPROVAL_DIR = join(homedir(), ".claude", "channels", "telegram", "scope-approvals")
const HISTORY_FILE = join(APPROVAL_DIR, "history.jsonl")

export interface ScopeRequest {
  id: string
  tool: string
  path: string
  project: string
  group_id: string
  timestamp: number
  status: "pending" | "approved" | "denied" | "approved_always"
}

export interface ScopeHistoryEntry extends ScopeRequest {
  decidedAt: string
  decidedBy: "telegram" | "dashboard" | "timeout"
}

export class ScopeGuard {
  private bot: Bot
  private logger: Logger
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private processedRequests: Set<string> = new Set()

  constructor(bot: Bot, logger: Logger) {
    this.bot = bot
    this.logger = logger

    // Ensure approval directory exists
    if (!existsSync(APPROVAL_DIR)) {
      mkdirSync(APPROVAL_DIR, { recursive: true })
    }
  }

  /** Get the approval directory path */
  static getApprovalDir(): string {
    if (!existsSync(APPROVAL_DIR)) {
      mkdirSync(APPROVAL_DIR, { recursive: true })
    }
    return APPROVAL_DIR
  }

  /** Start polling for approval requests */
  start(): void {
    this.logger.info("Scope guard started — watching for approval requests")
    // Poll every 500ms for fast response
    this.pollInterval = setInterval(() => this.checkPendingRequests(), 500)
  }

  /** Stop polling */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  /** Check for new pending approval requests */
  private async checkPendingRequests(): Promise<void> {
    try {
      if (!existsSync(APPROVAL_DIR)) return

      const files = readdirSync(APPROVAL_DIR).filter(f => f.endsWith(".json"))

      for (const file of files) {
        const requestId = file.replace(".json", "")
        if (this.processedRequests.has(requestId)) continue

        const filePath = join(APPROVAL_DIR, file)
        try {
          const content = readFileSync(filePath, "utf8")
          const request: ScopeRequest = JSON.parse(content)

          if (request.status !== "pending") continue

          // Mark as processed so we don't send duplicate notifications
          this.processedRequests.add(requestId)

          // Send approval request to admin
          await this.sendApprovalRequest(request)
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  /** Send Telegram approval request to admin */
  private async sendApprovalRequest(request: ScopeRequest): Promise<void> {
    const access = loadAccess()
    const adminId = access.allowFrom[0] // Primary admin

    if (!adminId) {
      this.logger.error("No admin user found for scope approval")
      this.writeDecision(request.id, "denied")
      return
    }

    // Shorten paths for display
    const homeDir = homedir()
    const displayPath = request.path.replace(homeDir, "~")
    const displayProject = request.project.replace(homeDir, "~")

    const keyboard = new InlineKeyboard()
      .text("✅ Approve Once", `scope_approve_${request.id}`)
      .text("✅ Always Allow Dir", `scope_always_${request.id}`).row()
      .text("❌ Deny", `scope_deny_${request.id}`)

    const groupLabel = request.group_id ? ` (group ${request.group_id})` : ""

    try {
      await this.bot.api.sendMessage(parseInt(adminId, 10),
        `🔒 <b>Scope Approval Required</b>${groupLabel}\n\n` +
        `<b>Tool:</b> ${request.tool}\n` +
        `<b>Path:</b> <code>${displayPath}</code>\n` +
        `<b>Project:</b> <code>${displayProject}</code>\n\n` +
        `Claude wants to access a file outside the project directory.`,
        { parse_mode: "HTML", reply_markup: keyboard }
      )
      this.logger.info(`Scope approval request sent to admin: ${request.tool} → ${displayPath}`)
    } catch (error) {
      this.logger.error(`Failed to send scope approval: ${error}`)
      // Deny on failure to reach admin
      this.writeDecision(request.id, "denied")
    }
  }

  /** Handle callback from Telegram button press */
  async handleCallback(data: string): Promise<{ requestId: string; action: string } | null> {
    if (!data.startsWith("scope_")) return null

    const parts = data.split("_")
    const action = parts[1] // approve, always, deny
    const requestId = parts.slice(2).join("_")

    let status: ScopeRequest["status"]
    switch (action) {
      case "approve":
        status = "approved"
        break
      case "always":
        status = "approved_always"
        break
      case "deny":
        status = "denied"
        break
      default:
        return null
    }

    this.writeDecision(requestId, status, "telegram")
    this.logger.info(`Scope ${status}: ${requestId}`)

    // Clean up processed set after a delay
    setTimeout(() => this.processedRequests.delete(requestId), 5000)

    return { requestId, action: status }
  }

  /** Write decision back to the request file and log to history */
  writeDecision(requestId: string, status: ScopeRequest["status"], source: "telegram" | "dashboard" | "timeout" = "telegram"): void {
    const filePath = join(APPROVAL_DIR, `${requestId}.json`)
    try {
      if (!existsSync(filePath)) return
      const content = readFileSync(filePath, "utf8")
      const request: ScopeRequest = JSON.parse(content)
      request.status = status
      writeFileSync(filePath, JSON.stringify(request), "utf8")

      // Log to history
      const historyEntry: ScopeHistoryEntry = {
        ...request,
        decidedAt: new Date().toISOString(),
        decidedBy: source,
      }
      appendFileSync(HISTORY_FILE, JSON.stringify(historyEntry) + "\n", "utf8")
    } catch (error) {
      this.logger.error(`Failed to write scope decision: ${error}`)
    }
  }

  /** Get all pending requests */
  getPending(): ScopeRequest[] {
    if (!existsSync(APPROVAL_DIR)) return []
    const pending: ScopeRequest[] = []
    try {
      const files = readdirSync(APPROVAL_DIR).filter(f => f.endsWith(".json") && f !== "history.jsonl")
      for (const file of files) {
        try {
          const content = readFileSync(join(APPROVAL_DIR, file), "utf8")
          const request: ScopeRequest = JSON.parse(content)
          if (request.status === "pending") pending.push(request)
        } catch {}
      }
    } catch {}
    return pending
  }

  /** Get approval history (most recent first) */
  getHistory(limit: number = 50): ScopeHistoryEntry[] {
    if (!existsSync(HISTORY_FILE)) return []
    try {
      const content = readFileSync(HISTORY_FILE, "utf8")
      return content
        .split("\n")
        .filter(Boolean)
        .map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter(Boolean)
        .reverse()
        .slice(0, limit) as ScopeHistoryEntry[]
    } catch {
      return []
    }
  }

  /** Read per-project scope allowlist */
  static getAllowlist(projectPath: string): string[] {
    const allowlistFile = join(projectPath, ".claude", "scope-allowlist.json")
    if (!existsSync(allowlistFile)) return []
    try {
      const data = JSON.parse(readFileSync(allowlistFile, "utf8"))
      return data.allowed_paths ?? []
    } catch {
      return []
    }
  }

  /** Update per-project scope allowlist */
  static setAllowlist(projectPath: string, paths: string[]): void {
    const dir = join(projectPath, ".claude")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const allowlistFile = join(dir, "scope-allowlist.json")
    writeFileSync(allowlistFile, JSON.stringify({ allowed_paths: paths }, null, 2), "utf8")
  }

  /** Clean up old request files (older than 5 minutes) */
  cleanup(): void {
    try {
      if (!existsSync(APPROVAL_DIR)) return
      const files = readdirSync(APPROVAL_DIR).filter(f => f.endsWith(".json"))
      const now = Date.now() / 1000

      for (const file of files) {
        const filePath = join(APPROVAL_DIR, file)
        try {
          const content = readFileSync(filePath, "utf8")
          const request: ScopeRequest = JSON.parse(content)
          if (now - request.timestamp > 300) { // 5 min
            const { unlinkSync } = require("fs")
            unlinkSync(filePath)
            this.processedRequests.delete(request.id)
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }
}
