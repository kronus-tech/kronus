import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, appendFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import type { ProjectsConfig, AccessConfig, DaemonConfig, ProjectConfig, GroupPolicy } from "./types"

const STATE_DIR = join(homedir(), ".claude", "channels", "telegram")
const PROJECTS_FILE = join(STATE_DIR, "projects.json")
const ACCESS_FILE = join(STATE_DIR, "access.json")
const ENV_FILE = join(STATE_DIR, ".env")
const LOG_DIR = join(STATE_DIR, "logs")
const LOG_FILE = join(LOG_DIR, "daemon.log")

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** Load bot token from ~/.claude/channels/telegram/.env */
export function loadBotToken(): string {
  try {
    const content = readFileSync(ENV_FILE, "utf8")
    for (const line of content.split("\n")) {
      const match = line.match(/^TELEGRAM_BOT_TOKEN=(.+)$/)
      if (match) return match[1].trim()
    }
  } catch {
    // Fall through to env var
  }

  const envToken = process.env.TELEGRAM_BOT_TOKEN
  if (envToken) return envToken

  throw new Error(
    `Bot token not found. Set it in ${ENV_FILE} or TELEGRAM_BOT_TOKEN env var.`
  )
}

/** Load daemon configuration */
export function loadDaemonConfig(): DaemonConfig {
  ensureDir(LOG_DIR)

  return {
    botToken: loadBotToken(),
    stateDir: STATE_DIR,
    projectsFile: PROJECTS_FILE,
    accessFile: ACCESS_FILE,
    logFile: LOG_FILE,
    sessionTimeoutMs: 60 * 60 * 1000, // 1 hour
    maxConcurrentSessions: 5,
  }
}

/** Default projects.json when file doesn't exist */
function defaultProjects(): ProjectsConfig {
  return {
    projects: {},
    defaults: {
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "default",
    },
  }
}

/** Load projects.json — creates default if missing */
export function loadProjects(): ProjectsConfig {
  try {
    const content = readFileSync(PROJECTS_FILE, "utf8")
    return JSON.parse(content) as ProjectsConfig
  } catch {
    return defaultProjects()
  }
}

/** Save projects.json atomically */
export function saveProjects(config: ProjectsConfig): void {
  ensureDir(STATE_DIR)
  const tmpFile = PROJECTS_FILE + ".tmp"
  writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n")
  renameSync(tmpFile, PROJECTS_FILE)
}

/** Get project config for a group ID, or defaults for DMs */
export function getProjectForGroup(groupId: string): ProjectConfig | null {
  const projects = loadProjects()
  return projects.projects[groupId] ?? null
}

/** Get default project config (for DMs) */
export function getDefaults(): ProjectsConfig["defaults"] {
  const projects = loadProjects()
  return projects.defaults
}

/** Default access.json */
function defaultAccess(): AccessConfig {
  return {
    dmPolicy: "pairing",
    allowFrom: [],
    groups: {},
    pending: {},
  }
}

/** Load access.json — reuses the same file as the Telegram plugin */
export function loadAccess(): AccessConfig {
  try {
    const content = readFileSync(ACCESS_FILE, "utf8")
    return JSON.parse(content) as AccessConfig
  } catch {
    return defaultAccess()
  }
}

/** Check if a sender is allowed (DM context) */
export function isAllowedSender(senderId: string): boolean {
  const access = loadAccess()
  return access.allowFrom.includes(senderId)
}

/** Check if a group is registered */
export function isAllowedGroup(groupId: string, senderId: string): boolean {
  const access = loadAccess()
  const groupPolicy = access.groups[groupId]
  if (!groupPolicy) return false

  const groupAllowFrom = groupPolicy.allowFrom ?? []
  if (groupAllowFrom.length > 0 && !groupAllowFrom.includes(senderId)) {
    return false
  }

  return true
}

/** Update a project's config field */
export function updateProjectConfig(groupId: string, key: keyof ProjectConfig, value: unknown): boolean {
  const projects = loadProjects()
  const project = projects.projects[groupId]
  if (!project) return false
  ;(project as Record<string, unknown>)[key] = value
  saveProjects(projects)
  return true
}

