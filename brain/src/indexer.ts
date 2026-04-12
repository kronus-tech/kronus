// brain-mcp Phase 1 — Indexer core

import { type Database } from "bun:sqlite";
import { readFileSync, statSync, existsSync, readdirSync, lstatSync } from "fs";
import { relative, basename, extname, join, resolve } from "path";
import { createHash } from "crypto";
import { parseNote } from "./parser.js";
import type { BrainRoot } from "./config.js";

interface NodeRow {
  id: number;
  content_hash: string;
}

interface IdRow {
  id: number;
}

interface CountRow {
  count: number;
}

interface PathRow {
  path: string;
}

export interface ScanResult {
  indexed: number;
  skipped: number;
  removed: number;
}

export class Indexer {
  private readonly db: Database;
  private readonly brainRoots: BrainRoot[];
  // Backward compat: first root path
  private readonly brainRoot: string;

  constructor(db: Database, roots: BrainRoot[] | string) {
    this.db = db;
    if (typeof roots === "string") {
      this.brainRoots = [{ path: roots, label: "personal" }];
      this.brainRoot = roots;
    } else {
      this.brainRoots = roots;
      this.brainRoot = roots[0]?.path ?? "";
    }
  }

  // Index a single file — returns true if the file was changed/new, false if skipped
  indexFile(absPath: string, sourceRoot?: string, sourceLabel?: string): boolean {
    // Determine which root this file belongs to
    const root = sourceRoot ?? this.findRootForPath(absPath);
    const label = sourceLabel ?? this.findLabelForPath(absPath);
    const raw = readFileSync(absPath, "utf-8");
    const hash = createHash("md5").update(raw).digest("hex");
    const relPath = relative(root, absPath);

    // Hash check — skip if unchanged
    const existing = this.db
      .query<NodeRow, [string]>("SELECT id, content_hash FROM nodes WHERE path = ?")
      .get(relPath);

    if (existing && existing.content_hash === hash) return false;

    const stat = statSync(absPath);
    const parsed = parseNote(raw, basename(absPath, extname(absPath)));
    const paraType = this.inferParaType(relPath, label, parsed.frontmatter);

    // Upsert node (with source_root for v5.5 multi-root)
    this.db
      .query<void, [
        string, string, string, string, string, string | null,
        string, string, string, number, string, string, string, string
      ]>(`
        INSERT INTO nodes (
          path, title, para_type, tags, aliases, status,
          frontmatter, content, content_hash, word_count,
          heading_tree, created_at, modified_at, source_root
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          title        = excluded.title,
          para_type    = excluded.para_type,
          tags         = excluded.tags,
          aliases      = excluded.aliases,
          status       = excluded.status,
          frontmatter  = excluded.frontmatter,
          content      = excluded.content,
          content_hash = excluded.content_hash,
          word_count   = excluded.word_count,
          heading_tree = excluded.heading_tree,
          modified_at  = excluded.modified_at,
          source_root  = excluded.source_root,
          indexed_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      `)
      .run(
        relPath,
        parsed.title,
        paraType,
        JSON.stringify(parsed.tags),
        JSON.stringify(parsed.aliases),
        parsed.status ?? null,
        JSON.stringify(parsed.frontmatter),
        parsed.content,
        hash,
        parsed.word_count,
        JSON.stringify(parsed.headings),
        (parsed.created_at != null)
          ? parsed.created_at
          : (stat.birthtimeMs > 0
              ? new Date(stat.birthtimeMs).toISOString()
              : new Date().toISOString()),
        stat.mtime.toISOString(),
        label
      );

    // Get node ID after upsert
    const node = this.db
      .query<IdRow, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get(relPath);

    if (!node) return true; // should not happen

    // Clear old outgoing edges and dangling links for this node
    this.db
      .query<void, [number]>("DELETE FROM edges WHERE source_id = ?")
      .run(node.id);
    this.db
      .query<void, [number]>("DELETE FROM dangling_links WHERE source_id = ?")
      .run(node.id);

    // Wikilink edges
    for (const link of parsed.wikilinks) {
      const target = this.resolveWikilink(link.target);
      if (target) {
        this.db
          .query<void, [number, number, string]>(
            "INSERT OR IGNORE INTO edges (source_id, target_id, edge_type, context) VALUES (?, ?, 'wikilink', ?)"
          )
          .run(node.id, target.id, link.context);
      } else {
        this.db
          .query<void, [number, string, string]>(
            "INSERT OR IGNORE INTO dangling_links (source_id, target_text, context) VALUES (?, ?, ?)"
          )
          .run(node.id, link.target, link.context);
      }
    }

    // Tag co-occurrence edges
    this.computeTagEdges(node.id, parsed.tags);

    return true;
  }

