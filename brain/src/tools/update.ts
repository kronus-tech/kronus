// brain-mcp Phase 2 — Tool: brain_update

import { type Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { Indexer } from "../indexer.js";

export interface UpdateParams {
  path: string;             // relative path within brainRoot
  title?: string;
  content?: string;         // if set, replaces the body after frontmatter
  tags?: string[];          // if set, replaces tags in frontmatter
  status?: string;          // if set, replaces/adds status in frontmatter
  append?: string;          // if set, appends text to end of content
}

export interface UpdateResponse {
  path: string;
  updated: true;
}

export function brainUpdate(
  db: Database,
  params: UpdateParams,
  brainRoot: string
): UpdateResponse {
  // BRAIN-017: Path traversal protection with trailing slash
  const absPath = resolve(brainRoot, params.path);
  if (!absPath.startsWith(resolve(brainRoot) + "/")) {
    throw new Error(`Path traversal detected: ${params.path}`);
  }

  // Read existing file
  const raw = readFileSync(absPath, "utf-8");

  // Split into frontmatter + body
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  let fmLines: string[] = [];
  let body: string = raw;

  if (fmMatch) {
    fmLines = (fmMatch[1] ?? "").split("\n");
    body = fmMatch[2] ?? "";
  }

  // BRAIN-006: Sanitize values before writing into YAML
  function yamlEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  }

  // Patch frontmatter fields
  if (params.title !== undefined) {
    fmLines = patchFmField(fmLines, "title", `"${yamlEscape(params.title)}"`);
  }

  if (params.status !== undefined) {
    fmLines = patchFmField(fmLines, "status", `"${yamlEscape(params.status)}"`);
  }

  if (params.tags !== undefined) {
    // Remove old tags block
    fmLines = removeFmField(fmLines, "tags");
    // Add new tags block
    if (params.tags.length > 0) {
      fmLines.push("tags:");
      for (const tag of params.tags) {
        fmLines.push(`  - ${yamlEscape(tag)}`);
      }
    }
  }

  // Update body
  let newBody = body;
  if (params.content !== undefined) {
    newBody = params.content;
  } else if (params.append !== undefined) {
    newBody = body.trimEnd() + "\n\n" + params.append + "\n";
  }

  // Reconstruct file
  let newRaw: string;
  if (fmMatch) {
    newRaw = `---\n${fmLines.join("\n")}\n---\n${newBody}`;
  } else {
    newRaw = newBody;
  }

  writeFileSync(absPath, newRaw, "utf-8");

  // Re-index
  const indexer = new Indexer(db, brainRoot);
  indexer.indexFile(absPath);

  return { path: params.path, updated: true };
}

// BRAIN-005: Escape regex metacharacters in key before constructing RegExp
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replace a single-line frontmatter key value
function patchFmField(lines: string[], key: string, value: string): string[] {
  const keyRe = new RegExp(`^${escapeRegex(key)}:`);
  const idx = lines.findIndex((l) => keyRe.test(l));
  if (idx >= 0) {
    lines[idx] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }
  return lines;
}

// Remove a frontmatter field (including multi-line list blocks)
function removeFmField(lines: string[], key: string): string[] {
  const keyRe = new RegExp(`^${escapeRegex(key)}:`);
  const result: string[] = [];
  let skip = false;

  for (const line of lines) {
    if (keyRe.test(line)) {
      skip = true;
      continue;
    }
    // Stop skipping when we hit a new key or a non-list-item line
    if (skip) {
      if (/^\s+-\s/.test(line)) continue; // still a list item under the removed key
      skip = false;
    }
    result.push(line);
  }

  return result;
}
