import { join, basename } from "path"
import { homedir } from "os"
import type { SessionState, QueuedMessage, PermissionDenial } from "./types"
import { Logger, getProjectForGroup, getDefaults } from "./config"
import { appendSessionHistory, getAllLastSessions } from "./session-discovery"
import { PersistentSession, type PersistentCallbacks } from "./persistent-session"
import { BLOCKED_PATTERNS as DANGEROUS_PATTERNS } from "./types"

export interface SessionCallbacks {
  onText: (groupId: string, text: string) => Promise<void>
  onStreamText: (groupId: string, partialText: string) => Promise<void>
  onStreamEnd: (groupId: string) => Promise<void>
  onStatus: (groupId: string, status: string) => Promise<void>
  onQuestion: (groupId: string, question: import("./types").QuestionPayload) => Promise<string>
  onError: (groupId: string, error: string) => Promise<void>
  onReaction: (groupId: string, messageId: number, emoji: string) => Promise<void>
  onTyping: (groupId: string) => Promise<void>
  onFileSend: (groupId: string, filePath: string, caption: string) => Promise<void>
  onActivity: (groupId: string, type: string, data: Record<string, unknown>) => void
  onPermissionDenied: (groupId: string, denials: PermissionDenial[], lastMessage: string) => Promise<void>
  onSessionEnd: (groupId: string, sessionId: string | null) => void
}

