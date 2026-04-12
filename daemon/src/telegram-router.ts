import { Bot, InlineKeyboard, type Context } from "grammy"
import type { QuestionPayload, QueuedMessage } from "./types"
import { loadAccess, loadProjects, updateProjectConfig, addAllowedTool, getInboxDir, registerProject, isGroupAdmin, hasClaudeAccess, addGroupCollaborator, removeGroupCollaborator, setCollaboratorMode, Logger } from "./config"
import { SessionManager, type SessionCallbacks } from "./session-manager"
import { CollaboratorManager } from "./collaborator"
import { detectTerminalSessions, discoverDiskSessions, resolveShortId, loadSessionHistory, formatRelativeTime } from "./session-discovery"
import { chunkText, markdownToTelegramHtml, stripHtml } from "./stream-parser"
import { writeFileSync, existsSync, realpathSync } from "fs"
import { join, extname, basename, resolve } from "path"
import { homedir } from "os"
import type { ActivityTracker } from "./activity"

/**
 * Smart path resolution for /setup — tries multiple strategies:
 * 1. Exact path as given
 * 2. Prepend $HOME (for paths like /desktop/projects/foo)
 * 3. Prepend $HOME/ for relative-looking paths
 * 4. Case-insensitive match on first component (Desktop vs desktop)
 * Returns the resolved real path, or empty string if not found.
 */
