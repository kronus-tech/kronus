/** Project mapping: Telegram group → Claude Code project */
export interface ProjectConfig {
  name: string
  path: string
  allowedTools: string[]
  permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions"
  addedAt: string
}

/** Top-level projects.json schema */
export interface ProjectsConfig {
  projects: Record<string, ProjectConfig>
  defaults: {
    allowedTools: string[]
    permissionMode: string
  }
}

/** Access control from access.json */
export interface AccessConfig {
  dmPolicy: "pairing" | "allowlist" | "disabled"
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
  pending: Record<string, PendingEntry>
  mentionPatterns?: string[]
}

export interface GroupPolicy {
  requireMention: boolean
  allowFrom: string[]
  /** v4.2: Collaborator mode — "auto" activates when >2 members */
  collaboratorMode?: "auto" | "on" | "off"
  /** v4.2: User IDs with Claude access in collaborator mode */
  collaborators?: string[]
  /** v4.2: User IDs who can manage collaborators (auto-set on /setup) */
  adminUsers?: string[]
}

export interface PendingEntry {
  senderId: string
  chatId: string
  createdAt: number
  expiresAt: number
  replies: number
}

/** Active Claude Code session state */
export interface SessionState {
  sessionId: string | null
  projectPath: string
  groupId: string
  lastActivity: number
  isRunning: boolean
  messageQueue: QueuedMessage[]
}

export interface QueuedMessage {
  text: string
  chatId: number
  messageId: number
  fromId: number
  timestamp: number
}

/** Claude Code stream-json event types */
export interface StreamEvent {
  type: string
  subtype?: string
  [key: string]: unknown
}

export interface ResultEvent extends StreamEvent {
  type: "result"
  result: string
  session_id: string
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export interface AssistantEvent extends StreamEvent {
  type: "assistant"
  message: {
    role: "assistant"
    content: ContentBlock[]
  }
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface TextBlock {
  type: "text"
  text: string
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string
}

/** AskUserQuestion payload from Claude */
export interface QuestionPayload {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface QuestionOption {
  label: string
  description: string
  preview?: string
}

// ─── v4.2: Session Discovery Types ──────────────────────────────────

/** Info about a session discovered on disk or from terminal */
export interface SessionInfo {
  sessionId: string
  shortId: string
  projectPath: string
  source: "daemon" | "terminal" | "disk"
  isRunning: boolean
  lastModified: number
}

/** Running Claude process detected on the system */
export interface TerminalSession {
  pid: number
  cwd: string
  args: string
}

/** Session history entry persisted to session-history.json */
export interface SessionHistoryEntry {
  sessionId: string
  projectPath: string
  startedAt: string
  endedAt: string | null
  source: "daemon" | "terminal" | "resumed"
}

/** Top-level session-history.json schema */
export interface SessionHistoryFile {
  version: 1
  groups: Record<string, SessionHistoryEntry[]>
}

/** Result of collaborator mode message check */
export interface ForwardDecision {
  forward: boolean
  strippedText: string
  replyText: string | null
}

/** Pending collaborator approval */
export interface PendingApproval {
  userId: string
  username: string
  groupId: string
  messageId: number
  timeout: ReturnType<typeof setTimeout>
}

/** Daemon configuration */
export interface DaemonConfig {
  botToken: string
  stateDir: string
  projectsFile: string
  accessFile: string
  logFile: string
  sessionTimeoutMs: number
  maxConcurrentSessions: number
}

/** Dangerous command patterns to always block */
export const BLOCKED_PATTERNS: readonly string[] = [
  "rm -rf /",
  "rm -rf ~",
  "rm -rf $HOME",
  "sudo rm",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",
  "chmod -R 777 /",
  "git push --force origin main",
  "git push --force origin master",
  "git reset --hard",
  "DROP TABLE",
  "DROP DATABASE",
  "truncate",
  "> /dev/sda",
] as const
