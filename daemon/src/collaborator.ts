import { Bot, InlineKeyboard, type Context } from "grammy"
import { loadAccess, isGroupAdmin, addGroupCollaborator, Logger } from "./config"
import type { PendingApproval } from "./types"

/** Cached member count with TTL */
interface MemberCountCache {
  count: number
  checkedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export class CollaboratorManager {
  private bot: Bot
  private logger: Logger
  private memberCountCache: Map<string, MemberCountCache> = new Map()
  private pendingApprovals: Map<string, PendingApproval> = new Map()

  constructor(bot: Bot, logger: Logger) {
    this.bot = bot
    this.logger = logger
  }

  /** Check if collaborator mode is active for a group */
  async isActive(groupId: string): Promise<boolean> {
    const access = loadAccess()
    const group = access.groups[groupId]
    if (!group) return false

    const mode = group.collaboratorMode ?? "auto"

    if (mode === "on") return true
    if (mode === "off") return false

    // Auto mode: check member count
    const count = await this.getMemberCount(groupId)
    return count > 2
  }

  /** Get member count with caching */
  private async getMemberCount(groupId: string): Promise<number> {
    const cached = this.memberCountCache.get(groupId)
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      return cached.count
    }

    try {
      const chatId = parseInt(groupId)
      if (isNaN(chatId)) return 0

      const count = await this.bot.api.getChatMemberCount(chatId)
      this.memberCountCache.set(groupId, { count, checkedAt: Date.now() })
      return count
    } catch (error) {
      this.logger.debug(`Failed to get member count for ${groupId}: ${error}`)
      // Fall back to cached value or assume not collaborator mode
      return cached?.count ?? 0
    }
  }

  /** Invalidate the member count cache for a group (on chat_member events) */
  invalidateCache(groupId: string): void {
    this.memberCountCache.delete(groupId)
  }

  /** Request approval for a new collaborator */
  async requestApproval(ctx: Context, groupId: string, userId: string): Promise<void> {
    const approvalKey = `${groupId}:${userId}`

    // Already pending?
    if (this.pendingApprovals.has(approvalKey)) {
      await ctx.reply("Your access request is pending admin approval.")
      return
    }

    const username = ctx.from?.username ? `@${ctx.from.username}` : `user ${userId}`

    const keyboard = new InlineKeyboard()
      .text("Approve", `collab_approve_${userId}`)
      .text("Deny", `collab_deny_${userId}`)

    try {
      const msg = await ctx.reply(
        `*Access Request*\n${username} wants to use Claude in this group.\n\n_Only admins can approve._`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      )

      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(approvalKey)
        this.bot.api.editMessageText(
          parseInt(groupId),
          msg.message_id,
          `*Access Request*\n${username} — expired.`,
          { parse_mode: "Markdown" }
        ).catch(() => {})
      }, APPROVAL_TIMEOUT_MS)

      this.pendingApprovals.set(approvalKey, {
        userId,
        username,
        groupId,
        messageId: msg.message_id,
        timeout,
      })
    } catch (error) {
      this.logger.error(`Failed to send approval request in ${groupId}: ${error}`)
    }
  }

  /** Handle approval/denial callback from inline buttons */
  async handleApprovalCallback(ctx: Context, groupId: string, data: string): Promise<void> {
    const senderId = String(ctx.from?.id ?? "")

    // Only admins can approve
    if (!isGroupAdmin(groupId, senderId)) {
      await ctx.answerCallbackQuery({ text: "Only admins can approve access." })
      return
    }

    // Parse: collab_approve_<userId> or collab_deny_<userId>
    const parts = data.split("_")
    const action = parts[1] // "approve" or "deny"
    const userId = parts.slice(2).join("_")
    const approvalKey = `${groupId}:${userId}`

    const pending = this.pendingApprovals.get(approvalKey)
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "This request has expired." })
      return
    }

    clearTimeout(pending.timeout)
    this.pendingApprovals.delete(approvalKey)

    if (action === "approve") {
      addGroupCollaborator(groupId, userId)
      await ctx.answerCallbackQuery({ text: "Approved!" })
      await ctx.editMessageText(
        `*Access Granted*\n${pending.username} can now use /c to talk to Claude.`,
        { parse_mode: "Markdown" }
      )
      this.logger.info(`Collaborator approved: ${userId} in ${groupId} (by ${senderId})`)
    } else {
      await ctx.answerCallbackQuery({ text: "Denied." })
      await ctx.editMessageText(
        `*Access Denied*\n${pending.username} was not granted Claude access.`,
        { parse_mode: "Markdown" }
      )
      this.logger.info(`Collaborator denied: ${userId} in ${groupId} (by ${senderId})`)
    }
  }

  /** Clean up all pending approvals on shutdown */
  cleanup(): void {
    for (const [, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout)
    }
    this.pendingApprovals.clear()
  }
}
