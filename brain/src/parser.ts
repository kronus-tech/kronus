// brain-mcp Phase 1 — Markdown parser (zero external dependencies)

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  aliases: string[];
  status?: string;
  created_at?: string;
  wikilinks: Wikilink[];
  headings: Heading[];
  content: string;
  word_count: number;
}

export interface Wikilink {
  target: string;
  alias?: string;
  context: string;
}

export interface Heading {
  level: number;
  text: string;
}

// ─── YAML frontmatter parser ──────────────────────────────────────────────────

function parseFrontmatterValue(raw: string): unknown {
  const trimmed = raw.trim();

  // Array: [item1, item2]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1);
    if (inner.trim() === "") return [];
    return inner
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  }

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  // Strip surrounding quotes
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  try {
    const lines = raw.split("\n");
    let i = 0;
    let currentKey: string | null = null;
    const listBuffer: string[] = [];

    const flushList = (): void => {
      if (currentKey !== null && listBuffer.length > 0) {
        result[currentKey] = [...listBuffer];
        listBuffer.length = 0;
        currentKey = null;
      }
    };

    while (i < lines.length) {
      const line = lines[i] ?? "";

      // List item under a key
      if (currentKey !== null && /^\s*-\s+/.test(line)) {
        const val = line.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, "");
        listBuffer.push(val);
        i++;
        continue;
      }

      // A key: value line
      const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
      if (match) {
        // Flush any pending list
        flushList();

        const key = match[1] ?? "";
        const valueRaw = match[2] ?? "";

        if (valueRaw.trim() === "") {
          // Value on next lines (list with dashes)
          currentKey = key;
        } else {
          result[key] = parseFrontmatterValue(valueRaw);
        }
      }

      i++;
    }

    // Flush trailing list
    flushList();
  } catch {
    // Malformed YAML — return what we have so far
  }

  return result;
}

// ─── Code block masking ───────────────────────────────────────────────────────
// Replace code block content with spaces so wikilinks/tags inside are skipped,
// while preserving character positions for context extraction.

function maskCodeBlocks(text: string): string {
  // Mask fenced blocks first (``` or ~~~)
  let masked = text.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, (match) =>
    " ".repeat(match.length)
  );
  // Mask inline code
  masked = masked.replace(/`[^`\n]+`/g, (match) => " ".repeat(match.length));
  return masked;
}

// ─── Wikilink extraction ──────────────────────────────────────────────────────

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

function extractWikilinks(raw: string): Wikilink[] {
  const masked = maskCodeBlocks(raw);
  const links: Wikilink[] = [];

  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;

  while ((match = WIKILINK_RE.exec(masked)) !== null) {
    const target = (match[1] ?? "").trim().toLowerCase();
    const alias = (match[2] ?? "").trim() || undefined;

    // Extract ~50 chars of context from original text (not masked)
    const start = Math.max(0, match.index - 50);
    const end = Math.min(raw.length, match.index + match[0].length + 50);
    const context = raw.slice(start, end).replace(/\n/g, " ").trim();

    if (target) {
      links.push({ target, alias, context });
    }
  }

  return links;
}

// ─── Tag extraction ───────────────────────────────────────────────────────────

const INLINE_TAG_RE = /(?<![`\w])#([a-zA-Z][a-zA-Z0-9_-]+)/g;

function extractInlineTags(raw: string): string[] {
  const masked = maskCodeBlocks(raw);
  const tags: string[] = [];

  let match: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;

  while ((match = INLINE_TAG_RE.exec(masked)) !== null) {
    const tag = (match[1] ?? "").toLowerCase();
    if (tag) tags.push(tag);
  }

  return tags;
}

// ─── Heading extraction ───────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let match: RegExpExecArray | null;

  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(content)) !== null) {
    headings.push({
      level: (match[1] ?? "").length,
      text: (match[2] ?? "").trim(),
    });
  }

  return headings;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseNote(raw: string, fallbackTitle: string): ParsedNote {
  // Split frontmatter
  let frontmatter: Record<string, unknown> = {};
  let body = raw;

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = parseYamlFrontmatter(fmMatch[1] ?? "");
    body = fmMatch[2] ?? "";
  }

  // Headings from body
  const headings = extractHeadings(body);

  // Title resolution: frontmatter → first H1 → fallback filename
  let title: string;
  if (typeof frontmatter["title"] === "string" && frontmatter["title"].trim()) {
    title = frontmatter["title"].trim();
  } else {
    const h1 = headings.find((h) => h.level === 1);
    title = h1 ? h1.text : fallbackTitle;
  }

  // Tags: frontmatter + inline, merged/deduped/sorted/lowercase
  const fmTagsRaw = frontmatter["tags"];
  const fmTags: string[] = Array.isArray(fmTagsRaw)
    ? fmTagsRaw.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
    : typeof fmTagsRaw === "string" && fmTagsRaw.trim()
    ? [fmTagsRaw.toLowerCase().trim()]
    : [];

  const inlineTags = extractInlineTags(body);
  const tagSet = new Set([...fmTags, ...inlineTags]);
  const tags = [...tagSet].sort();

  // Aliases
  const fmAliasesRaw = frontmatter["aliases"];
  const aliases: string[] = Array.isArray(fmAliasesRaw)
    ? fmAliasesRaw.map((a) => String(a).trim()).filter(Boolean)
    : typeof fmAliasesRaw === "string" && fmAliasesRaw.trim()
    ? [fmAliasesRaw.trim()]
    : [];

  // Status
  const status: string | undefined =
    typeof frontmatter["status"] === "string" && frontmatter["status"].trim()
      ? frontmatter["status"].trim()
      : undefined;

  // Created
  const created_at: string | undefined =
    typeof frontmatter["created"] === "string" && frontmatter["created"].trim()
      ? frontmatter["created"].trim()
      : undefined;

  // Wikilinks (from full body)
  const wikilinks = extractWikilinks(body);

  // Word count
  const word_count = body.split(/\s+/).filter(Boolean).length;

  return {
    title,
    frontmatter,
    tags,
    aliases,
    status,
    created_at,
    wikilinks,
    headings,
    content: body,
    word_count,
  };
}
