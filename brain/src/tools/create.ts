// brain-mcp Phase 2 — Tool: brain_create

import { type Database } from "bun:sqlite";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { Indexer } from "../indexer.js";

export interface CreateParams {
  path: string;          // relative path within brainRoot, e.g. "Projects/my-note.md"
  title: string;
  content?: string;
  tags?: string[];
  para_type?: string;
  status?: string;
}

export interface CreateResponse {
  path: string;
  title: string;
  created: true;
}

export function brainCreate(
  db: Database,
  params: CreateParams,
  brainRoot: string
): CreateResponse {
  // BRAIN-017: Path traversal protection with trailing slash
  const absPath = resolve(brainRoot, params.path);
  if (!absPath.startsWith(resolve(brainRoot) + "/")) {
    throw new Error(`Path traversal detected: ${params.path}`);
  }

  // Ensure .md extension
  const finalAbsPath = absPath.endsWith(".md") ? absPath : `${absPath}.md`;
  const finalRelPath = finalAbsPath.slice(resolve(brainRoot).length + 1);

  if (existsSync(finalAbsPath)) {
    throw new Error(`File already exists: ${finalRelPath}`);
  }

  // BRAIN-003: Sanitize values before writing into YAML frontmatter
  function yamlEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  }

  // Build frontmatter
  const now = new Date().toISOString();
  const tags = params.tags ?? [];
  const lines: string[] = [
    "---",
    `title: "${yamlEscape(params.title)}"`,
    `created: ${now}`,
  ];

  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) {
      lines.push(`  - ${yamlEscape(tag)}`);
    }
  }

  if (params.status) {
    lines.push(`status: "${yamlEscape(params.status)}"`);
  }

  lines.push("---", "");

  if (params.content) {
    lines.push(params.content);
  } else {
    lines.push(`# ${params.title}`, "");
  }

  const fileContent = lines.join("\n");

  // Ensure parent directory exists
  mkdirSync(dirname(finalAbsPath), { recursive: true });

  // Write file
  writeFileSync(finalAbsPath, fileContent, "utf-8");

  // Immediately index the new file
  const indexer = new Indexer(db, brainRoot);
  indexer.indexFile(finalAbsPath);

  return {
    path: finalRelPath,
    title: params.title,
    created: true,
  };
}