/** Add a tool to a project's allowedTools */
export function addAllowedTool(groupId: string, tool: string): boolean {
  const projects = loadProjects()
  const project = projects.projects[groupId]
  if (!project) return false
  if (!project.allowedTools.includes(tool)) {
    project.allowedTools.push(tool)
    saveProjects(projects)
  }
  return true
}

/** Get the inbox directory for file downloads */
export function getInboxDir(groupId: string): string {
  const dir = join(STATE_DIR, "inbox", groupId)
  ensureDir(dir)
  return dir
}

// ─── v4.2: Access & Registration Helpers ────────────────────────────

/** Save access.json atomically */
export function saveAccess(config: AccessConfig): void {
  ensureDir(STATE_DIR)
  const tmpFile = ACCESS_FILE + ".tmp"
  writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n")
  renameSync(tmpFile, ACCESS_FILE)
}

/** Register a project in both projects.json and access.json at once */
export function registerProject(
  groupId: string,
  name: string,
  path: string,
  senderId: string,
  permissionMode: string = "default"
): void {
  // Write to projects.json
  const projects = loadProjects()
  projects.projects[groupId] = {
    name,
    path,
    allowedTools: ["Read", "Glob", "Grep", "Write", "Edit"],
    permissionMode: permissionMode as ProjectConfig["permissionMode"],
    addedAt: new Date().toISOString(),
  }
  saveProjects(projects)

  // Write to access.json
  const access = loadAccess()
  access.groups[groupId] = {
    requireMention: false,
    allowFrom: [senderId],
    collaboratorMode: "auto",
    collaborators: [],
    adminUsers: [senderId],
  }
  // Ensure the sender is in the global allowFrom too
  if (!access.allowFrom.includes(senderId)) {
    access.allowFrom.push(senderId)
  }
  saveAccess(access)
}

/** Check if a user is an admin for a group (group admin or global allowFrom) */
export function isGroupAdmin(groupId: string, userId: string): boolean {
  const access = loadAccess()
  // Global allowFrom users are always admins
  if (access.allowFrom.includes(userId)) return true
  // Per-group admin check
  const group = access.groups[groupId]
  return group?.adminUsers?.includes(userId) ?? false
}

/** Add a collaborator to a group */
export function addGroupCollaborator(groupId: string, userId: string): boolean {
  const access = loadAccess()
  const group = access.groups[groupId]
  if (!group) return false

  if (!group.collaborators) group.collaborators = []
  if (group.collaborators.includes(userId)) return true // Already added

  group.collaborators.push(userId)
  saveAccess(access)
  return true
}

/** Remove a collaborator from a group */
export function removeGroupCollaborator(groupId: string, userId: string): boolean {
  const access = loadAccess()
  const group = access.groups[groupId]
  if (!group?.collaborators) return false

  const idx = group.collaborators.indexOf(userId)
  if (idx === -1) return false

  group.collaborators.splice(idx, 1)
  saveAccess(access)
  return true
}

/** Set collaborator mode for a group */
export function setCollaboratorMode(groupId: string, mode: GroupPolicy["collaboratorMode"]): boolean {
  const access = loadAccess()
  const group = access.groups[groupId]
  if (!group) return false

  group.collaboratorMode = mode
  saveAccess(access)
  return true
}

/** Check if a user has Claude access in a group (allowFrom OR collaborators) */
export function hasClaudeAccess(groupId: string, userId: string): boolean {
  const access = loadAccess()
  // Global allowFrom always has access
  if (access.allowFrom.includes(userId)) return true

  const group = access.groups[groupId]
  if (!group) return false

  // Group allowFrom
  if (group.allowFrom.includes(userId)) return true

  // Collaborators list
  if (group.collaborators?.includes(userId)) return true

  return false
}

/** Simple file-based logger */
export class Logger {
  private logFile: string

  constructor(logFile: string) {
    this.logFile = logFile
    ensureDir(dirname(logFile))
  }

  private write(level: string, message: string): void {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [${level}] ${message}\n`
    try {
      appendFileSync(this.logFile, line)
    } catch {
      // Fall back to stderr if file write fails
      process.stderr.write(line)
    }
  }

  info(message: string): void {
    this.write("INFO", message)
  }

  warn(message: string): void {
    this.write("WARN", message)
  }

  error(message: string): void {
    this.write("ERROR", message)
  }

  debug(message: string): void {
    this.write("DEBUG", message)
  }
}
