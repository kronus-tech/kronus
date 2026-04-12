/**
 * Per-project persona system for Kronus Telegram daemon.
 *
 * Generates and manages .claude/rules/persona.md files that Claude Code
 * reads automatically from the project cwd. No changes needed to session
 * spawning — Claude picks up rules files on its own.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { PersonaOptions } from "./types"

const PERSONA_FILE = ".claude/rules/persona.md"

const STYLE_DESCRIPTIONS: Record<string, string> = {
  professional: "Clear, structured, and business-appropriate. Direct communication without unnecessary formality. Like a senior engineer talking to peers.",
  casual: "Friendly, approachable, and relaxed. Natural conversation style with warmth. Like chatting with a knowledgeable friend.",
  sassy: "Witty, sharp, and playfully bold. Quick comebacks, meme energy, roasts wrapped in love. Sweet underneath the sass.",
  custom: "",
}

const LANGUAGE_DESCRIPTIONS: Record<string, string> = {
  english: "Full English at all times. Clean, clear, natural.",
  "hindi-english": "Bilingual Hindi-English mix (Hinglish), the way friends actually talk. Natural code-switching.",
  "urdu-english": "Urdu-English mix with a lean toward cleaner, more beautiful Urdu. Tehzeeb aur tameez.",
  custom: "",
}

/** Generate persona.md content from structured options */
export function generatePersonaMd(options: PersonaOptions): string {
  const {
    name,
    style,
    customStyle,
    language,
    customLanguage,
    responsibilities,
    people,
    projectPath,
    projectName,
  } = options

  const styleDesc = style === "custom" ? (customStyle ?? "") : STYLE_DESCRIPTIONS[style]
  const langDesc = language === "custom" ? (customLanguage ?? "") : LANGUAGE_DESCRIPTIONS[language]

  const lines: string[] = []

  // Header
  lines.push(`# ${name}`)
  lines.push("")
  lines.push(`> OVERRIDE: This project has its own personality. Global \`client-voice.md\`, \`agent-output.md\`, and \`skill-output.md\` rules do NOT apply here unless they align with this persona.`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // Who You Are
  lines.push("## Who You Are")
  lines.push("")
  lines.push(`You are **${name}** — the AI member of this project space.`)
  lines.push(`${styleDesc}`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // The People
  if (people.length > 0) {
    lines.push("## The People")
    lines.push("")
    for (const person of people) {
      lines.push(`### ${person.name}`)
      lines.push(`- ${person.description}`)
      lines.push("")
    }
    lines.push(`### You (${name})`)
    lines.push(`- The AI member of this space`)
    if (responsibilities.length > 0) {
      lines.push(`- Responsibilities: ${responsibilities.join(", ")}`)
    }
    lines.push("")
    lines.push("---")
    lines.push("")
  }

  // Your Voice
  lines.push("## Your Voice")
  lines.push("")
  lines.push(`**Language:** ${langDesc}`)
  lines.push(`**Tone:** ${styleDesc}`)
  lines.push(`**Concise:** Keep responses focused. Expand only when depth is needed.`)
  lines.push("")
  if (responsibilities.length > 0) {
    lines.push("### What You Do")
    for (const resp of responsibilities) {
      lines.push(`- ${resp}`)
    }
    lines.push("")
  }
  lines.push("---")
  lines.push("")

  // Privacy & Access
  lines.push("## Privacy & Access")
  lines.push("")
  lines.push("### HARD RULES (non-negotiable)")
  lines.push("")
  lines.push(`1. **Fully isolated memory** — your memory and context lives ONLY in \`${projectPath}/\``)
  lines.push(`2. **${name} IS the system** — you are the AI agent + skill system with a personality. Own your capabilities in first person: "I can review code", "I can run tests"`)
  lines.push(`3. **Other personas are private** — other bot personas, their conversation spaces, and their context are strictly private. They don't exist in your world`)
  lines.push(`4. **No context leaking** — never surface information from outside this project folder. What happens here stays here`)
  lines.push(`5. **What happens in ${projectName} stays in ${projectName}** — conversations here are private to this group`)
  lines.push("")
  lines.push("### What's Allowed")
  lines.push(`- Everything within the \`${projectPath}/\` directory`)
  lines.push(`- Reading \`~/second-brain/\` for general knowledge (read-only)`)
  lines.push(`- All agent and skill capabilities available in this project`)
  lines.push("")
  lines.push("### What's NOT Allowed")
  lines.push(`- Any path outside \`${projectPath}/\` and \`~/second-brain/\``)
  lines.push(`- Writing to \`~/second-brain/\` (read-only)`)
  lines.push(`- Accessing or referencing other bot personas or their private spaces`)
  lines.push(`- Sharing this project's context with any other system`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // Output Rules
  lines.push("## Output Rules")
  lines.push("")
  if (style === "sassy" || style === "casual") {
    lines.push("- **Conversational.** No JSON output unless explicitly asked. Just talk")
    lines.push("- **Markdown is fine** for lists, emphasis, organizing ideas")
    lines.push("- **Match the energy.** If they're hyped, be hyped. If they're chill, be chill")
    lines.push("- **Code only when asked.** Otherwise, keep it conversational")
  } else {
    lines.push("- **Clear and structured.** Use markdown for organization when helpful")
    lines.push("- **Lead with the answer.** Don't bury the key information")
    lines.push("- **Code when relevant.** Include code examples when they help explain")
    lines.push("- **Actionable.** End with clear next steps when applicable")
  }
  lines.push("")

  return lines.join("\n")
}

/** Read existing persona from project directory */
export function readPersona(projectPath: string): { source: string; content: string; name: string } | null {
  // Check .claude/rules/persona.md first
  const personaPath = join(projectPath, PERSONA_FILE)
  if (existsSync(personaPath)) {
    const content = readFileSync(personaPath, "utf8")
    const nameMatch = content.match(/^# (.+)$/m)
    return {
      source: "persona.md",
      content,
      name: nameMatch?.[1] ?? "Unknown",
    }
  }

  // Check CLAUDE.md for persona content
  const claudeMdPath = join(projectPath, "CLAUDE.md")
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf8")
    // Detect persona by looking for identity/personality markers
    const hasPersona = content.includes("## Who You Are")
      || content.includes("## Identity")
      || content.includes("## Your Voice")
      || content.includes("## Personality")
      || content.includes("Personality")
      || content.includes("OVERRIDE: This project has its own personality")
      || content.match(/You are \*\*\w+\*\*/)
      || content.match(/adopt the \*\*\w+\*\* persona/)
      || content.match(/## \w+ — .*(?:Persona|Assistant|Personality)/)
    if (hasPersona) {
      // Try to extract persona name from various patterns
      const personaNameMatch = content.match(/adopt the \*\*(\w+)\*\* persona/)
        ?? content.match(/You are \*\*([^*]+)\*\*/)
        ?? content.match(/## (\w+) — .*(?:Persona|Assistant|Personality)/)
        ?? content.match(/^# (.+)$/m)
      return {
        source: "CLAUDE.md",
        content,
        name: personaNameMatch?.[1] ?? "Unknown",
      }
    }
  }

  return null
}

/** Write persona to .claude/rules/persona.md */
export function writePersona(projectPath: string, content: string): void {
  const rulesDir = join(projectPath, ".claude", "rules")
  if (!existsSync(rulesDir)) {
    mkdirSync(rulesDir, { recursive: true })
  }
  writeFileSync(join(projectPath, PERSONA_FILE), content, "utf8")
}

/** Remove persona file */
export function clearPersona(projectPath: string): boolean {
  const personaPath = join(projectPath, PERSONA_FILE)
  if (existsSync(personaPath)) {
    unlinkSync(personaPath)
    return true
  }
  return false
}
