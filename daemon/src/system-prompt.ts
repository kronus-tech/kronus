/**
 * Dynamic system prompt generator for Kronus Telegram sessions.
 *
 * Scans available skills, agents, and MCP servers to build a prompt
 * that tells Claude what capabilities are available and when to use them.
 * This is the key to natural language activation — Claude's intelligence
 * does the intent matching, not regex patterns.
 */

import { readdirSync, readFileSync, existsSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"
import { loadProjectMemories, loadAllMemories, formatMemoriesForPrompt } from "./memory"
import { loadRecentJournal, formatJournalForPrompt } from "./journal"

const GLOBAL_SKILLS_DIR = join(homedir(), ".claude", "skills")
const GLOBAL_AGENTS_DIR = join(homedir(), ".claude", "agents")
const GLOBAL_MCP_FILE = join(homedir(), ".claude", "mcp.json")

interface SkillInfo {
  name: string
  description: string
  triggers: string
}

interface AgentInfo {
  name: string
  description: string
}

/** Scan skill directories and extract name + description from SKILL.md frontmatter */
function scanSkills(projectPath: string): SkillInfo[] {
  const skills: SkillInfo[] = []
  const seen = new Set<string>()

  const dirs = [
    join(projectPath, ".claude", "skills"),
    GLOBAL_SKILLS_DIR,
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir)) {
        if (seen.has(entry)) continue
        const skillFile = join(dir, entry, "SKILL.md")
        if (!existsSync(skillFile)) continue

        try {
          const content = readFileSync(skillFile, "utf8")
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          const descMatch = content.match(/^description:\s*(.+)$/m)
          if (nameMatch) {
            const name = nameMatch[1].trim()
            const desc = descMatch?.[1]?.trim() ?? ""
            // Extract trigger phrases from description
            const triggerMatch = desc.match(/Auto-invoked when.*?"([^"]+)"/g)
            const triggers = triggerMatch
              ? triggerMatch.map(t => t.replace(/Auto-invoked when.*?"/,"").replace(/"$/,"")).join(", ")
              : ""
            skills.push({ name, description: desc, triggers })
            seen.add(entry)
          }
        } catch {
          // Skip unreadable skill files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return skills
}

/** Scan agent directories and extract name + description from frontmatter */
function scanAgents(projectPath: string): AgentInfo[] {
  const agents: AgentInfo[] = []
  const seen = new Set<string>()

  const dirs = [
    join(projectPath, ".claude", "agents"),
    GLOBAL_AGENTS_DIR,
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith(".md") || entry === "README.md") continue
        const name = entry.replace(".md", "")
        if (seen.has(name) || name.includes(".bak.")) continue

        try {
          const content = readFileSync(join(dir, entry), "utf8")
          const descMatch = content.match(/^description:\s*(.+)$/m)
          agents.push({
            name,
            description: descMatch?.[1]?.trim() ?? "",
          })
          seen.add(name)
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }

  return agents
}

/** Read MCP server names from config */
function scanMCPServers(projectPath: string): string[] {
  const servers: string[] = []
  const seen = new Set<string>()

  const files = [
    join(projectPath, ".claude", "mcp.json"),
    GLOBAL_MCP_FILE,
  ]

  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      const config = JSON.parse(readFileSync(file, "utf8"))
      const serverMap = config.servers ?? config.mcpServers ?? {}
      for (const name of Object.keys(serverMap)) {
        if (!seen.has(name)) {
          servers.push(name)
          seen.add(name)
        }
      }
    } catch {
      // Skip
    }
  }

  return servers
}

