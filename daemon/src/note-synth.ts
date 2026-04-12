/**
 * Personal Note Synthesizer for Kronus — Domain-Aware
 *
 * Converts personal DM memory entries (JSONL) into linked markdown notes
 * organized by life domain. Only runs for personal sessions — project
 * memories stay as isolated JSONL and never produce linked notes.
 *
 * Domains (classified from project path):
 *   work       — project directories
 *   clients    — /upwork/
 *   personal   — /pksbz/think/, kronus-personal
 *   family     — /fam/
 *   friends    — /pals/
 *
 * Structure:
 *   ~/second-brain/Areas/<domain>/people/<name>.md
 *   ~/second-brain/Areas/<domain>/log/<date>.md
 *   ~/second-brain/Areas/<domain>/status/<project>.md
 *
 * Cross-domain links use [[wikilinks]] so a person mentioned in both
 * family and work creates edges across domains in the knowledge graph.
 * Only the owner's personal DM bot sees the full linked picture.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { MemoryEntry } from "./memory"
import { loadProjects } from "./config"

const BRAIN_ROOT = join(homedir(), "second-brain")
const DOMAINS_FILE = join(homedir(), ".kronus", "domains.json")

// ─── Domain Classification ───────────────────────────────────────────────

/**
 * domains.json schema:
 * {
 *   "default": "work",
 *   "domains": ["work", "clients", "personal", "family", "friends"],
 *   "rules": [
 *     { "match": "/fam/",    "domain": "family" },
 *     { "match": "ADP",      "domain": "family",  "type": "project" }
 *   ]
 * }
 *
 * match types:
 *   - "path" (default): substring match on project path
 *   - "project": exact match on project name
 */

interface DomainRule {
  match: string
  domain: string
  type?: "path" | "project"
}

interface DomainsConfig {
  default: string
  domains: string[]
  rules: DomainRule[]
}

let domainsConfig: DomainsConfig | null = null

function loadDomainsConfig(): DomainsConfig {
  if (domainsConfig) return domainsConfig

  const fallback: DomainsConfig = {
    default: "work",
    domains: ["work", "personal"],
    rules: [],
  }

  try {
    if (existsSync(DOMAINS_FILE)) {
      domainsConfig = JSON.parse(readFileSync(DOMAINS_FILE, "utf8")) as DomainsConfig
      return domainsConfig
    }
  } catch {}

  domainsConfig = fallback
  return fallback
}

/** Project name → domain cache (built on first call) */
let domainCache: Map<string, string> | null = null

function buildDomainCache(): Map<string, string> {
  const cache = new Map<string, string>()
  const config = loadDomainsConfig()

  try {
    const projects = loadProjects()
    for (const [, projConfig] of Object.entries(projects.projects)) {
      const path = projConfig.path ?? ""
      const name = projConfig.name ?? ""
      let domain = config.default

      for (const rule of config.rules) {
        const matchType = rule.type ?? "path"
        if (matchType === "project" && name === rule.match) {
          domain = rule.domain
          break
        }
        if (matchType === "path" && path.includes(rule.match)) {
          domain = rule.domain
          break
        }
      }
      cache.set(name, domain)
    }
  } catch {}

  // Personal DM is always personal
  cache.set("kronus-personal", "personal")
  return cache
}

function getDomain(projectName: string): string {
  if (!domainCache) domainCache = buildDomainCache()
  return domainCache.get(projectName) ?? loadDomainsConfig().default
}

/** Force cache rebuild (call after domains.json changes) */
export function resetDomainCache(): void {
  domainCache = null
  domainsConfig = null
}

// ─── Slug Registry (prevents dangling wikilinks) ─────────────────────────

const knownSlugs = new Set<string>()
let scannedExisting = false

function scanExistingNotes(): void {
  if (scannedExisting) return
  scannedExisting = true

  const domainsDir = join(BRAIN_ROOT, "Areas")
  if (!existsSync(domainsDir)) return

  try {
    for (const domainDir of readdirSync(domainsDir, { withFileTypes: true })) {
      if (!domainDir.isDirectory()) continue
      const domainPath = join(domainsDir, domainDir.name)
      for (const subDir of ["people", "log", "status"]) {
        const dirPath = join(domainPath, subDir)
        if (!existsSync(dirPath)) continue
        try {
          for (const file of readdirSync(dirPath)) {
            if (file.endsWith(".md")) {
              knownSlugs.add(file.replace(".md", ""))
            }
          }
        } catch {}
      }
    }
  } catch {}
}

function safeLink(slug: string): string {
  return knownSlugs.has(slug) ? `[[${slug}]]` : ""
}

