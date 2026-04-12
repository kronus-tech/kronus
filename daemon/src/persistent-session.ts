import { spawn, type Subprocess } from "bun"
import { join } from "path"
import { homedir } from "os"
import type { SessionState, PermissionDenial, QueuedMessage } from "./types"
import { parseStream, extractText, extractQuestion, extractToolUse, isResult, isAssistantMessage, formatToolStatus, chunkText, markdownToTelegramHtml, stripHtml } from "./stream-parser"
import { Logger } from "./config"
import { buildSystemPrompt } from "./system-prompt"
import { ScopeGuard } from "./scope-guard"
import { extractMemories, saveMemories } from "./memory"
import { saveJournalEntry } from "./journal"
import { recordUsage } from "./usage"
import { synthesizePersonalNotes } from "./note-synth"

export interface PersistentCallbacks {
  onText: (groupId: string, text: string) => Promise<void>
  onStreamText: (groupId: string, partialText: string) => Promise<void>
  onStreamEnd: (groupId: string) => Promise<void>
  onStatus: (groupId: string, status: string) => Promise<void>
  onQuestion: (groupId: string, question: import("./types").QuestionPayload) => Promise<string>
  onError: (groupId: string, error: string) => Promise<void>
  onReaction: (groupId: string, messageId: number, emoji: string) => Promise<void>
  onTyping: (groupId: string) => Promise<void>
  onFileSend: (groupId: string, filePath: string, caption: string) => Promise<void>
  onPermissionDenied: (groupId: string, denials: PermissionDenial[], lastMessage: string) => Promise<void>
  onActivity: (groupId: string, type: string, data: Record<string, unknown>) => void
  onSessionReady: (groupId: string, sessionId: string) => void
  onProcessDied: (groupId: string) => void
}

export class PersistentSession {
  private proc: Subprocess | null = null
  private stdinSink: any | null = null  // Bun FileSink (not WritableStream)
  private sessionId: string | null = null
  private groupId: string
  private projectPath: string
  private projectName: string
  private allowedTools: string[]
  private permissionMode: string
  private callbacks: PersistentCallbacks
  private logger: Logger
  private isProcessing = false
  private lastUserMessage = ""
  private tempAllowedTools: string[] = []
  private typingInterval: ReturnType<typeof setInterval> | null = null
  private triggerMessageId = 0
  private streamBuffer = ""
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null
  private outputLoopPromise: Promise<void> | null = null

  constructor(
    groupId: string,
    projectPath: string,
    projectName: string,
    allowedTools: string[],
    permissionMode: string,
    callbacks: PersistentCallbacks,
    logger: Logger,
  ) {
    this.groupId = groupId
    this.projectPath = projectPath
    this.projectName = projectName
    this.allowedTools = allowedTools
    this.permissionMode = permissionMode
    this.callbacks = callbacks
    this.logger = logger
  }

  get isAlive(): boolean {
    return this.proc !== null
  }

  get isRunning(): boolean {
    return this.isProcessing
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  /** Start the persistent Claude process */
  async start(resumeSessionId?: string): Promise<void> {
    if (this.proc) {
      this.logger.warn(`Process already running for ${this.groupId}`)
      return
    }

    const secondBrain = join(homedir(), "second-brain")
    const allTools = [...new Set([...this.allowedTools, ...this.tempAllowedTools])]
    const systemPrompt = buildSystemPrompt(this.projectPath, this.projectName, this.permissionMode)

    const args = [
      "claude",
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--allowedTools", allTools.join(","),
      "--permission-mode", this.permissionMode,
      "--add-dir", secondBrain,
      "--append-system-prompt", systemPrompt,
    ]

    if (resumeSessionId) {
      args.push("--resume", resumeSessionId)
    }

    this.logger.info(`Starting persistent session for ${this.groupId}: ${this.projectPath}`)
    this.logger.debug(`Args: ${args.join(" ")}`)

    this.proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      cwd: this.projectPath,
      env: {
        ...process.env,
        KRONUS_SCOPE_GUARD: "1",
        KRONUS_PROJECT_PATH: this.projectPath,
        KRONUS_GROUP_ID: this.groupId,
        KRONUS_APPROVAL_DIR: ScopeGuard.getApprovalDir(),
      },
    })