const MAX_QUEUE_DEPTH = 10
const RATE_LIMIT_WINDOW_MS = 10000 // 10 seconds
const RATE_LIMIT_MAX_MESSAGES = 5   // max 5 messages per 10 seconds per group

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map()
  private persistentSessions: Map<string, PersistentSession> = new Map()
  private callbacks: SessionCallbacks
  private logger: Logger
  private sessionTimeoutMs: number
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private rateLimiter: Map<string, number[]> = new Map() // groupId → timestamps

  constructor(callbacks: SessionCallbacks, logger: Logger, sessionTimeoutMs: number = 3600000) {
    this.callbacks = callbacks
    this.logger = logger
    this.sessionTimeoutMs = sessionTimeoutMs
  }

  /** Restore session IDs from history file (survives daemon restarts) */
  restoreSessions(): void {
    const lastSessions = getAllLastSessions()
    let restored = 0
    for (const [groupId, sessionId] of Object.entries(lastSessions)) {
      const project = getProjectForGroup(groupId)
      if (project) {
        this.sessions.set(groupId, {
          sessionId,
          projectPath: project.path,
          groupId,
          lastActivity: Date.now(),
          isRunning: false,
          messageQueue: [],
          persistent: false,
          lastUserMessage: "",
          tempAllowedTools: [],
        })
        restored++
      }
    }
    if (restored > 0) {
      this.logger.info(`Restored ${restored} session(s) from history`)
    }
  }

  startCleanup(): void {
    this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), 60000)
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  private isDangerous(message: string): boolean {
    // Normalize whitespace before checking (collapse multiple spaces, trim)
    const normalized = message.replace(/\s+/g, " ").trim().toLowerCase()
    return DANGEROUS_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()))
  }

  /** Check rate limit for a group (token bucket) */
  private isRateLimited(groupId: string): boolean {
    const now = Date.now()
    let timestamps = this.rateLimiter.get(groupId) ?? []

    // Remove timestamps outside the window
    timestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS)

    if (timestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
      return true
    }

    timestamps.push(now)
    this.rateLimiter.set(groupId, timestamps)
    return false
  }

  /** Handle an incoming message — route to persistent session */
  async handleMessage(groupId: string, message: QueuedMessage): Promise<void> {
    if (this.isDangerous(message.text)) {
      await this.callbacks.onError(groupId, "Blocked: message contains a dangerous command pattern.")
      return
    }

    // Rate limiting
    if (this.isRateLimited(groupId)) {
      this.logger.warn(`Rate limited: ${groupId}`)
      await this.callbacks.onError(groupId, "Slow down — too many messages. Wait a few seconds.")
      return
    }

    // Check if persistent session exists and is processing
    const persistent = this.persistentSessions.get(groupId)
    if (persistent?.isRunning) {
      // Queue the message (with max depth)
      const session = this.sessions.get(groupId)
      if (session) {
        if (session.messageQueue.length >= MAX_QUEUE_DEPTH) {
          this.logger.warn(`Queue full for ${groupId} (${MAX_QUEUE_DEPTH} messages)`)
          await this.callbacks.onError(groupId, `Queue full (${MAX_QUEUE_DEPTH} messages). Wait for Claude to finish.`)
          return
        }
        session.messageQueue.push(message)
        this.logger.info(`Queued message for ${groupId} (${session.messageQueue.length} in queue)`)
      }
      return
    }

    await this.sendToPersistent(groupId, message.text, message.messageId)
  }

  /** Send a message to the persistent session (create if needed) */
  private async sendToPersistent(groupId: string, text: string, messageId: number = 0): Promise<void> {
    const project = getProjectForGroup(groupId)
    const defaults = getDefaults()
    const projectPath = project?.path ?? process.cwd()
    const allowedTools = project?.allowedTools ?? defaults.allowedTools
    const permissionMode = project?.permissionMode ?? defaults.permissionMode

    // Ensure session state exists
    let session = this.sessions.get(groupId)
    if (!session) {
      session = {
        sessionId: null,
        projectPath,
        groupId,
        lastActivity: Date.now(),
        isRunning: false,
        messageQueue: [],
        persistent: true,
        lastUserMessage: "",
        tempAllowedTools: [],
      }
      this.sessions.set(groupId, session)
    }

    session.lastActivity = Date.now()
    session.isRunning = true
    session.lastUserMessage = text

    // Get or create persistent session
    let persistent = this.persistentSessions.get(groupId)

    if (!persistent || !persistent.isAlive) {
      // Create new persistent session
      const callbacks: PersistentCallbacks = {
        onText: this.callbacks.onText,
        onStreamText: this.callbacks.onStreamText,
        onStreamEnd: this.callbacks.onStreamEnd,
        onStatus: this.callbacks.onStatus,
        onQuestion: this.callbacks.onQuestion,
        onError: this.callbacks.onError,
        onReaction: this.callbacks.onReaction,
        onTyping: this.callbacks.onTyping,
        onFileSend: this.callbacks.onFileSend,
        onActivity: this.callbacks.onActivity,
        onPermissionDenied: this.callbacks.onPermissionDenied,
        onSessionReady: (gId, sid) => {
          const s = this.sessions.get(gId)
          if (s) s.sessionId = sid
          this.logger.info(`Session ready for ${gId}: ${sid}`)
        },
        onTurnComplete: (gId) => {
          const s = this.sessions.get(gId)
          if (s && s.messageQueue.length > 0) {
            const next = s.messageQueue.shift()!
            this.logger.info(`Dequeuing message for ${gId} (${s.messageQueue.length} remaining)`)
            this.sendToPersistent(gId, next.text, next.messageId)
          }
        },
        onProcessDied: (gId) => {
          const s = this.sessions.get(gId)
          if (s) s.isRunning = false
          this.logger.warn(`Persistent process died for ${gId}`)

          // Process queued messages by restarting
          if (s && s.messageQueue.length > 0) {
            const next = s.messageQueue.shift()!
            this.sendToPersistent(gId, next.text, next.messageId)
          }
        },
      }

      const projectName = project?.name ?? basename(projectPath)

      persistent = new PersistentSession(
        groupId,
        projectPath,
        projectName,
        allowedTools,
        permissionMode,
        callbacks,
        this.logger,
      )

      this.persistentSessions.set(groupId, persistent)

      // Start with resume if we have a session ID
      await persistent.start(session.sessionId ?? undefined)
    }

    // Send message
    try {
      await persistent.sendMessage(text, messageId)
    } catch (error) {
      this.logger.error(`Failed to send message to persistent session: ${error}`)
      session.isRunning = false
      // Process died — try to restart
      this.persistentSessions.delete(groupId)
      await this.callbacks.onError(groupId, `Session error — retrying...`)
      // Retry with a new session
      await this.sendToPersistent(groupId, text, messageId)
    }
  }

  /** Add temp allowed tool and restart session so it takes effect */
  addTempAllowedTool(groupId: string, tool: string): void {
    const persistent = this.persistentSessions.get(groupId)
    if (persistent) {
      persistent.addTempAllowedTool(tool)
    }
    const session = this.sessions.get(groupId)
    if (session) {
      if (!session.tempAllowedTools.includes(tool)) {
        session.tempAllowedTools.push(tool)
      }
    }
  }

  /** Restart persistent session with updated tools (preserves conversation via --resume) */
  async restartWithUpdatedTools(groupId: string): Promise<void> {
    const persistent = this.persistentSessions.get(groupId)
    if (persistent) {
      await persistent.restart()
      this.logger.info(`Restarted session for ${groupId} with updated tools`)
    }
  }

  /** Get last user message for a group (for retry after permission approval) */
  getLastUserMessage(groupId: string): string {
    return this.sessions.get(groupId)?.lastUserMessage ?? ""
  }

  /** Change permission mode */
  setPermissionMode(groupId: string, mode: string): void {
    this.logger.info(`Permission mode for ${groupId} changed to ${mode}`)
    // Need to restart persistent session with new mode
    const persistent = this.persistentSessions.get(groupId)
    if (persistent) {
      persistent.stop().then(() => {
        this.persistentSessions.delete(groupId)
        this.logger.info(`Persistent session restarted for ${groupId} with new mode: ${mode}`)
      })
    }
  }

  /** Reset session */
  resetSession(groupId: string): boolean {
    const session = this.sessions.get(groupId)
    if (session?.isRunning) return false

    const persistent = this.persistentSessions.get(groupId)
    if (persistent) {
      persistent.stop()
      this.persistentSessions.delete(groupId)
    }

    if (session) {
      session.sessionId = null
      session.messageQueue = []
      session.tempAllowedTools = []
    }
    this.sessions.delete(groupId)
    return true
  }

  /** Set session ID (for /resume) */
  setSessionId(groupId: string, sessionId: string): void {
    // Kill existing persistent session so next message starts fresh with this ID
    const persistent = this.persistentSessions.get(groupId)
    if (persistent) {
      persistent.stop()
      this.persistentSessions.delete(groupId)
    }

    let session = this.sessions.get(groupId)
    if (!session) {
      const project = getProjectForGroup(groupId)
      session = {
        sessionId: null,
        projectPath: project?.path ?? process.cwd(),
        groupId,
        lastActivity: Date.now(),
        isRunning: false,
        messageQueue: [],
        persistent: true,
        lastUserMessage: "",
        tempAllowedTools: [],
      }
      this.sessions.set(groupId, session)
    }
    session.sessionId = sessionId
    this.logger.info(`Session ID set for ${groupId}: ${sessionId}`)
  }

  /** Stop a running session */
  async stopSession(groupId: string): Promise<boolean> {
    const persistent = this.persistentSessions.get(groupId)
    if (persistent) {
      await persistent.stop()
      this.persistentSessions.delete(groupId)
      const session = this.sessions.get(groupId)
      if (session) session.isRunning = false
      return true
    }
    return false
  }

  /** Get session ID */
  getSessionId(groupId: string): string | null {
    return this.sessions.get(groupId)?.sessionId ?? null
  }

  /** Get status of all sessions */
  getStatus(): Array<{
    groupId: string
    sessionId: string | null
    isRunning: boolean
    lastActivity: number
    queueSize: number
    persistent: boolean
  }> {
    return Array.from(this.sessions.entries()).map(([groupId, session]) => {
      const persistent = this.persistentSessions.get(groupId)
      return {
        groupId,
        sessionId: session.sessionId,
        isRunning: persistent?.isRunning ?? session.isRunning,
        lastActivity: session.lastActivity,
        queueSize: session.messageQueue.length,
        persistent: persistent?.isAlive ?? false,
      }
    })
  }

  /** Clean up idle sessions */
  private cleanupIdleSessions(): void {
    const now = Date.now()
    for (const [groupId, session] of this.sessions) {
      if (!session.isRunning && now - session.lastActivity > this.sessionTimeoutMs) {
        this.logger.info(`Cleaning up idle session for ${groupId}`)
        const persistent = this.persistentSessions.get(groupId)
        if (persistent) {
          persistent.stop()
          this.persistentSessions.delete(groupId)
        }
        this.sessions.delete(groupId)
      }
    }
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    this.stopCleanup()
    this.logger.info("Shutting down all sessions...")

    const stopPromises = Array.from(this.persistentSessions.entries()).map(
      async ([groupId, persistent]) => {
        this.logger.info(`Stopping persistent session for ${groupId}`)

        // Record session history before stopping
        const session = this.sessions.get(groupId)
        if (session?.sessionId) {
          try {
            appendSessionHistory(groupId, {
              sessionId: session.sessionId,
              projectPath: session.projectPath,
              startedAt: new Date(session.lastActivity).toISOString(),
              endedAt: new Date().toISOString(),
              source: "daemon",
            })
          } catch {
            // Best effort
          }
        }

        await persistent.stop()
      }
    )

    await Promise.all(stopPromises)
    this.persistentSessions.clear()
    this.sessions.clear()
  }
}