/** Build the full system prompt for a Telegram session */
export function buildSystemPrompt(
  projectPath: string,
  projectName: string,
  permissionMode: string
): string {
  const skills = scanSkills(projectPath)
  const agents = scanAgents(projectPath)
  const mcpServers = scanMCPServers(projectPath)

  const lines: string[] = []

  // Context
  const isPersonal = projectName === "kronus-personal"
  lines.push(`[KRONUS TELEGRAM SESSION]`)
  if (isPersonal) {
    lines.push(`[PERSONAL DM — ADMIN MODE]`)
    lines.push(`This is the owner's personal DM with Kronus. You are their personal AI assistant.`)
    lines.push(`You have cross-project awareness. You can read files from any project directory for context.`)
    lines.push(`Save notes and todos to ${projectPath}/journal/ and ${projectPath}/memory/`)
  }
  lines.push(`Project: ${projectName} (${projectPath})`)
  lines.push(`Mode: ${permissionMode}`)
  lines.push(``)
  lines.push(`RESPONSE STYLE (CRITICAL — this is Telegram, not a document):`)
  lines.push(`- Be CONCISE. 2-5 sentences max by default. Bullet points over paragraphs.`)
  lines.push(`- Lead with the answer, not the reasoning. No preamble ("Sure!", "Great question!").`)
  lines.push(`- Only give detailed responses when explicitly asked ("explain in detail", "elaborate", "give me everything").`)
  lines.push(`- Match the user's energy — short question gets short answer.`)
  lines.push(`- Code blocks: only when the user is working on code. Otherwise describe outcomes.`)
  lines.push(`- The user sees ONLY your final response. Include all relevant content — don't reference previous messages.`)

  // Profession-aware tone
  const profession = process.env["KRONUS_PROFESSION"] ?? "general"
  const toneMap: Record<string, string> = {
    developer: "Be technical and precise. Use file references, diffs, and code. Skip explanations of basic concepts.",
    researcher: "Be academic and structured. Cite sources when relevant. Use clear methodology.",
    lawyer: "Be precise and thorough. Flag risks and caveats. Structure analysis clearly.",
    consultant: "Be ROI-focused and actionable. Lead with recommendations, support with data.",
    writer: "Respect their voice. Suggest, don't rewrite. Focus on structure and clarity.",
    student: "Be encouraging and clear. Use examples. Build understanding, don't just give answers.",
    business: "Be strategic and metrics-driven. Executive summary style. Actionable next steps.",
    general: "Be helpful and clear. Adapt to what the user seems to need.",
  }
  const tone = toneMap[profession] ?? toneMap.general
  lines.push(`- Profession tone: ${tone}`)
  lines.push(``)

  // Skills
  lines.push(`AVAILABLE SKILLS — Use the Skill tool to invoke these. Match user intent to the right skill:`)
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`)
  }
  lines.push(``)
  lines.push(`IMPORTANT: When the user's request matches a skill's trigger (e.g., "standup", "review", "write tests"), USE the Skill tool to invoke it. Do not manually implement what a skill already does.`)
  lines.push(``)

  // Agents
  lines.push(`AVAILABLE AGENTS — Use the Agent tool for complex multi-turn tasks:`)
  for (const agent of agents) {
    lines.push(`- ${agent.name}: ${agent.description}`)
  }
  lines.push(``)
  lines.push(`Use agents when: the task requires multi-file analysis, deep review, architecture design, or sustained multi-step work. Use skills for quick single-pass workflows.`)
  lines.push(``)

  // MCP Servers
  if (mcpServers.length > 0) {
    lines.push(`CONNECTED MCP SERVERS — These provide external tool access:`)
    const mcpDescriptions: Record<string, string> = {
      github: "GitHub PRs, issues, repo search, code search",
      playwright: "Browser automation, web scraping, screenshots",
      "brave-search": "Web search for research and fact-checking",
      context7: "Up-to-date library documentation",
      filesystem: "Read/write files in ~/second-brain (PARA structure)",
      memory: "Persistent knowledge graph for cross-session memory",
      notion: "Notion pages, databases, knowledge base",
      slack: "Slack messages, channels, team communication",
      linear: "Linear issues, projects, sprint tracking",
    }
    for (const server of mcpServers) {
      const desc = mcpDescriptions[server] ?? ""
      lines.push(`- ${server}${desc ? ': ' + desc : ''}`)
    }
    lines.push(``)
    lines.push(`Use MCP tools when the user needs external data (GitHub issues, web search, Notion docs, etc.).`)
    lines.push(``)
  }

  // Second brain
  lines.push(`SECOND BRAIN: You have access to ~/second-brain/ (PARA structure: Projects/, Areas/, Resources/, Archive/). Save important notes, proposals, templates there when asked.`)
  lines.push(``)

  // Cross-session memory injection
  try {
    const memories = isPersonal
      ? loadAllMemories(3, 50)
      : loadProjectMemories(projectName, 7, 30)

    const memoryBlock = formatMemoriesForPrompt(memories)
    if (memoryBlock) {
      lines.push(memoryBlock)
    }
  } catch {
    // Memory loading failure should never block session start
  }

  // Personal journal context (DM only)
  if (isPersonal) {
    try {
      const journalEntries = loadRecentJournal(2, 15)
      const journalBlock = formatJournalForPrompt(journalEntries)
      if (journalBlock) {
        lines.push(journalBlock)
        lines.push(`JOURNAL: Conversations in this DM are auto-saved to ~/second-brain/kronus/journal/. You can read past journal files for deeper context. Proactively recall relevant past conversations when the user revisits a topic.`)
        lines.push(``)
      }
    } catch {
      // Journal loading failure should never block session start
    }
  }

  // Plan mode guidance
  if (permissionMode === "plan") {
    lines.push(`PLAN MODE ACTIVE: Read and analyze but do NOT make changes. Suggest what to do, which skills/agents to use, and what the implementation plan should be. Ask clarifying questions. Use the planner agent for complex task decomposition.`)
  }

  return lines.join("\n")
}