  // Second pass: try to resolve dangling links after all nodes are indexed
  resolveDanglingLinks(): void {
    const dangling = this.db
      .query<{ source_id: number; target_text: string; context: string | null }, []>(
        "SELECT source_id, target_text, context FROM dangling_links"
      )
      .all();

    for (const d of dangling) {
      const target = this.resolveWikilink(d.target_text);
      if (target) {
        this.db
          .query<void, [number, number, string | null]>(
            "INSERT OR IGNORE INTO edges (source_id, target_id, edge_type, context) VALUES (?, ?, 'wikilink', ?)"
          )
          .run(d.source_id, target.id, d.context);
        this.db
          .query<void, [number, string]>(
            "DELETE FROM dangling_links WHERE source_id = ? AND target_text = ?"
          )
          .run(d.source_id, d.target_text);
      }
    }
  }

  // Remove a file from the index (CASCADE removes edges + dangling_links)
  removeFile(absPath: string, sourceRoot?: string): void {
    const root = sourceRoot ?? this.findRootForPath(absPath);
    const relPath = relative(root, absPath);
    this.db
      .query<void, [string]>("DELETE FROM nodes WHERE path = ?")
      .run(relPath);
  }

  // Find which root a path belongs to
  private findRootForPath(absPath: string): string {
    for (const r of this.brainRoots) {
      if (absPath.startsWith(r.path + "/")) return r.path;
    }
    return this.brainRoot;
  }

  // Find the label for a path
  private findLabelForPath(absPath: string): string {
    for (const r of this.brainRoots) {
      if (absPath.startsWith(r.path + "/")) return r.label;
    }
    return "personal";
  }

  // BRAIN-008: Escape LIKE wildcards to prevent unintended pattern matching
  private escapeLike(s: string): string {
    return s.replace(/[%_\\]/g, "\\$&");
  }

  // Resolve [[wikilink]] target to a node id — tries path, alias, title
  resolveWikilink(target: string): IdRow | null {
    const escaped = this.escapeLike(target);

    // 1. Exact path match: ends with /<target>.md or is <target>.md
    const byPath = this.db
      .query<IdRow, [string, string]>(
        "SELECT id FROM nodes WHERE path LIKE ? ESCAPE '\\' OR path = ?"
      )
      .get(`%/${escaped}.md`, `${target}.md`);
    if (byPath) return byPath;

    // 2. Alias match (JSON array contains the target string)
    const byAlias = this.db
      .query<IdRow, [string]>(
        "SELECT id FROM nodes WHERE aliases LIKE ? ESCAPE '\\'"
      )
      .get(`%"${escaped}"%`);
    if (byAlias) return byAlias;

    // 3. Case-insensitive title match
    const byTitle = this.db
      .query<IdRow, [string]>(
        "SELECT id FROM nodes WHERE lower(title) = ?"
      )
      .get(target.toLowerCase());

    return byTitle ?? null;
  }

  // Collect files from a project memories root: only walk */memory/*.md
  private collectProjectMemoryFiles(rootPath: string): string[] {
    const files: string[] = [];
    if (!existsSync(rootPath)) return files;

    try {
      const projectDirs = readdirSync(rootPath, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        // BRAIN-012: Skip symlinks to prevent reading outside allowed roots
        const dirPath = join(rootPath, dir.name);
        try { if (lstatSync(dirPath).isSymbolicLink()) continue; } catch { continue; }
        const memDir = join(dirPath, "memory");
        if (!existsSync(memDir)) continue;
        // Skip symlinked memory dirs too
        try { if (lstatSync(memDir).isSymbolicLink()) continue; } catch { continue; }
        try {
          const memFiles = readdirSync(memDir).filter(f => f.endsWith(".md"));
          for (const f of memFiles) {
            const filePath = join(memDir, f);
            // Skip symlinked files
            try { if (lstatSync(filePath).isSymbolicLink()) continue; } catch { continue; }
            files.push(filePath);
          }
        } catch { /* skip unreadable memory dirs */ }
      }
    } catch { /* skip unreadable root */ }

    return files;
  }