function resolveProjectPath(rawPath: string): string {
  const home = homedir()
  const candidates = [
    rawPath,
    join(home, rawPath),                    // /desktop/x → /Users/username/desktop/x
    join(home, rawPath.replace(/^\//, "")), // same without leading slash
  ]

  // Also try case variations on first path component after home
  // e.g. /desktop/ → /Desktop/, /documents/ → /Documents/
  const afterSlash = rawPath.replace(/^\//, "")
  const firstPart = afterSlash.split("/")[0]
  const rest = afterSlash.split("/").slice(1).join("/")
  if (firstPart) {
    const capitalized = firstPart.charAt(0).toUpperCase() + firstPart.slice(1)
    const lowered = firstPart.toLowerCase()
    candidates.push(join(home, capitalized, rest))
    candidates.push(join(home, lowered, rest))
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return realpathSync(candidate)
      }
    } catch {}
  }

  return ""
}

/** Pending question awaiting user response */
interface PendingQuestion {
  groupId: string
  question: QuestionPayload
  resolve: (answer: string) => void
  timeout: ReturnType<typeof setTimeout>
  messageId: number
}

export class TelegramRouter {
  private bot: Bot
  private sessionManager: SessionManager
  private collaboratorManager: CollaboratorManager
  private logger: Logger
  private pendingQuestions: Map<string, PendingQuestion> = new Map()
  private statusMessages: Map<string, number> = new Map()

  constructor(botToken: string, logger: Logger, sessionTimeoutMs: number, activityTracker?: ActivityTracker) {
    this.bot = new Bot(botToken)
    this.logger = logger

    const callbacks: SessionCallbacks = {
      onText: this.handleText.bind(this),
      onStreamText: async (_groupId: string, _partial: string) => { /* streaming handled by onText */ },
      onStreamEnd: async (_groupId: string) => { /* no-op */ },
      onStatus: this.handleStatus.bind(this),
      onQuestion: this.handleQuestion.bind(this),
      onError: this.handleError.bind(this),
      onReaction: this.handleReaction.bind(this),
      onTyping: this.handleTyping.bind(this),
      onFileSend: this.handleFileSend.bind(this),
      onActivity: (groupId: string, type: string, data: Record<string, unknown>) => {
        activityTracker?.emit(groupId, type as any, data)
      },
      onPermissionDenied: this.handlePermissionDenied.bind(this),
      onSessionEnd: this.handleSessionEnd.bind(this),
    }

    this.sessionManager = new SessionManager(callbacks, logger, sessionTimeoutMs)
    this.collaboratorManager = new CollaboratorManager(this.bot, logger)
    this.setupHandlers()
  }

  /** Expose session manager for API server */
  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  /** Set up grammy message handlers */
  private setupHandlers(): void {
    // Handle callback queries (inline button presses)
    this.bot.on("callback_query:data", async (ctx) => {
      const chatId = String(ctx.chat?.id ?? "")
      const data = ctx.callbackQuery.data

      // v4.2: Menu button callbacks
      if (data.startsWith("menu_")) {
        const cmd = data.replace("menu_", "")
        const noArgCommands: Record<string, string> = {
          new: "Starting a fresh conversation.",
          stop: "Use /stop to pause the current task.",
          sessions: "Use /sessions to see all conversations.",
          history: "Use /history to see past conversations.",
          status: "Use /status to see what's happening.",
          help: "Use /help for the full guide.",
          setup: "Use /setup or /setup <path> to connect a project.",
          brain: "Use /brain to access your knowledge graph.",
        }
        const argCommands: Record<string, string> = {
          mode: "Usage: /mode <plan|accept|default|dontask|bypass|auto>",
          switch: "Usage: /switch <session_id>",
          c: "Usage: /c <message to Claude>",
          collab: "Usage: /collab <list|add|remove|on|off|auto>",
          trust: "Usage: /trust <tool_name>",
        }

        if (argCommands[cmd]) {
          await ctx.answerCallbackQuery({ text: argCommands[cmd], show_alert: true })
        } else {
          await ctx.answerCallbackQuery({ text: noArgCommands[cmd] ?? `Use /${cmd}` })
          // Send the command as a clickable message
          try {
            await this.bot.api.sendMessage(parseInt(chatId), `/${cmd}`)
          } catch {
            // best effort
          }
        }
        return
      }

      // v4.2: Collaborator approval callbacks
      if (data.startsWith("collab_")) {
        await this.collaboratorManager.handleApprovalCallback(ctx, chatId, data)
        return
      }

      // v5.5: Permission approval callbacks
      if (data.startsWith("perm_")) {
        await this.handlePermissionApprovalCallback(ctx, chatId, data)
        return
      }

      // AskUserQuestion callbacks
      const pending = this.pendingQuestions.get(chatId)

      if (!pending) {
        await ctx.answerCallbackQuery({ text: "No active question." })
        return
      }

      if (data.startsWith("answer_")) {
        const idx = parseInt(data.split("_")[1])
        const option = pending.question.options[idx]
        if (option) {
          clearTimeout(pending.timeout)
          this.pendingQuestions.delete(chatId)
          await ctx.answerCallbackQuery({ text: `Selected: ${option.label}` })
          await ctx.editMessageReplyMarkup({ reply_markup: undefined })
          pending.resolve(option.label)
        }
      }
    })

    // Handle text messages
    this.bot.on("message:text", async (ctx, next) => {
      const chatId = String(ctx.chat.id)
      const chatType = ctx.chat.type
      const senderId = String(ctx.from.id)
      const messageText = ctx.message.text

      // Check if this is an answer to a pending question (before skipping /commands)
      const pending = this.pendingQuestions.get(chatId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingQuestions.delete(chatId)
        pending.resolve(messageText)
        return
      }

      // Pass /commands to grammy command handlers via next()
      if (messageText.startsWith("/")) {
        await next()
        return
      }

      // Gate: check access
      if (!this.gate(chatId, chatType, senderId, ctx)) {
        return
      }

      // v4.2: In collaborator mode, ignore non-/c messages
      if (chatType === "group" || chatType === "supergroup") {
        const isCollabMode = await this.collaboratorManager.isActive(chatId)
        if (isCollabMode) {
          // Human-to-human chat — bot ignores
          return
        }
      }

      // Route to session manager
      const queuedMessage: QueuedMessage = {
        text: messageText,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        fromId: ctx.from.id,
        timestamp: Date.now(),
      }

      // Send acknowledgment reaction
      try {
        await ctx.react("👀")
      } catch {
        // Reaction may fail in some chat types
      }

      await this.sessionManager.handleMessage(chatId, queuedMessage)
    })

    // Handle photos — download and pass to Claude
    this.bot.on("message:photo", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const chatType = ctx.chat.type
      const senderId = String(ctx.from.id)

      if (!this.gate(chatId, chatType, senderId, ctx)) return

      try {
        // Get the highest resolution photo
        const photos = ctx.message.photo
        const photo = photos[photos.length - 1]
        const file = await ctx.api.getFile(photo.file_id)
        const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`

        // Download to project inbox
        const inboxDir = getInboxDir(chatId)
        const ext = extname(file.file_path ?? ".jpg") || ".jpg"
        const filename = `photo_${Date.now()}${ext}`
        const localPath = join(inboxDir, filename)

        const response = await fetch(fileUrl)
        const buffer = await response.arrayBuffer()
        writeFileSync(localPath, Buffer.from(buffer))

        this.logger.info(`Downloaded photo to ${localPath}`)

        const caption = ctx.message.caption ?? "Analyze this image"
        const queuedMessage: QueuedMessage = {
          text: `I uploaded a photo to ${localPath}. ${caption}`,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          fromId: ctx.from.id,
          timestamp: Date.now(),
        }

        await ctx.react("👀")
        await this.sessionManager.handleMessage(chatId, queuedMessage)
      } catch (error) {
        this.logger.error(`Failed to download photo: ${error}`)
        const errMsg = String(error)
        if (errMsg.includes("file is too big")) {
          await ctx.reply("⚠️ Photo too large for Telegram bot download (20 MB limit). Send as a compressed image or place it in the project folder.")
        } else {
          await ctx.reply("Failed to download photo.")
        }
      }
    })

    // Handle documents — download and pass to Claude
    this.bot.on("message:document", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const chatType = ctx.chat.type
      const senderId = String(ctx.from.id)

      if (!this.gate(chatId, chatType, senderId, ctx)) return

      try {
        const doc = ctx.message.document
        const file = await ctx.api.getFile(doc.file_id)
        const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`

        const inboxDir = getInboxDir(chatId)
        const filename = doc.file_name ?? `file_${Date.now()}`
        const localPath = join(inboxDir, filename)

        const response = await fetch(fileUrl)
        const buffer = await response.arrayBuffer()
        writeFileSync(localPath, Buffer.from(buffer))

        this.logger.info(`Downloaded document to ${localPath} (${doc.file_name}, ${doc.file_size} bytes)`)

        const caption = ctx.message.caption ?? `I uploaded ${doc.file_name ?? "a file"}. Analyze it.`
        const queuedMessage: QueuedMessage = {
          text: `I uploaded a file to ${localPath} (${doc.file_name ?? "unknown"}, ${doc.file_size ?? 0} bytes). ${caption}`,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          fromId: ctx.from.id,
          timestamp: Date.now(),
        }

        await ctx.react("👀")
        await this.sessionManager.handleMessage(chatId, queuedMessage)
      } catch (error) {
        this.logger.error(`Failed to download document: ${error}`)
        const errMsg = String(error)
        if (errMsg.includes("file is too big")) {
          const doc = ctx.message.document
          const sizeMB = doc.file_size ? (doc.file_size / 1024 / 1024).toFixed(1) : "?"
          await ctx.reply(
            `⚠️ File too large (${sizeMB} MB). Telegram bots can only download files up to 20 MB.\n\n` +
            `Workarounds:\n` +
            `• Split the PDF into smaller parts\n` +
            `• Compress the file below 20 MB\n` +
            `• Place the file directly in the project folder and tell me the path`
          )
        } else {
          await ctx.reply("Failed to download file.")
        }
      }
    })

    // ─── v4.2: Chat Member Changes ──────────────────────────────────
    this.bot.on("chat_member", (ctx) => {
      const chatId = String(ctx.chat.id)
      this.collaboratorManager.invalidateCache(chatId)
      this.logger.debug(`Member change in ${chatId} — collaborator cache invalidated`)
    })

    // ─── Session Control Commands ──────────────────────────────────

    // /mode <plan|accept|default|dontask|bypass> — switch permission mode
    this.bot.command("mode", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const arg = ctx.match?.trim().toLowerCase()
      const modeMap: Record<string, string> = {
        plan: "plan",
        accept: "acceptEdits",
        acceptedits: "acceptEdits",
        default: "default",
        dontask: "dontAsk",
        bypass: "bypassPermissions",
        auto: "auto",
      }

      const mode = modeMap[arg ?? ""]
      if (!mode) {
        await ctx.reply(
          "Usage: /mode <plan|accept|default|dontask|bypass|auto>\n\n" +
          "Current modes:\n" +
          "- plan — Claude plans but doesn't make changes\n" +
          "- accept — Auto-accept file edits\n" +
          "- default — Ask for permission on dangerous ops\n" +
          "- dontask — Don't ask, just do\n" +
          "- bypass — Skip all permission checks\n" +
          "- auto — Let Claude decide"
        )
        return
      }

      const updated = updateProjectConfig(chatId, "permissionMode", mode)
      if (updated) {
        this.sessionManager.setPermissionMode(chatId, mode)
        await ctx.reply(`Permission mode set to: ${mode}\nTakes effect on next message.`)
      } else {
        await ctx.reply("This group is not mapped to a project. Use kronus-init first.")
      }
    })

    // /new — start a fresh session (discard current --resume chain)
    this.bot.command("new", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const reset = this.sessionManager.resetSession(chatId)
      if (reset) {
        await ctx.reply("Session reset. Next message starts a fresh conversation.")
      } else {
        await ctx.reply("Cannot reset — a session is currently running. Use /stop first.")
      }
    })

    // /stop — stop the current running session
    this.bot.command("stop", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const stopped = await this.sessionManager.stopSession(chatId)
      if (stopped) {
        await ctx.reply("Session stopped.")
      } else {
        await ctx.reply("No running session to stop.")
      }
    })

    // /sessions — list all active sessions across groups
    this.bot.command("sessions", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const sessions = this.sessionManager.getStatus()
      const projects = loadProjects()
      const sections: string[] = []

      // Daemon sessions
      if (sessions.length > 0) {
        const lines = sessions.map((s) => {
          const project = projects.projects[s.groupId]
          const name = project?.name ?? "unknown"
          const status = s.isRunning ? "running" : "idle"
          const age = Math.round((Date.now() - s.lastActivity) / 1000)
          const sid = s.sessionId ? `\`${s.sessionId.slice(0, 8)}...\`` : "none"
          return `- *${name}*: ${status} (${age}s ago, session: ${sid}, queued: ${s.queueSize})`
        })
        sections.push(`*Daemon Sessions:*\n${lines.join("\n")}`)
      }

      // Terminal sessions
      const terminalSessions = detectTerminalSessions()
      if (terminalSessions.length > 0) {
        const lines = terminalSessions.map((s) => `- PID ${s.pid}: \`${s.cwd}\``)
        sections.push(`*Terminal Sessions:*\n${lines.join("\n")}`)
      }

      // Disk sessions for this group's project
      const project = projects.projects[chatId]
      if (project) {
        const diskSessions = discoverDiskSessions(project.path).slice(0, 5)
        if (diskSessions.length > 0) {
          const lines = diskSessions.map((s) => {
            return `- \`${s.shortId}...\` — ${formatRelativeTime(s.lastModified)}`
          })
          sections.push(`*Recent Sessions (${project.name}):*\n${lines.join("\n")}`)
        }
      }

      if (sections.length === 0) {
        await ctx.reply("No sessions found.")
        return
      }

      await ctx.reply(sections.join("\n\n") + "\n\nUse /switch <id> to switch sessions.", { parse_mode: "Markdown" })
    })

    // /resume <session_id> — attach to an existing session
    this.bot.command("resume", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const sessionId = ctx.match?.trim()
      if (!sessionId) {
        // Show current session ID
        const currentId = this.sessionManager.getSessionId(chatId)
        if (currentId) {
          await ctx.reply(`Current session: \`${currentId}\`\n\nUsage: /resume <session_id>`, { parse_mode: "Markdown" })
        } else {
          await ctx.reply("No active session. Usage: /resume <session_id>")
        }
        return
      }

      this.sessionManager.setSessionId(chatId, sessionId)
      await ctx.reply(`Attached to session: \`${sessionId}\`\nNext message will resume this session.`, { parse_mode: "Markdown" })
    })

    // ─── Permission Commands ───────────────────────────────────────

    // /trust <tool> — permanently add a tool to this project's allowedTools
    this.bot.command("trust", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const tool = ctx.match?.trim()
      if (!tool) {
        const project = loadProjects().projects[chatId]
        const tools = project?.allowedTools?.join(", ") ?? "none"
        await ctx.reply(
          `Usage: /trust <tool_name>\n\n` +
          `Current allowed tools: ${tools}\n\n` +
          `Common tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch`
        )
        return
      }

      const added = addAllowedTool(chatId, tool)
      if (added) {
        await ctx.reply(`Added "${tool}" to allowed tools. Takes effect on next message.`)
      } else {
        await ctx.reply("This group is not mapped to a project.")
      }
    })

    // ─── Info Commands ─────────────────────────────────────────────

    // /status — show status of this group's session
    this.bot.command("status", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const sessions = this.sessionManager.getStatus()
      const thisSession = sessions.find((s) => s.groupId === chatId)
      const project = loadProjects().projects[chatId]

      if (!project) {
        await ctx.reply("This group is not mapped to a project.")
        return
      }

      const status = thisSession?.isRunning ? "running" : "idle"
      const sid = thisSession?.sessionId ? thisSession.sessionId.slice(0, 8) + "..." : "none"
      const age = thisSession ? Math.round((Date.now() - thisSession.lastActivity) / 1000) + "s ago" : "never"

      await ctx.reply(
        `*${project.name}*\n` +
        `Path: \`${project.path}\`\n` +
        `Mode: ${project.permissionMode}\n` +
        `Tools: ${project.allowedTools.join(", ")}\n` +
        `Status: ${status}\n` +
        `Session: ${sid}\n` +
        `Last activity: ${age}`,
        { parse_mode: "Markdown" }
      )
    })

    // /menu — interactive command buttons
    this.bot.command("menu", async (ctx) => {
      const keyboard = new InlineKeyboard()
        .text("📂 Connect project", "menu_setup")
        .text("ℹ️ What's happening", "menu_status").row()
        .text("🆕 New conversation", "menu_new")
        .text("🛑 Pause", "menu_stop").row()
        .text("🔄 My conversations", "menu_sessions")
        .text("📜 History", "menu_history").row()
        .text("🧠 Knowledge graph", "menu_brain")
        .text("👥 Team access", "menu_collab").row()
        .text("❓ Help", "menu_help").row()

      await ctx.reply(
        "<b>Menu</b>\nTap to run:",
        { parse_mode: "HTML", reply_markup: keyboard }
      )
    })

    // /help command
    this.bot.command("help", async (ctx) => {
      await ctx.reply(
        "*What I can do:*\n\n" +
        "💬 Just send me a message — describe what you need and I'll handle it\n" +
        "📎 Send photos or documents — I can read and work with them\n\n" +
        "*Getting started:*\n" +
        "/setup — Connect this group to a project\n" +
        "/new — Start a fresh conversation\n" +
        "/stop — Pause the current task\n" +
        "/status — See what I'm working on\n\n" +
        "*Conversations:*\n" +
        "/sessions — See all active conversations\n" +
        "/history — Past conversations for this group\n" +
        "/resume — Pick up where you left off\n\n" +
        "*Team:*\n" +
        "/collab on — Let others in this group talk to me\n" +
        "/collab list — See who has access\n\n" +
        "*Tips:*\n" +
        "• I remember our conversations and your preferences\n" +
        "• I'll always ask before doing anything irreversible\n" +
        "• You can use me from your phone or computer",
        { parse_mode: "Markdown" }
      )
    })

    // ─── /start — First-time welcome ──────────────────────────────────

    this.bot.command("start", async (ctx) => {
      const chatType = ctx.chat.type
      const firstName = ctx.from?.first_name ?? "there"

      if (chatType === "private") {
        // Private chat: full welcome with suggestions
        await ctx.reply(
          `Hey ${firstName}! I'm your Kronus AI assistant.\n\n` +
          "I can help you with:\n\n" +
          "🔧 *Building tools and systems* — just describe what you need\n" +
          "📋 *Organizing your work* — notes, documents, knowledge\n" +
          "🔍 *Research and analysis* — I'll dig through information for you\n" +
          "⚡ *Automating repetitive tasks* — so you can focus on what matters\n\n" +
          "Try saying something like:\n" +
          "_\"Help me organize my research papers\"_\n" +
          "_\"Build me a client intake form\"_\n" +
          "_\"Summarize my meeting notes\"_\n\n" +
          "Type /help anytime to see what I can do.",
          { parse_mode: "Markdown" }
        )
      } else {
        // Group chat: shorter welcome with setup hint
        await ctx.reply(
          `Hi ${firstName}! I'm Kronus — your AI assistant.\n\n` +
          "To get started, use /setup to connect this group to a project folder.\n" +
          "Then just send me messages — I'll work on whatever you need.\n\n" +
          "Type /help to see everything I can do.",
          { parse_mode: "Markdown" }
        )
      }
    })

    // ─── /brain — Quick access to knowledge graph ───────────────────

    this.bot.command("brain", async (ctx) => {
      await ctx.reply(
        "🧠 *Your Knowledge Graph*\n\n" +
        "View your knowledge graph in the browser:\n" +
        "http://localhost:4242\n\n" +
        "Or from the dashboard:\n" +
        "http://localhost:8420 → Brain tab\n\n" +
        "Quick commands:\n" +
        "• _\"Search my notes for [topic]\"_ — find relevant notes\n" +
        "• _\"Create a note about [topic]\"_ — save something new\n" +
        "• _\"What do I know about [topic]?\"_ — search your memory",
        { parse_mode: "Markdown" }
      )
    })

    // ─── Bot added to group — welcome message ───────────────────────

    this.bot.on("my_chat_member", async (ctx) => {
      // Only trigger when bot status changes to member/admin (added to group)
      const newStatus = ctx.myChatMember.new_chat_member.status
      const oldStatus = ctx.myChatMember.old_chat_member.status
      const chatType = ctx.chat.type

      if (chatType !== "private" && (newStatus === "member" || newStatus === "administrator") && oldStatus === "left") {
        try {
          await ctx.reply(
            "Hi! I'm *Kronus* — your AI assistant.\n\n" +
            "To get started:\n" +
            "1️⃣ Use /setup to connect this group to a project folder\n" +
            "2️⃣ Then just send me messages — I'll work on whatever you need\n\n" +
            "I can build tools, write documents, analyze data, and remember everything for next time.\n\n" +
            "Type /help to see all commands.",
            { parse_mode: "Markdown" }
          )
        } catch (err) {
          this.logger.warn(`Failed to send welcome in ${ctx.chat.id}: ${err}`)
        }
      }
    })

    // ─── Setup & Onboarding ─────────────────────────────────────────

    // /setup — connect this group to a project (groups only)
    this.bot.command("setup", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const chatType = ctx.chat.type
      const senderId = String(ctx.from.id)

      // Only works in groups
      if (chatType === "private") {
        await ctx.reply("Use /setup in a group chat, not in DMs.")
        return
      }

      // Must be a global allowFrom user to set up projects
      const access = loadAccess()
      if (!access.allowFrom.includes(senderId)) {
        await ctx.reply("Only authorized users can set up projects.")
        return
      }

      // Check if already mapped
      const existingProject = loadProjects().projects[chatId]
      if (existingProject) {
        await ctx.reply(
          `This group is already mapped to *${existingProject.name}*\n` +
          `Path: \`${existingProject.path}\`\n\n` +
          "Use /new to reset the session, or create a new group for a different project.",
          { parse_mode: "Markdown" }
        )
        return
      }

      const arg = ctx.match?.trim()

      if (!arg) {
        // No argument — show running Claude processes and recent project paths
        const terminalSessions = detectTerminalSessions()
        const lines: string[] = ["*Available projects:*\n"]

        if (terminalSessions.length > 0) {
          lines.push("*Running Claude sessions:*")
          terminalSessions.forEach((session, idx) => {
            lines.push(`\`${idx + 1}\` — ${session.cwd} (PID ${session.pid})`)
          })
        } else {
          lines.push("_No running Claude sessions detected._")
        }

        lines.push(
          "\n*Usage:*",
          "`/setup 1` — Pick by index",
          "`/setup /path/to/project` — Pick by path"
        )

        await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" })
        return
      }

      // Argument provided — resolve to a path
      let projectPath: string
      const terminalSessions = detectTerminalSessions()

      const idx = parseInt(arg)
      if (!isNaN(idx) && idx >= 1 && idx <= terminalSessions.length) {
        // Pick by index
        projectPath = terminalSessions[idx - 1].cwd
      } else if (arg.startsWith("/") || arg.startsWith("~")) {
        // Absolute or home-relative path
        projectPath = arg.startsWith("~") ? arg.replace("~", homedir()) : arg
      } else {
        // Treat as relative to home — e.g. "Desktop/projects/foo" or just "my-project"
        projectPath = join(homedir(), arg)
      }

      // Smart path resolution: try the path as-is, then try common prefixes
      projectPath = resolveProjectPath(projectPath)
      if (!projectPath) {
        const suggestions: string[] = []
        // Show what we tried
        const tried = [arg]
        if (!arg.startsWith("/Users")) tried.push(`${homedir()}${arg}`)
        await ctx.reply(
          `Path not found: \`${arg}\`\n\n` +
          `Tried:\n${tried.map(t => `• \`${t}\``).join("\n")}\n\n` +
          `Use the full path, e.g.:\n\`/setup ${homedir()}/Desktop/my-project\``,
          { parse_mode: "Markdown" }
        )
        return
      }

      // Derive project name from path
      const projectName = basename(projectPath)

      // Register in both config files
      registerProject(chatId, projectName, projectPath, senderId)

      // Try to find the most recent session for this project
      const diskSessions = discoverDiskSessions(projectPath)
      let sessionNote = ""
      if (diskSessions.length > 0) {
        const latestSession = diskSessions[0]
        this.sessionManager.setSessionId(chatId, latestSession.sessionId)
        sessionNote = `\nResuming session: \`${latestSession.shortId}...\` (${formatRelativeTime(latestSession.lastModified)})`
      }

      this.logger.info(`Project setup: ${chatId} → ${projectPath} (by user ${senderId})`)

      await ctx.reply(
        `Project connected!\n\n` +
        `*${projectName}*\n` +
        `Path: \`${projectPath}\`\n` +
        `Mode: default\n` +
        `Admin: you${sessionNote}\n\n` +
        "Send a message to start working.",
        { parse_mode: "Markdown" }
      )

      // Pin an intro message so everyone knows how to use Kronus
      try {
        const introText =
          `<b>📌 Kronus — Ready</b>\n\n` +
          `This group is connected to <b>${projectName}</b>.\n\n` +
          `<b>Just send a message</b> to get started. Describe what you need and I'll handle it.\n\n` +
          `<b>Useful commands:</b>\n` +
          `/new — Start a fresh conversation\n` +
          `/stop — Pause the current task\n` +
          `/status — See what's happening\n` +
          `/brain — Your knowledge graph\n` +
          `/menu — All options\n\n` +
          `<b>Team:</b>\n` +
          `/c &lt;message&gt; — Talk to me when others are in the group\n` +
          `/collab on — Let others in this group talk to me too\n\n` +
          `<i>You can also send photos or documents — I can read and work with them.</i>`

        const introMsg = await this.bot.api.sendMessage(parseInt(chatId), introText, { parse_mode: "HTML" })
        await this.bot.api.pinChatMessage(parseInt(chatId), introMsg.message_id, { disable_notification: true })
      } catch (pinError) {
        this.logger.debug(`Could not pin intro in ${chatId}: ${pinError}`)
      }
    })

    // ─── v4.2: Session Intelligence ───────────────────────────────────

    // /switch <session_id> — switch to a different session without resetting
    this.bot.command("switch", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const shortId = ctx.match?.trim()
      if (!shortId) {
        await ctx.reply("Usage: /switch <session_id>\n\nUse /sessions or /history to find session IDs.")
        return
      }

      const project = loadProjects().projects[chatId]
      if (!project) {
        await ctx.reply("This group is not mapped to a project.")
        return
      }

      // Resolve short ID to full UUID
      const fullId = resolveShortId(shortId, project.path)
      if (!fullId) {
        // Check if the short ID matches multiple
        const diskSessions = discoverDiskSessions(project.path)
        const matches = diskSessions.filter((s) => s.sessionId.startsWith(shortId))
        if (matches.length > 1) {
          const matchList = matches.map((s) => `\`${s.shortId}...\``).join(", ")
          await ctx.reply(`Ambiguous ID. Matches: ${matchList}\n\nProvide more characters.`, { parse_mode: "Markdown" })
        } else {
          await ctx.reply(`No session found matching \`${shortId}\`.`, { parse_mode: "Markdown" })
        }
        return
      }

      this.sessionManager.setSessionId(chatId, fullId)
      await ctx.reply(
        `Switched to session: \`${fullId.slice(0, 8)}...\`\nNext message will resume this session.`,
        { parse_mode: "Markdown" }
      )
    })

    // /history — past sessions for this group
    this.bot.command("history", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      if (!this.gate(chatId, ctx.chat.type, senderId, ctx)) return

      const project = loadProjects().projects[chatId]
      if (!project) {
        await ctx.reply("This group is not mapped to a project.")
        return
      }

      // Try session history first, fall back to disk sessions
      const history = loadSessionHistory(chatId)

      if (history.length > 0) {
        const lines = history.slice(-10).reverse().map((entry) => {
          const started = new Date(entry.startedAt).toLocaleString()
          const sid = entry.sessionId.slice(0, 8)
          const ended = entry.endedAt ? "ended" : "active"
          return `\`${sid}...\` — ${started} (${ended}, ${entry.source})`
        })

        await ctx.reply(
          `*Session History — ${project.name}*\n\n${lines.join("\n")}\n\n` +
          "Use /switch <id> to resume a past session.",
          { parse_mode: "Markdown" }
        )
      } else {
        // Fall back to disk sessions
        const diskSessions = discoverDiskSessions(project.path).slice(0, 10)
        if (diskSessions.length === 0) {
          await ctx.reply("No session history found.")
          return
        }

        const lines = diskSessions.map((s) => {
          return `\`${s.shortId}...\` — ${formatRelativeTime(s.lastModified)} (disk)`
        })

        await ctx.reply(
          `*Sessions on disk — ${project.name}*\n\n${lines.join("\n")}\n\n` +
          "Use /switch <id> to resume a session.",
          { parse_mode: "Markdown" }
        )
      }
    })

    // ─── v4.2: Collaborator Mode ──────────────────────────────────────

    // /c <message> — send message to Claude in collaborator mode
    this.bot.command("c", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)
      const chatType = ctx.chat.type

      // Only works in groups
      if (chatType === "private") {
        await ctx.reply("Use /c in group chats with collaborator mode.")
        return
      }

      // Check if group is mapped
      const project = loadProjects().projects[chatId]
      if (!project) {
        await ctx.reply("This group is not mapped to a project. Use /setup first.")
        return
      }

      // Check if sender has Claude access
      if (!hasClaudeAccess(chatId, senderId)) {
        // Trigger approval flow
        await this.collaboratorManager.requestApproval(ctx, chatId, senderId)
        return
      }

      let messageText = ctx.match?.trim() ?? ""

      // Handle /c as a reply — include the replied message
      if (ctx.message.reply_to_message) {
        const repliedText = ctx.message.reply_to_message.text ?? ctx.message.reply_to_message.caption ?? ""
        if (repliedText) {
          const prefix = messageText ? `${messageText}\n\nContext (replied message):\n` : "Regarding this message:\n"
          messageText = `${prefix}${repliedText}`
        }
      }

      if (!messageText) {
        await ctx.reply("Usage: /c <message to Claude>\n\nOr reply to a message with /c to include it as context.")
        return
      }

      // Show typing indicator
      try {
        await ctx.replyWithChatAction("typing")
      } catch {
        // Typing indicator is best-effort
      }

      const queuedMessage: QueuedMessage = {
        text: messageText,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        fromId: ctx.from.id,
        timestamp: Date.now(),
      }

      await this.sessionManager.handleMessage(chatId, queuedMessage)
    })

    // /collab — collaborator management
    this.bot.command("collab", async (ctx) => {
      const chatId = String(ctx.chat.id)
      const senderId = String(ctx.from.id)

      if (ctx.chat.type === "private") {
        await ctx.reply("Use /collab in group chats.")
        return
      }

      const project = loadProjects().projects[chatId]
      if (!project) {
        await ctx.reply("This group is not mapped to a project. Use /setup first.")
        return
      }

      const args = ctx.match?.trim().split(/\s+/) ?? []
      const subcommand = args[0]?.toLowerCase() ?? ""

      switch (subcommand) {
        case "list": {
          const access = loadAccess()
          const group = access.groups[chatId]
          const allowFrom = group?.allowFrom ?? []
          const collaborators = group?.collaborators ?? []
          const admins = group?.adminUsers ?? []
          const mode = group?.collaboratorMode ?? "auto"

          const lines = [`*Collaborator Mode: ${mode}*\n`]
          if (admins.length > 0) lines.push(`*Admins:* ${admins.join(", ")}`)
          if (allowFrom.length > 0) lines.push(`*Owners:* ${allowFrom.join(", ")}`)
          if (collaborators.length > 0) lines.push(`*Collaborators:* ${collaborators.join(", ")}`)
          if (collaborators.length === 0 && allowFrom.length <= 1) {
            lines.push("\n_No collaborators yet. Use /collab add <user\\_id> to add._")
          }

          await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" })
          break
        }

        case "add": {
          if (!isGroupAdmin(chatId, senderId)) {
            await ctx.reply("Only admins can add collaborators.")
            return
          }
          const userId = args[1]
          if (!userId) {
            await ctx.reply("Usage: /collab add <user_id>")
            return
          }
          addGroupCollaborator(chatId, userId)
          await ctx.reply(`Added user ${userId} as collaborator.`)
          break
        }

        case "remove": {
          if (!isGroupAdmin(chatId, senderId)) {
            await ctx.reply("Only admins can remove collaborators.")
            return
          }
          const userId = args[1]
          if (!userId) {
            await ctx.reply("Usage: /collab remove <user_id>")
            return
          }
          const removed = removeGroupCollaborator(chatId, userId)
          if (removed) {
            await ctx.reply(`Removed user ${userId} from collaborators.`)
          } else {
            await ctx.reply(`User ${userId} is not a collaborator.`)
          }
          break
        }

        case "on":
        case "off":
        case "auto": {
          if (!isGroupAdmin(chatId, senderId)) {
            await ctx.reply("Only admins can change collaborator mode.")
            return
          }
          setCollaboratorMode(chatId, subcommand as "on" | "off" | "auto")
          const desc = subcommand === "auto"
            ? "auto (activates when >2 members)"
            : subcommand
          await ctx.reply(`Collaborator mode set to: *${desc}*`, { parse_mode: "Markdown" })
          break
        }

        default:
          await ctx.reply(
            "*Collaborator commands:*\n" +
            "/collab list — Who has Claude access\n" +
            "/collab add <id> — Grant access\n" +
            "/collab remove <id> — Revoke access\n" +
            "/collab on|off|auto — Set mode",
            { parse_mode: "Markdown" }
          )
      }
    })
  }

  /** Access control gate — mirrors the Telegram plugin's logic */
  private gate(chatId: string, chatType: string, senderId: string, ctx: Context): boolean {
    const access = loadAccess()

    if (access.dmPolicy === "disabled") return false

    if (chatType === "private") {
      if (access.allowFrom.includes(senderId)) return true
      this.logger.info(`Blocked DM from unknown sender: ${senderId}`)
      return false
    }

    if (chatType === "group" || chatType === "supergroup") {
      const groupPolicy = access.groups[chatId]
      if (!groupPolicy) {
        this.logger.debug(`Message from unmapped group: ${chatId}`)
        return false
      }

      // Check if sender is in allowFrom OR is an approved collaborator
      const groupAllowFrom = groupPolicy.allowFrom ?? []
      const collaborators = groupPolicy.collaborators ?? []
      const isAllowed = groupAllowFrom.includes(senderId) || collaborators.includes(senderId)

      if (groupAllowFrom.length > 0 && !isAllowed) {
        this.logger.debug(`Blocked group message from ${senderId} in ${chatId} (not in allowFrom or collaborators)`)
        return false
      }

      // Check mention requirement
      if (groupPolicy.requireMention) {
        const mentioned = this.isMentioned(ctx, access.mentionPatterns)
        if (!mentioned) return false
      }

      return true
    }

    return false
  }

  /** Check if bot is mentioned in the message */
  private isMentioned(ctx: Context, extraPatterns?: string[]): boolean {
    const entities = ctx.message?.entities ?? ctx.message?.caption_entities ?? []
    const text = ctx.message?.text ?? ctx.message?.caption ?? ""
    const botInfo = this.bot.botInfo

    for (const entity of entities) {
      if (entity.type === "mention") {
        const mentioned = text.slice(entity.offset, entity.offset + entity.length)
        if (botInfo && mentioned.toLowerCase() === `@${botInfo.username}`.toLowerCase()) {
          return true
        }
      }
    }

    // Reply to bot's message counts as mention
    if (botInfo && ctx.message?.reply_to_message?.from?.id === botInfo.id) {
      return true
    }

    // Custom patterns
    for (const pattern of extraPatterns ?? []) {
      try {
        if (new RegExp(pattern, "i").test(text)) return true
      } catch {
        // Invalid regex, skip
      }
    }

    return false
  }

  /** Callback: send text response to Telegram */
  private async handleText(groupId: string, text: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return

    // Clean up any status message
    await this.deleteStatusMessage(groupId)

    // Convert markdown → Telegram HTML
    const html = markdownToTelegramHtml(text)
    const chunks = chunkText(html)

    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, { parse_mode: "HTML" })
      } catch {
        // HTML parse failed — fall back to plain text
        try {
          await this.bot.api.sendMessage(chatId, stripHtml(chunk))
        } catch (error) {
          this.logger.error(`Failed to send message to ${groupId}: ${error}`)
        }
      }
    }
  }

  /** Callback: send/update status message */
  private async handleStatus(groupId: string, status: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return

    const existingMsgId = this.statusMessages.get(groupId)

    try {
      if (existingMsgId) {
        await this.bot.api.editMessageText(chatId, existingMsgId, `⏳ ${status}`)
      } else {
        const msg = await this.bot.api.sendMessage(chatId, `⏳ ${status}`)
        this.statusMessages.set(groupId, msg.message_id)
      }
    } catch {
      // Status updates are best-effort — retry without HTML, strip tags
      try {
        const plain = `⏳ ${stripHtml(status)}`
        if (existingMsgId) {
          await this.bot.api.editMessageText(chatId, existingMsgId, plain)
        } else {
          const msg = await this.bot.api.sendMessage(chatId, plain)
          this.statusMessages.set(groupId, msg.message_id)
        }
      } catch {
        // truly best-effort
      }
    }
  }

  /** Callback: handle interactive question from Claude */
  private async handleQuestion(groupId: string, question: QuestionPayload): Promise<string> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return ""

    // Clean up status message
    await this.deleteStatusMessage(groupId)

    return new Promise<string>(async (resolve) => {
      // Build inline keyboard
      const keyboard = new InlineKeyboard()

      question.options.forEach((opt, idx) => {
        const letter = String.fromCharCode(65 + idx) // A, B, C, D
        keyboard.text(`${letter}: ${opt.label}`, `answer_${idx}`)
        if ((idx + 1) % 2 === 0) keyboard.row()
      })

      // Format question text — plain text, no HTML
      let questionText = `Claude is asking:\n${question.question}`
      if (question.options.length > 0) {
        questionText += "\n"
        question.options.forEach((opt, idx) => {
          const letter = String.fromCharCode(65 + idx)
          questionText += `\n${letter}. ${opt.label}`
          if (opt.description) questionText += ` — ${opt.description}`
        })
        questionText += "\n\nTap a button or type a custom answer."
      } else {
        questionText += "\n\nType your answer:"
      }

      try {
        const msg = await this.bot.api.sendMessage(chatId, questionText, {
          reply_markup: question.options.length > 0 ? keyboard : undefined,
        })

        // Set up timeout (2 minutes)
        const timeout = setTimeout(() => {
          this.pendingQuestions.delete(groupId)
          this.bot.api.editMessageText(chatId, msg.message_id, questionText + "\n\nTimed out — Claude will decide automatically.").catch(() => {})
          resolve("")
        }, 120_000)

        this.pendingQuestions.set(groupId, {
          groupId,
          question,
          resolve,
          timeout,
          messageId: msg.message_id,
        })
      } catch (error) {
        this.logger.error(`Failed to send question to ${groupId}: ${error}`)
        resolve("")
      }
    })
  }

  /** Callback: send error message */
  private async handleError(groupId: string, error: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return

    await this.deleteStatusMessage(groupId)

    try {
      await this.bot.api.sendMessage(chatId, `❌ ${error}`)
    } catch {
      this.logger.error(`Failed to send error to ${groupId}: ${error}`)
    }
  }

  /** Callback: typing indicator */
  private async handleTyping(groupId: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return
    try {
      await this.bot.api.sendChatAction(chatId, "typing")
    } catch { /* best effort */ }
  }

  /** Callback: reaction emoji on a message */
  private async handleReaction(groupId: string, messageId: number, emoji: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return
    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }])
    } catch { /* reactions may not be supported */ }
  }

  /** Callback: send a file */
  private async handleFileSend(groupId: string, filePath: string, _caption: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return
    try {
      const { InputFile } = await import("grammy")
      await this.bot.api.sendDocument(chatId, new InputFile(filePath))
    } catch (err) {
      this.logger.error(`Failed to send file to ${groupId}: ${err}`)
    }
  }

  /** Callback: permission denied — show approval buttons */
  private async handlePermissionDenied(groupId: string, denials: import("./types").PermissionDenial[], lastMessage: string): Promise<void> {
    const chatId = parseInt(groupId)
    if (isNaN(chatId)) return
    try {
      // Deduplicate tool names
      const toolNames = [...new Set(denials.map(d => d.tool_name))]

      // Build summary with tool details
      const summary = denials.map(d => {
        const input = d.tool_input ?? {}
        let detail = ""
        if (d.tool_name === "Bash" && input.command) {
          const cmd = String(input.command)
          detail = `: ${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}`
        } else if (d.tool_name === "Write" && input.file_path) {
          detail = `: ${basename(String(input.file_path))}`
        } else if (d.tool_name === "Edit" && input.file_path) {
          detail = `: ${basename(String(input.file_path))}`
        }
        return `• <b>${d.tool_name}</b>${detail}`
      }).join("\n")

      // Build inline keyboard
      const keyboard = new InlineKeyboard()

      // One button per unique denied tool
      for (const tool of toolNames) {
        keyboard.text(`✅ Allow ${tool}`, `perm_allow_${tool}_${groupId}`).row()
      }

      // "Allow all & retry" button
      keyboard.text("⚡ Allow all & retry", `perm_allowall_${groupId}`).row()

      // "Trust permanently" if just one tool
      if (toolNames.length === 1) {
        keyboard.text(`🔒 Trust ${toolNames[0]} permanently`, `perm_trust_${toolNames[0]}_${groupId}`).row()
      }

      // Ignore button
      keyboard.text("❌ Ignore", `perm_ignore_${groupId}`)

      await this.bot.api.sendMessage(chatId,
        `⚠️ <b>Permission needed</b>\n\nClaude tried to use tools that aren't allowed:\n${summary}\n\nApprove to retry the task.`,
        { parse_mode: "HTML", reply_markup: keyboard }
      )
    } catch (err) {
      this.logger.error(`Failed to send permission approval to ${groupId}: ${err}`)
    }
  }

  /** Handle permission approval button clicks */
  private async handlePermissionApprovalCallback(ctx: Context, chatId: string, data: string): Promise<void> {
    const groupId = chatId

    if (data.startsWith("perm_ignore_")) {
      await ctx.answerCallbackQuery({ text: "Ignored." })
      await ctx.editMessageReplyMarkup({ reply_markup: undefined })
      return
    }

    if (data.startsWith("perm_allowall_")) {
      // Add all commonly needed tools temporarily and retry
      const commonTools = ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebSearch", "WebFetch", "Agent", "Skill"]
      for (const tool of commonTools) {
        this.sessionManager.addTempAllowedTool(groupId, tool)
      }
      await ctx.answerCallbackQuery({ text: "All tools allowed for this session." })
      await ctx.editMessageReplyMarkup({ reply_markup: undefined })
      try {
        await this.bot.api.sendMessage(parseInt(chatId), "✅ All tools allowed. Restarting session & retrying...")
      } catch {}

      // Restart session so new tools take effect, then retry
      await this.sessionManager.restartWithUpdatedTools(groupId)
      const lastMsg = this.sessionManager.getLastUserMessage(groupId)
      if (lastMsg) {
        await this.sessionManager.handleMessage(groupId, {
          text: lastMsg,
          chatId: parseInt(chatId),
          messageId: 0,
          fromId: 0,
          timestamp: Date.now(),
        })
      }
      return
    }

    if (data.startsWith("perm_trust_")) {
      // perm_trust_Bash_-12345 → extract tool name (between trust_ and last _groupId)
      const withoutPrefix = data.replace("perm_trust_", "")
      const lastUnderscore = withoutPrefix.lastIndexOf(`_${groupId}`)
      const tool = withoutPrefix.slice(0, lastUnderscore)

      if (tool) {
        // Permanently add to project config
        addAllowedTool(chatId, tool)
        this.sessionManager.addTempAllowedTool(groupId, tool)
        await ctx.answerCallbackQuery({ text: `${tool} trusted permanently.` })
        await ctx.editMessageReplyMarkup({ reply_markup: undefined })
        try {
          await this.bot.api.sendMessage(parseInt(chatId),
            `🔒 <b>${tool}</b> permanently trusted for this project. Restarting & retrying...`,
            { parse_mode: "HTML" }
          )
        } catch {}

        // Restart and retry
        await this.sessionManager.restartWithUpdatedTools(groupId)
        const lastMsg = this.sessionManager.getLastUserMessage(groupId)
        if (lastMsg) {
          await this.sessionManager.handleMessage(groupId, {
            text: lastMsg,
            chatId: parseInt(chatId),
            messageId: 0,
            fromId: 0,
            timestamp: Date.now(),
          })
        }
      }
      return
    }

    if (data.startsWith("perm_allow_")) {
      // perm_allow_Bash_-12345 → extract tool name
      const withoutPrefix = data.replace("perm_allow_", "")
      const lastUnderscore = withoutPrefix.lastIndexOf(`_${groupId}`)
      const tool = withoutPrefix.slice(0, lastUnderscore)

      if (tool) {
        this.sessionManager.addTempAllowedTool(groupId, tool)
        await ctx.answerCallbackQuery({ text: `${tool} allowed for this session.` })
        await ctx.editMessageReplyMarkup({ reply_markup: undefined })
        try {
          await this.bot.api.sendMessage(parseInt(chatId),
            `✅ <b>${tool}</b> allowed for this session. Restarting & retrying...`,
            { parse_mode: "HTML" }
          )
        } catch {}

        // Restart and retry
        await this.sessionManager.restartWithUpdatedTools(groupId)
        const lastMsg = this.sessionManager.getLastUserMessage(groupId)
        if (lastMsg) {
          await this.sessionManager.handleMessage(groupId, {
            text: lastMsg,
            chatId: parseInt(chatId),
            messageId: 0,
            fromId: 0,
            timestamp: Date.now(),
          })
        }
      }
      return
    }

    await ctx.answerCallbackQuery({ text: "Unknown action." })
  }

  /** Callback: session ended */
  private handleSessionEnd(groupId: string, sessionId: string | null): void {
    this.deleteStatusMessage(groupId)
    this.logger.info(`Session ended for ${groupId} (session: ${sessionId ?? "none"})`)
  }

  /** Delete the status message for a group */
  private async deleteStatusMessage(groupId: string): Promise<void> {
    const msgId = this.statusMessages.get(groupId)
    if (!msgId) return

    const chatId = parseInt(groupId)
    try {
      await this.bot.api.deleteMessage(chatId, msgId)
    } catch {
      // Best effort
    }
    this.statusMessages.delete(groupId)
  }

  /** Start the bot and session manager */
  async start(): Promise<void> {
    this.logger.info("Starting Telegram router...")

    // Get bot info
    const botInfo = await this.bot.api.getMe()
    this.logger.info(`Bot connected: @${botInfo.username} (${botInfo.id})`)

    // Restore sessions from history (survives daemon restarts)
    this.sessionManager.restoreSessions()

    // Start session cleanup
    this.sessionManager.startCleanup()

    // Start polling
    this.bot.start({
      onStart: () => {
        this.logger.info("Bot polling started")
      },
    })
  }

  /** Gracefully stop the bot and all sessions */
  async stop(): Promise<void> {
    this.logger.info("Stopping Telegram router...")

    // Cancel pending questions
    for (const [, pending] of this.pendingQuestions) {
      clearTimeout(pending.timeout)
      pending.resolve("")
    }
    this.pendingQuestions.clear()

    // Stop sessions and collaborator manager
    await this.sessionManager.shutdown()
    this.collaboratorManager.cleanup()

    // Stop bot
    this.bot.stop()

    this.logger.info("Telegram router stopped")
  }
}