    // Get stdin (Bun FileSink — has .write() and .flush())
    this.stdinSink = this.proc.stdin

    // Start output processing loop (runs continuously)
    this.outputLoopPromise = this.processOutput()

    // Process stderr in background
    this.processStderr()

    // Wait for init event
    await new Promise<void>((resolve) => {
      const checkInit = setInterval(() => {
        if (this.sessionId) {
          clearInterval(checkInit)
          resolve()
        }
      }, 100)
      // Timeout after 10s
      setTimeout(() => {
        clearInterval(checkInit)
        resolve()
      }, 10000)
    })

    this.logger.info(`Persistent session started for ${this.groupId} (session: ${this.sessionId ?? "pending"})`)
  }

  /** Send a message to the running process */
  async sendMessage(text: string, messageId: number = 0): Promise<void> {
    if (!this.proc || !this.stdinSink) {
      throw new Error("Process not running")
    }

    this.lastUserMessage = text
    this.triggerMessageId = messageId
    this.isProcessing = true
    this.streamBuffer = ""

    // Start typing indicator
    this.startTyping()

    // Update reaction
    if (messageId) {
      await this.callbacks.onReaction(this.groupId, messageId, "⚡").catch(() => {})
    }

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
    }) + "\n"

    try {
      this.stdinSink.write(msg)
      this.stdinSink.flush()
      this.logger.debug(`Sent message to persistent session for ${this.groupId}: ${text.slice(0, 80)}`)
    } catch (error) {
      this.isProcessing = false
      this.stopTyping()
      throw error
    }
  }

  /** Add a temporary allowed tool (for permission approval) */
  addTempAllowedTool(tool: string): void {
    if (!this.tempAllowedTools.includes(tool)) {
      this.tempAllowedTools.push(tool)
      this.logger.info(`Added temp allowed tool for ${this.groupId}: ${tool}`)
    }
  }

  /** Restart the process with updated tools (preserves session via --resume) */
  async restart(): Promise<void> {
    const resumeId = this.sessionId
    this.logger.info(`Restarting persistent session for ${this.groupId} with updated tools`)
    await this.stop()
    await this.start(resumeId ?? undefined)
  }

  /** Process stdout events continuously */
  private async processOutput(): Promise<void> {
    if (!this.proc) return

    let accumulatedText = ""
    let lastStatusUpdate = 0
    const writtenFiles = new Set<string>()

    try {
      for await (const event of parseStream(this.proc.stdout)) {
        const eventLabel = `${event.type}${event.subtype ? '/' + event.subtype : ''}`
        this.logger.debug(`[${this.groupId}] Event: ${eventLabel}`)

        // Emit activity for dashboard live viewer
        try {
          if (isAssistantMessage(event)) {
            const toolUse = extractToolUse(event)
            const text = extractText(event)
            if (toolUse) {
              const status = formatToolStatus(toolUse)
              this.callbacks.onActivity(this.groupId, "tool_use", { tool: toolUse.name, status, input: JSON.stringify(toolUse.input).slice(0, 200) })
            } else if (text) {
              this.callbacks.onActivity(this.groupId, "text", { text: text.slice(0, 300), from: "assistant" })
            }
          } else if (isResult(event)) {
            this.callbacks.onActivity(this.groupId, "result", {
              text: ((event as any).result || "").slice(0, 300),
              inputTokens: (event as any).usage?.input_tokens,
              outputTokens: (event as any).usage?.output_tokens,
            })
          }
        } catch {}

        // System init
        if (event.type === "system" && event.subtype === "init") {
          this.sessionId = event.session_id as string
          this.callbacks.onSessionReady(this.groupId, this.sessionId)
          continue
        }

        // Result event — turn complete
        if (isResult(event)) {
          this.sessionId = event.session_id

          // Send raw text to onText — the router handles markdown→HTML conversion
          const textToSend = event.result || accumulatedText
          if (textToSend) {
            try {
              await this.callbacks.onText(this.groupId, textToSend)
            } catch (error) {
              this.logger.error(`Failed to send result for ${this.groupId}: ${error}`)
            }

            // Auto-send files: from tool_use tracking + regex in response text
            const filesToSend = new Set<string>(writtenFiles)

            // Also detect paths mentioned in response text
            const fileMatches = textToSend.match(/(?:\/|output\/)[^\s"'`\])>]+\.(png|jpg|jpeg|webp|pdf|zip)/gi)
            if (fileMatches) {
              for (const fp of fileMatches) {
                filesToSend.add(fp.replace(/[`"']/g, ""))
              }
            }

            if (filesToSend.size > 0 && this.callbacks.onFileSend) {
              this.logger.info(`Auto-sending ${filesToSend.size} file(s) for ${this.groupId}`)
              for (const filePath of filesToSend) {
                try {
                  await this.callbacks.onFileSend(this.groupId, filePath, "")
                } catch {
                  this.logger.debug(`Could not auto-send: ${filePath}`)
                }
              }
            }
            writtenFiles.clear()
          }

          // Extract and save memories from this turn
          try {
            const allText = `${this.lastUserMessage}\n${textToSend ?? accumulatedText}`
            if (allText.length > 20) {
              const userMemories = extractMemories(this.lastUserMessage, this.projectName, this.groupId, "user")
              const assistantMemories = extractMemories(textToSend ?? accumulatedText, this.projectName, this.groupId, "assistant")
              const memories = [...userMemories, ...assistantMemories]
              if (memories.length > 0) {
                saveMemories(memories)
                this.logger.debug(`Saved ${memories.length} memory entries for ${this.groupId}`)

                // Personal DM only: synthesize linked markdown notes for knowledge graph
                if (this.projectName === "kronus-personal") {
                  try {
                    const notesCreated = synthesizePersonalNotes(memories)
                    if (notesCreated > 0) {
                      this.logger.debug(`Synthesized ${notesCreated} linked notes from personal session`)
                    }
                  } catch (synthErr) {
                    this.logger.debug(`Note synthesis failed: ${synthErr}`)
                  }
                }
              }
            }
          } catch (error) {
            this.logger.debug(`Memory extraction failed for ${this.groupId}: ${error}`)
          }

          // Log and persist usage
          if (event.usage) {
            const inp = event.usage.input_tokens as number
            const out = event.usage.output_tokens as number
            this.logger.info(`Usage for ${this.groupId}: ${inp} in / ${out} out`)
            try {
              recordUsage(this.groupId, this.projectName, inp, out)
            } catch {
              // Usage tracking failure should never block sessions
            }
          }

          // Check permission denials
          const denials = (event as any).permission_denials as PermissionDenial[] | undefined
          if (denials && denials.length > 0) {
            this.logger.info(`Permission denials for ${this.groupId}: ${denials.length}`)
            await this.callbacks.onPermissionDenied(this.groupId, denials, this.lastUserMessage)
          }

          // Success reaction
          if (this.triggerMessageId) {
            const emoji = (denials && denials.length > 0) ? "🤔" : "🎉"
            await this.callbacks.onReaction(this.groupId, this.triggerMessageId, emoji).catch(() => {})
          }

          // Detect waiting for reply
          const trimmed = (textToSend ?? "").trimEnd()
          if (trimmed.endsWith("?") || trimmed.match(/pick|choose|select|which|what about/i)) {
            await this.callbacks.onStatus(this.groupId, "💬 Waiting for your reply...")
          }

          // Reset state for next turn
          accumulatedText = ""
          this.isProcessing = false
          this.stopTyping()

          // Save transcript
          this.saveTranscript(textToSend ?? "", accumulatedText)

          // Save to personal journal (DM sessions only)
          if (this.projectName === "kronus-personal" && this.lastUserMessage && textToSend) {
            try {
              saveJournalEntry(this.lastUserMessage, textToSend)
              this.logger.debug(`Journal entry saved for personal DM`)
            } catch (error) {
              this.logger.debug(`Journal save failed: ${error}`)
            }
          }

          continue
        }

        // Assistant message events
        if (isAssistantMessage(event)) {
          // Check for AskUserQuestion
          const question = extractQuestion(event)
          if (question) {
            this.logger.info(`Question detected for ${this.groupId}`)
            this.stopTyping()
            const answer = await this.callbacks.onQuestion(this.groupId, question)
            if (answer) {
              // Send the answer back through stdin
              await this.sendMessage(answer)
            }
            continue
          }

          // Accumulate text (no streaming preview — CLI sends full blocks, not deltas)
          const text = extractText(event)
          if (text) {
            accumulatedText += text
          }

          // Tool use status updates
          const toolUse = extractToolUse(event)
          if (toolUse) {
            // Track image/doc files written by Claude for auto-send
            if ((toolUse.name === "Write" || toolUse.name === "Bash") && toolUse.input.file_path) {
              const fp = String(toolUse.input.file_path)
              const ext = fp.split(".").pop()?.toLowerCase() ?? ""
              if (["png", "jpg", "jpeg", "webp", "pdf", "zip"].includes(ext)) {
                writtenFiles.add(fp)
              }
            }

            if (Date.now() - lastStatusUpdate > 3000) {
              const status = formatToolStatus(toolUse)
              await this.callbacks.onStatus(this.groupId, status)
              lastStatusUpdate = Date.now()
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Output processing error for ${this.groupId}: ${error}`)
    }

    // Process exited
    this.logger.info(`Persistent process exited for ${this.groupId}`)
    this.proc = null
    this.stdinWriter = null
    this.isProcessing = false
    this.stopTyping()
    this.callbacks.onProcessDied(this.groupId)
  }

  /** Buffer streaming text and flush periodically */
  private bufferStreamText(text: string): void {
    this.streamBuffer += text

    // Flush every 2 seconds or on paragraph breaks
    if (this.streamFlushTimer) return

    this.streamFlushTimer = setTimeout(async () => {
      this.streamFlushTimer = null
      await this.flushStreamBuffer(false)
    }, 2000)
  }

  /** Flush accumulated stream buffer to Telegram */
  private async flushStreamBuffer(isFinal: boolean): Promise<void> {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer)
      this.streamFlushTimer = null
    }

    if (!this.streamBuffer) return

    const text = this.streamBuffer
    if (isFinal) {
      // Final flush — send as formatted text and clear streaming state
      await this.callbacks.onStreamEnd(this.groupId)
    } else {
      // Partial flush — update streaming message
      await this.callbacks.onStreamText(this.groupId, text)
    }
  }

  /** Start typing indicator */
  private startTyping(): void {
    this.stopTyping()
    this.callbacks.onTyping(this.groupId).catch(() => {})
    this.typingInterval = setInterval(() => {
      this.callbacks.onTyping(this.groupId).catch(() => {})
    }, 5000)
  }

  /** Stop typing indicator */
  private stopTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval)
      this.typingInterval = null
    }
  }

  /** Process stderr (log only) */
  private async processStderr(): Promise<void> {
    if (!this.proc) return
    const reader = this.proc.stderr.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text.trim()) {
          this.logger.debug(`[${this.groupId} stderr] ${text.trim()}`)
        }
      }
    } catch {
      // Ignore
    } finally {
      reader.releaseLock()
    }
  }

  /** Save transcript to disk */
  private saveTranscript(result: string, intermediate: string): void {
    try {
      const { appendFileSync, mkdirSync, existsSync } = require("fs")
      const transcriptDir = join(homedir(), ".claude", "channels", "telegram", "transcripts", this.groupId)
      if (!existsSync(transcriptDir)) mkdirSync(transcriptDir, { recursive: true })
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const content = [
        `# Session Transcript`,
        `- Group: ${this.groupId}`,
        `- Session: ${this.sessionId ?? "none"}`,
        `- Time: ${new Date().toISOString()}`,
        `- Mode: persistent`,
        ``,
        `## Final Response`,
        result || "(no result)",
        ``,
        `## Intermediate Output`,
        intermediate || "(none)",
      ].join("\n")
      appendFileSync(join(transcriptDir, `${timestamp}.md`), content)
    } catch {
      // Best effort
    }
  }

  /** Gracefully stop the process */
  async stop(): Promise<void> {
    this.stopTyping()
    if (this.stdinSink) {
      try {
        this.stdinSink.end()
      } catch {
        // Already closed
      }
      this.stdinSink = null
    }
    if (this.proc) {
      this.proc.kill("SIGTERM")
      await new Promise((resolve) => setTimeout(resolve, 2000))
      try { this.proc.kill("SIGKILL") } catch { /* already dead */ }
      this.proc = null
    }
    if (this.outputLoopPromise) {
      await this.outputLoopPromise.catch(() => {})
    }
    this.logger.info(`Persistent session stopped for ${this.groupId}`)
  }
}