  // Full initial scan: index all .md files across all roots
  initialScan(): ScanResult {
    let indexed = 0;
    let skipped = 0;

    this.db.run("BEGIN");

    try {
      // Scan each root
      for (const root of this.brainRoots) {
        if (!existsSync(root.path)) continue;

        let files: string[];
        if (root.label === "project") {
          // For project memories: only walk */memory/*.md
          files = this.collectProjectMemoryFiles(root.path);
        } else {
          // For personal brain: walk all .md files
          const glob = new Bun.Glob("**/*.md");
          files = [...glob.scanSync({ cwd: root.path, absolute: true })];
        }

        for (const file of files) {
          const changed = this.indexFile(file, root.path, root.label);
          if (changed) indexed++;
          else skipped++;
        }
      }

      // Remove nodes for files that no longer exist on disk
      interface SourcePathRow { path: string; source_root: string }
      const allNodes = this.db
        .query<SourcePathRow, []>("SELECT path, source_root FROM nodes")
        .all();

      let removed = 0;
      for (const node of allNodes) {
        // Find the root this node belongs to — fallback to first root for unknown labels
        const root = this.brainRoots.find(r => r.label === node.source_root)
          ?? this.brainRoots[0];
        if (!root) continue;
        const absPath = join(root.path, node.path);
        if (!existsSync(absPath)) {
          this.removeFile(absPath, root.path);
          removed++;
        }
      }

      // Second pass: resolve dangling links now that all nodes exist
      this.resolveDanglingLinks();

      // Update metadata counters
      const nodeCount = this.db
        .query<CountRow, []>("SELECT COUNT(*) as count FROM nodes")
        .get() ?? { count: 0 };
      const edgeCount = this.db
        .query<CountRow, []>("SELECT COUNT(*) as count FROM edges")
        .get() ?? { count: 0 };

      this.db
        .query<void, [string]>(
          "INSERT OR REPLACE INTO metadata (key, value) VALUES ('total_nodes', ?)"
        )
        .run(String(nodeCount.count));
      this.db
        .query<void, [string]>(
          "INSERT OR REPLACE INTO metadata (key, value) VALUES ('total_edges', ?)"
        )
        .run(String(edgeCount.count));
      this.db
        .query<void, [string]>(
          "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_full_scan', ?)"
        )
        .run(new Date().toISOString());

      this.db.run("COMMIT");

      return { indexed, skipped, removed };
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
  }

  // Compute tag co-occurrence edges between this node and others sharing a tag
  private computeTagEdges(nodeId: number, tags: string[]): void {
    if (tags.length === 0) return;

    for (const tag of tags) {
      const escapedTag = this.escapeLike(tag);
      const others = this.db
        .query<IdRow, [number, string]>(
          "SELECT id FROM nodes WHERE id != ? AND tags LIKE ? ESCAPE '\\'"
        )
        .all(nodeId, `%"${escapedTag}"%`);

      for (const other of others) {
        this.db
          .query<void, [number, number]>(
            "INSERT OR IGNORE INTO edges (source_id, target_id, edge_type) VALUES (?, ?, 'tag_co')"
          )
          .run(nodeId, other.id);
      }
    }
  }

  // Infer PARA type from path prefix or frontmatter type (for project memories)
  // Supports standard PARA folders AND profession-specific folder names
  private inferParaType(relPath: string, sourceLabel: string, frontmatter: Record<string, unknown>): string {
    // Personal brain: infer from directory structure
    if (sourceLabel === "personal") {
      const topFolder = relPath.split("/")[0]?.toLowerCase() ?? "";

      // Standard PARA
      if (topFolder === "projects") return "project";
      if (topFolder === "areas") return "area";
      if (topFolder === "resources") return "resource";
      if (topFolder === "archive") return "archive";

      // Profession-specific → project type
      if (["cases", "clients", "courses", "drafts", "operations", "grants"].includes(topFolder)) return "project";

      // Profession-specific → area type
      if (["strategy", "contacts", "study-notes", "research-notes", "legal-research"].includes(topFolder)) return "area";

      // Profession-specific → resource type
      if (["templates", "papers", "literature-reviews", "research", "knowledge-base",
           "proposals", "published", "ideas", "assignments", "notes"].includes(topFolder)) return "resource";

      return "inbox";
    }

    // Project memories: map frontmatter type field to PARA
    const memType = typeof frontmatter["type"] === "string" ? frontmatter["type"] : "";
    switch (memType) {
      case "user": return "area";
      case "feedback": return "resource";
      case "project": return "project";
      case "reference": return "resource";
      case "session": return "project";
      case "research": return "resource";
      default: return "project"; // default for project memories
    }
  }
}