function registerSlug(slug: string): void {
  knownSlugs.add(slug)
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

/** Get domain-specific directory */
function domainDir(domain: string, sub: "people" | "log" | "status"): string {
  return join(BRAIN_ROOT, "Areas", domain, sub)
}

/** Build a wikilinks string from slugs, filtering to only known targets */
function buildLinks(slugs: string[]): string {
  const links = slugs.map(s => safeLink(sanitize(s))).filter(Boolean)
  return links.length > 0 ? links.join(", ") : ""
}

/** Common words that are not person names */
const STOP_WORDS = new Set([
  "the", "this", "that", "here", "there", "what", "when", "where", "which",
  "who", "how", "its", "also", "just", "some", "any", "all", "each", "every",
  "but", "and", "for", "not", "you", "they", "she", "are", "was", "has",
  "been", "have", "will", "can", "may", "had", "use", "get", "set", "let",
  "new", "old", "our", "run", "try", "add", "fix", "now", "got", "see",
  "need", "want", "make", "take", "give", "keep", "help", "show", "send",
  "currently", "right", "still", "already", "indifference", "status",
  "progress", "update", "blocked", "stuck", "waiting", "shipped", "deployed",
  "todo", "done", "going", "using", "based", "built", "found", "said",
  "bottom", "plan", "why", "because", "about", "from", "into", "with",
  "after", "before", "during", "between", "through", "above", "below",
  "first", "last", "next", "then", "both", "more", "most", "only",
  "other", "such", "than", "very", "also", "back", "even", "well",
  "down", "over", "same", "long", "much", "many", "full", "left",
])

// ─── Extractors ──────────────────────────────────────────────────────────

function extractNames(content: string): string[] {
  const names: string[] = []
  const patterns = [
    /^([A-Z][a-z]{2,})\s+(?:is\s+(?:a|the|our|my)|works\s+(?:on|at|with))/m,
    /(?:client|teammate|collaborator|partner):\s*([A-Z][a-z]{2,})/i,
    /(?:talked?\s+(?:to|with)|met\s+with|heard\s+from)\s+([A-Z][a-z]{2,})/,
  ]
  for (const pat of patterns) {
    const match = content.match(pat)
    if (match?.[1] && match[1].length > 2 && !STOP_WORDS.has(match[1].toLowerCase())) {
      names.push(match[1])
    }
  }
  return names
}

function extractProjectRefs(content: string, project: string): string[] {
  const refs = new Set<string>()
  if (project && project !== "kronus-personal") {
    refs.add(project)
  }
  const projMatch = content.match(/(?:project|repo|codebase)\s+(?:called|named)?\s*"?(\w[\w-]+)"?/i)
  if (projMatch?.[1]) refs.add(projMatch[1])
  return [...refs]
}

// ─── Note Writers ────────────────────────────────────────────────────────

function synthPersonNote(name: string, content: string, domain: string, projectRefs: string[], timestamp: string): void {
  const dir = domainDir(domain, "people")
  ensureDir(dir)
  const slug = sanitize(name)
  const filePath = join(dir, `${slug}.md`)

  const date = timestamp.slice(0, 10)
  const links = buildLinks(projectRefs)
  const entry = `- ${date}: ${content.slice(0, 200)}${links ? ` (${links})` : ""}`

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8")
    if (!existing.includes(content.slice(0, 60))) {
      appendFileSync(filePath, `\n${entry}\n`)
    }
  } else {
    writeFileSync(filePath, `---
title: "${name}"
created: ${date}
type: area
tags: [person, ${domain}]
---

# ${name}

${entry}
`)
  }
  registerSlug(slug)
}

function synthLogEntry(content: string, domain: string, projectRefs: string[], personRefs: string[], timestamp: string): void {
  const dir = domainDir(domain, "log")
  ensureDir(dir)

  const date = timestamp.slice(0, 10)
  const filePath = join(dir, `${date}.md`)
  const links = buildLinks([...projectRefs, ...personRefs])
  const linkStr = links ? `\nRelated: ${links}` : ""
  const entry = `\n## ${content.slice(0, 100)}\n\n${content}${linkStr}\n`

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8")
    if (!existing.includes(content.slice(0, 60))) {
      appendFileSync(filePath, entry)
    }
  } else {
    writeFileSync(filePath, `---
title: "${domain} — ${date}"
created: ${date}
type: area
tags: [log, ${domain}]
---

# ${domain} — ${date}
${entry}`)
  }
  registerSlug(date)
}

function synthStatusNote(content: string, project: string, domain: string, personRefs: string[], timestamp: string): void {
  const dir = domainDir(domain, "status")
  ensureDir(dir)
  const slug = sanitize(project)
  if (!slug || slug.length < 2) return

  const date = timestamp.slice(0, 10)
  const filePath = join(dir, `${slug}.md`)
  const links = buildLinks(personRefs)
  const entry = `- ${date}: ${content.slice(0, 200)}${links ? ` (${links})` : ""}`

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8")
    if (!existing.includes(content.slice(0, 60))) {
      appendFileSync(filePath, `\n${entry}\n`)
    }
  } else {
    writeFileSync(filePath, `---
title: "${project} — Status"
created: ${date}
type: area
tags: [status, ${domain}]
---

# ${project} — Status

${entry}
`)
  }
  registerSlug(slug)
}

// ─── Main Entry Point ────────────────────────────────────────────────────

/**
 * Synthesize linked markdown notes from personal memory entries.
 * Only call this for personal DM sessions — never for project sessions.
 *
 * Notes are organized by life domain (work, clients, personal, family, friends).
 * Cross-domain [[wikilinks]] create edges in the knowledge graph.
 */
export function synthesizePersonalNotes(memories: MemoryEntry[]): number {
  scanExistingNotes()
  let notesCreated = 0

  for (const entry of memories) {
    const personRefs = extractNames(entry.content)
    const projectRefs = extractProjectRefs(entry.content, entry.project)
    const domain = getDomain(entry.project)

    switch (entry.type) {
      case "person": {
        for (const name of personRefs) {
          synthPersonNote(name, entry.content, domain, projectRefs, entry.timestamp)
          notesCreated++
        }
        // Skip fallback — only create person notes from explicit name patterns
        break
      }

      case "decision":
      case "note": {
        if (entry.content.length > 30) {
          synthLogEntry(entry.content, domain, projectRefs, personRefs, entry.timestamp)
          notesCreated++
        }
        break
      }

      case "state": {
        const proj = projectRefs[0] ?? entry.project
        synthStatusNote(entry.content, proj, domain, personRefs, entry.timestamp)
        notesCreated++
        break
      }

      case "todo": {
        synthLogEntry(`TODO: ${entry.content}`, domain, projectRefs, personRefs, entry.timestamp)
        notesCreated++
        break
      }
    }
  }

  return notesCreated
}
