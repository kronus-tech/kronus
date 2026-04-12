import type { StreamEvent, ResultEvent, AssistantEvent, ContentBlock, ToolUseBlock, QuestionPayload } from "./types"

/** Parse Claude Code stream-json (NDJSON) output line by line */
export async function* parseStream(
  stdout: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          yield JSON.parse(trimmed) as StreamEvent
        } catch {
          // Skip malformed lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim()) as StreamEvent
      } catch {
        // Skip malformed trailing data
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Extract text content from an assistant message event */
export function extractText(event: AssistantEvent): string {
  const textBlocks = event.message.content.filter(
    (block): block is ContentBlock & { type: "text" } => block.type === "text"
  )
  return textBlocks.map((block) => block.text).join("")
}

/** Check if a stream event contains an AskUserQuestion tool call */
export function extractQuestion(event: AssistantEvent): QuestionPayload | null {
  const toolUseBlocks = event.message.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use" && block.name === "AskUserQuestion"
  )

  if (toolUseBlocks.length === 0) return null

  const toolInput = toolUseBlocks[0].input as { questions?: QuestionPayload[] }
  const questions = toolInput.questions
  if (!questions || questions.length === 0) return null

  return questions[0]
}

/** Extract tool use events for status updates */
export function extractToolUse(event: AssistantEvent): ToolUseBlock | null {
  const toolUseBlocks = event.message.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use"
  )
  return toolUseBlocks[0] ?? null
}

/** Check if event is a result (final response) */
export function isResult(event: StreamEvent): event is ResultEvent {
  return event.type === "result"
}

/** Check if event is an assistant message */
export function isAssistantMessage(event: StreamEvent): event is AssistantEvent {
  return event.type === "assistant"
}

/** Extract session_id from a result event */
export function extractSessionId(event: ResultEvent): string {
  return event.session_id
}

/** Format tool use as a human-readable status */
export function formatToolStatus(toolUse: ToolUseBlock): string {
  const name = toolUse.name
  const input = toolUse.input

  switch (name) {
    case "Bash": {
      const cmd = (input.command as string) ?? ""
      const shortCmd = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd
      return `Running: <code>${escapeHtml(shortCmd)}</code>`
    }
    case "Read":
      return `Reading: <code>${escapeHtml(String(input.file_path))}</code>`
    case "Write":
      return `Writing: <code>${escapeHtml(String(input.file_path))}</code>`
    case "Edit":
      return `Editing: <code>${escapeHtml(String(input.file_path))}</code>`
    case "Glob":
      return `Searching: <code>${escapeHtml(String(input.pattern))}</code>`
    case "Grep":
      return `Searching for: <code>${escapeHtml(String(input.pattern))}</code>`
    case "Agent":
      return `Spawning agent: <code>${escapeHtml(String(input.subagent_type ?? input.description ?? name))}</code>`
    case "Skill":
      return `Running: <code>/${escapeHtml(String(input.skill ?? ""))}</code>`
    default:
      return `Using: <code>${escapeHtml(name)}</code>`
  }
}

/** Convert GitHub-flavored markdown to Telegram HTML */
export function markdownToTelegramHtml(text: string): string {
  // Step 1: Extract code blocks to protect them from conversion
  const codeBlocks: string[] = []
  let result = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length
    codeBlocks.push(`<pre>${escapeHtml(code.trimEnd())}</pre>`)
    return `\x00CODEBLOCK_${idx}\x00`
  })

  // Step 2: Extract inline code
  const inlineCodes: string[] = []
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = inlineCodes.length
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`)
    return `\x00INLINE_${idx}\x00`
  })

  // Step 3: Escape HTML in remaining text
  result = escapeHtml(result)

  // Step 4: Headings — visual hierarchy
  // H1: decorated title block
  result = result.replace(/^#\s+(.+)$/gm, "\n━━━━━━━━━━━━━━━\n<b>📌 $1</b>\n━━━━━━━━━━━━━━━")
  // H2: section header with line
  result = result.replace(/^##\s+(.+)$/gm, "\n<b>▸ $1</b>\n───────────")
  // H3: subsection
  result = result.replace(/^###\s+(.+)$/gm, "\n<b>• $1</b>")
  // H4-H6: minor headings
  result = result.replace(/^#{4,6}\s+(.+)$/gm, "<b>$1</b>")

  // Step 5: Bold — **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")

  // Step 6: Italic — _text_ (word boundary aware to avoid file_name_like_this)
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, "<i>$1</i>")

  // Step 7: Strikethrough — ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>")

  // Step 8: Links — [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Step 9: Bullet lists — - item or * item → bullet
  result = result.replace(/^[\t ]*[-*]\s+(.+)$/gm, "  • $1")

  // Step 11: Numbered lists — 1. item → keep number with dot
  result = result.replace(/^[\t ]*(\d+)\.\s+(.+)$/gm, "  $1. $2")

  // Step 12: Horizontal rules
  result = result.replace(/^---+$/gm, "")

  // Step 13: Clean up excessive blank lines (3+ → 2)
  result = result.replace(/\n{3,}/g, "\n\n")

  // Step 14: Restore inline code
  result = result.replace(/\x00INLINE_(\d+)\x00/g, (_match, idx) => inlineCodes[parseInt(idx)])

  // Step 15: Restore code blocks
  result = result.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_match, idx) => codeBlocks[parseInt(idx)])

  return result.trim()
}

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Strip HTML tags for plain-text fallback */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
}

/** Chunk long text for Telegram's 4096 char limit */
export function chunkText(text: string, maxLen: number = 4096): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Try to split at paragraph boundary
    let splitAt = remaining.lastIndexOf("\n\n", maxLen)
    if (splitAt < maxLen * 0.3) {
      // Paragraph break too far back, try single newline
      splitAt = remaining.lastIndexOf("\n", maxLen)
    }
    if (splitAt < maxLen * 0.3) {
      // No good break point, hard cut
      splitAt = maxLen
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}
