// brain/tests/indexer.test.ts
// Integration tests for Indexer — uses temp dir + in-memory-style SQLite DB.
// Never imports db.ts to avoid opening ~/.kronus/brain.sqlite.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Indexer } from "../src/indexer.js";
import { runMigrations } from "../src/migrations.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOTE_A = `---
title: Note A
tags: [test, ai]
---

# Note A

This note links to [[note-b]].

Some body content with #inline-tag.
`;

const NOTE_B = `---
title: Note B
tags: [test]
---

# Note B

This note links to [[note-a]].
`;

const ORPHAN = `---
title: Orphan
---

# Orphan Note

No wikilinks and no tags here.
`;

const AREA_NOTE = `---
title: Area Note
tags: [ai]
---

# Area Note

An area-scoped note with a shared tag.
`;

// ─── Test setup & teardown ────────────────────────────────────────────────────

interface TestContext {
  brainRoot: string;
  db: Database;
  indexer: Indexer;
}

function setupTest(): TestContext {
  const brainRoot = mkdtempSync(join(tmpdir(), "kronus-test-"));
  const dbPath = join(brainRoot, "test.sqlite");

  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

  runMigrations(db);

  const indexer = new Indexer(db, brainRoot);

  return { brainRoot, db, indexer };
}

function teardownTest(ctx: TestContext): void {
  ctx.db.close();
  rmSync(ctx.brainRoot, { recursive: true, force: true });
}

function writeNote(brainRoot: string, relPath: string, content: string): string {
  const absPath = join(brainRoot, relPath);
  const dir = absPath.slice(0, absPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(absPath, content, "utf-8");
  return absPath;
}

// ─── Helper query types ───────────────────────────────────────────────────────

interface NodeRow {
  id: number;
  path: string;
  title: string;
  para_type: string;
  tags: string;
  content_hash: string;
  word_count: number;
}

interface EdgeRow {
  id: number;
  source_id: number;
  target_id: number;
  edge_type: string;
  context: string | null;
}

interface DanglingRow {
  source_id: number;
  target_text: string;
}

// ─── indexFile — basic node creation ─────────────────────────────────────────

describe("Indexer.indexFile — node creation", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("creates a node in the DB with correct path", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    const node = ctx.db
      .query<NodeRow, [string]>("SELECT * FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    expect(node).not.toBeNull();
    expect(node?.path).toBe("Projects/note-a.md");
  });

  test("node title is parsed from frontmatter", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    const node = ctx.db
      .query<NodeRow, [string]>("SELECT title FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    expect(node?.title).toBe("Note A");
  });

  test("node tags stored as JSON array string", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    const node = ctx.db
      .query<NodeRow, [string]>("SELECT tags FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    const tags: string[] = JSON.parse(node?.tags ?? "[]");
    expect(tags).toContain("test");
    expect(tags).toContain("ai");
    // inline-tag from body should also be present
    expect(tags).toContain("inline-tag");
  });

  test("node content_hash is non-empty", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    const node = ctx.db
      .query<NodeRow, [string]>("SELECT content_hash FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    expect(node?.content_hash).toHaveLength(32); // MD5 hex = 32 chars
  });

  test("word_count is stored and greater than zero", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    const node = ctx.db
      .query<NodeRow, [string]>("SELECT word_count FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    expect(node?.word_count).toBeGreaterThan(0);
  });
});

// ─── indexFile — hash-based dedup ─────────────────────────────────────────────

describe("Indexer.indexFile — change detection", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("returns true on first index (new file)", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    const result = ctx.indexer.indexFile(absPath);
    expect(result).toBe(true);
  });

  test("returns false on re-index with unchanged content", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath); // first pass
    const result = ctx.indexer.indexFile(absPath); // second pass, same content
    expect(result).toBe(false);
  });

  test("returns true after file content changes", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    // Modify the file
    writeFileSync(absPath, NOTE_A + "\nNew content added.", "utf-8");
    const result = ctx.indexer.indexFile(absPath);
    expect(result).toBe(true);
  });

  test("re-index updates title when content changes", () => {
    const absPath = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absPath);

    const updatedContent = NOTE_A.replace("title: Note A", "title: Updated Title");
    writeFileSync(absPath, updatedContent, "utf-8");
    ctx.indexer.indexFile(absPath);

    const node = ctx.db
      .query<NodeRow, [string]>("SELECT title FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    expect(node?.title).toBe("Updated Title");
  });
});

// ─── indexFile — wikilink edges ───────────────────────────────────────────────

describe("Indexer.indexFile — wikilink edges", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("wikilink to existing note creates edge in edges table", () => {
    // Index note-b first so note-a can resolve [[note-b]]
    const absB = writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absB);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");
    const nodeB = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-b.md");

    const edge = ctx.db
      .query<EdgeRow, [number, number]>(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND edge_type = 'wikilink'"
      )
      .get(nodeA!.id, nodeB!.id);

    expect(edge).not.toBeNull();
    expect(edge?.edge_type).toBe("wikilink");
  });

  test("wikilink edge context is stored", () => {
    const absB = writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absB);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    const edge = ctx.db
      .query<EdgeRow, [number]>(
        "SELECT * FROM edges WHERE source_id = ? AND edge_type = 'wikilink'"
      )
      .get(nodeA!.id);

    expect(edge?.context).toBeTruthy();
    expect(typeof edge?.context).toBe("string");
  });

  test("wikilink to non-existent note creates dangling_link", () => {
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    const dangling = ctx.db
      .query<DanglingRow, [number]>(
        "SELECT * FROM dangling_links WHERE source_id = ?"
      )
      .get(nodeA!.id);

    // note-b is not indexed, so [[note-b]] should be dangling
    expect(dangling).not.toBeNull();
    expect(dangling?.target_text).toBe("note-b");
  });

  test("dangling link resolved after target file indexed", () => {
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    // Verify dangling link exists before resolution
    const beforeDangling = ctx.db
      .query<DanglingRow, [number]>("SELECT * FROM dangling_links WHERE source_id = ?")
      .get(nodeA!.id);
    expect(beforeDangling).not.toBeNull();

    // Now index note-b and re-index note-a to resolve links
    const absB = writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    ctx.indexer.indexFile(absB);
    // Force re-index by modifying note-a slightly
    writeFileSync(absA, NOTE_A + " ", "utf-8");
    ctx.indexer.indexFile(absA);

    const afterDangling = ctx.db
      .query<DanglingRow, [number]>("SELECT * FROM dangling_links WHERE source_id = ?")
      .get(nodeA!.id);

    expect(afterDangling).toBeNull();
  });
});

// ─── removeFile ───────────────────────────────────────────────────────────────

describe("Indexer.removeFile", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("removeFile deletes the node from nodes table", () => {
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absA);

    // Verify node exists
    const before = ctx.db
      .query<NodeRow, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");
    expect(before).not.toBeNull();

    ctx.indexer.removeFile(absA);

    const after = ctx.db
      .query<NodeRow, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");
    expect(after).toBeNull();
  });

  test("removeFile CASCADE deletes outgoing edges", () => {
    const absB = writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absB);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    // Verify edges exist from note-a
    const beforeEdges = ctx.db
      .query<EdgeRow, [number]>("SELECT * FROM edges WHERE source_id = ?")
      .all(nodeA!.id);
    expect(beforeEdges.length).toBeGreaterThan(0);

    ctx.indexer.removeFile(absA);

    const afterEdges = ctx.db
      .query<EdgeRow, [number]>("SELECT * FROM edges WHERE source_id = ?")
      .all(nodeA!.id);
    expect(afterEdges).toHaveLength(0);
  });

  test("removeFile CASCADE deletes dangling_links sourced from this node", () => {
    // note-a has [[note-b]] which is dangling (note-b not indexed)
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    const before = ctx.db
      .query<DanglingRow, [number]>("SELECT * FROM dangling_links WHERE source_id = ?")
      .all(nodeA!.id);
    expect(before.length).toBeGreaterThan(0);

    ctx.indexer.removeFile(absA);

    const after = ctx.db
      .query<DanglingRow, [number]>("SELECT * FROM dangling_links WHERE source_id = ?")
      .all(nodeA!.id);
    expect(after).toHaveLength(0);
  });

  test("removeFile on non-existent path does not throw", () => {
    const fakeAbs = join(ctx.brainRoot, "Projects/does-not-exist.md");
    expect(() => ctx.indexer.removeFile(fakeAbs)).not.toThrow();
  });
});

// ─── initialScan ─────────────────────────────────────────────────────────────

describe("Indexer.initialScan", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
    // Write the standard fixture files
    writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    writeNote(ctx.brainRoot, "Resources/orphan.md", ORPHAN);
    writeNote(ctx.brainRoot, "Areas/area-note.md", AREA_NOTE);
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("indexes all .md files in the brain root", () => {
    const result = ctx.indexer.initialScan();

    const count = ctx.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM nodes")
      .get();

    expect(count?.count).toBe(4);
    expect(result.indexed).toBe(4);
    expect(result.skipped).toBe(0);
  });

  test("skips non-.md files", () => {
    // Write a non-markdown file
    writeFileSync(join(ctx.brainRoot, "README.txt"), "not a note", "utf-8");
    writeFileSync(join(ctx.brainRoot, "config.json"), "{}", "utf-8");

    ctx.indexer.initialScan();

    const count = ctx.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM nodes")
      .get();

    // Only .md files indexed
    expect(count?.count).toBe(4);
  });

  test("second scan is idempotent — same node count", () => {
    ctx.indexer.initialScan();
    ctx.indexer.initialScan();

    const count = ctx.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM nodes")
      .get();

    expect(count?.count).toBe(4);
  });

  test("second scan skips unchanged files", () => {
    ctx.indexer.initialScan();
    const result = ctx.indexer.initialScan();

    expect(result.skipped).toBe(4);
    expect(result.indexed).toBe(0);
  });

  test("removes stale nodes for deleted files", () => {
    ctx.indexer.initialScan();

    // Delete a file from disk
    rmSync(join(ctx.brainRoot, "Resources/orphan.md"));

    const result = ctx.indexer.initialScan();
    expect(result.removed).toBe(1);

    const orphan = ctx.db
      .query<NodeRow, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Resources/orphan.md");
    expect(orphan).toBeNull();
  });

  test("updates metadata total_nodes after scan", () => {
    ctx.indexer.initialScan();

    const meta = ctx.db
      .query<{ value: string }, [string]>("SELECT value FROM metadata WHERE key = ?")
      .get("total_nodes");

    expect(meta?.value).toBe("4");
  });

  test("updates metadata last_full_scan timestamp", () => {
    ctx.indexer.initialScan();

    const meta = ctx.db
      .query<{ value: string }, [string]>("SELECT value FROM metadata WHERE key = ?")
      .get("last_full_scan");

    expect(meta?.value).toBeTruthy();
    // Should be a valid ISO8601 date
    expect(new Date(meta!.value).getTime()).not.toBeNaN();
  });
});

// ─── PARA type inference ──────────────────────────────────────────────────────

describe("Indexer — PARA type inference from path", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  const cases: Array<[string, string, string]> = [
    ["Projects/my-project.md", NOTE_A, "project"],
    ["Areas/my-area.md", AREA_NOTE, "area"],
    ["Resources/orphan.md", ORPHAN, "resource"],
    ["Archive/old-note.md", ORPHAN, "archive"],
    ["random-note.md", ORPHAN, "inbox"],
    ["nested/deep/note.md", ORPHAN, "inbox"],
  ];

  for (const [relPath, content, expectedType] of cases) {
    test(`${relPath} → para_type = '${expectedType}'`, () => {
      const absPath = writeNote(ctx.brainRoot, relPath, content);
      ctx.indexer.indexFile(absPath);

      const node = ctx.db
        .query<NodeRow, [string]>("SELECT para_type FROM nodes WHERE path = ?")
        .get(relPath);

      expect(node?.para_type).toBe(expectedType);
    });
  }
});

// ─── Tag co-occurrence edges ──────────────────────────────────────────────────

describe("Indexer — tag co-occurrence edges", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("notes sharing a tag get a tag_co edge after both are indexed", () => {
    // note-a has tags [test, ai], area-note has tags [ai] — they share 'ai'
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    const absArea = writeNote(ctx.brainRoot, "Areas/area-note.md", AREA_NOTE);

    ctx.indexer.indexFile(absA);
    ctx.indexer.indexFile(absArea);

    // Re-index note-a so it can see area-note as a co-occurrence peer
    writeFileSync(absA, NOTE_A + " ", "utf-8");
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");
    const nodeArea = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Areas/area-note.md");

    const tagEdge = ctx.db
      .query<EdgeRow, [number, number]>(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND edge_type = 'tag_co'"
      )
      .get(nodeA!.id, nodeArea!.id);

    expect(tagEdge).not.toBeNull();
  });

  test("notes sharing no tags do NOT get a tag_co edge", () => {
    // orphan has no tags, note-b has tags [test]
    const absB = writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    const absOrphan = writeNote(ctx.brainRoot, "Resources/orphan.md", ORPHAN);

    ctx.indexer.indexFile(absOrphan);
    ctx.indexer.indexFile(absB);

    const nodeB = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-b.md");
    const nodeOrphan = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Resources/orphan.md");

    const tagEdge = ctx.db
      .query<EdgeRow, [number, number]>(
        "SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND edge_type = 'tag_co'"
      )
      .get(nodeB!.id, nodeOrphan!.id);

    expect(tagEdge).toBeNull();
  });

  test("initialScan creates tag_co edges between all co-tagged notes", () => {
    writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);   // tags: test, ai, inline-tag
    writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);   // tags: test
    writeNote(ctx.brainRoot, "Resources/orphan.md", ORPHAN);  // tags: none
    writeNote(ctx.brainRoot, "Areas/area-note.md", AREA_NOTE); // tags: ai

    ctx.indexer.initialScan();

    const tagCoEdges = ctx.db
      .query<EdgeRow, []>("SELECT * FROM edges WHERE edge_type = 'tag_co'")
      .all();

    // note-a & note-b share 'test' → at least 1 tag_co edge
    // note-a & area-note share 'ai' → at least 1 tag_co edge
    expect(tagCoEdges.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Edge deduplication ───────────────────────────────────────────────────────

describe("Indexer — edge deduplication", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("re-indexing same file does not create duplicate edges", () => {
    const absB = writeNote(ctx.brainRoot, "Projects/note-b.md", NOTE_B);
    const absA = writeNote(ctx.brainRoot, "Projects/note-a.md", NOTE_A);
    ctx.indexer.indexFile(absB);
    ctx.indexer.indexFile(absA);

    const nodeA = ctx.db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/note-a.md");

    const edgesBefore = ctx.db
      .query<EdgeRow, [number]>("SELECT * FROM edges WHERE source_id = ?")
      .all(nodeA!.id);

    // Force re-index
    writeFileSync(absA, NOTE_A + "\nExtra line.", "utf-8");
    ctx.indexer.indexFile(absA);

    const edgesAfter = ctx.db
      .query<EdgeRow, [number]>("SELECT * FROM edges WHERE source_id = ?")
      .all(nodeA!.id);

    // Edge count should be the same (old edges cleared, new ones re-inserted)
    expect(edgesAfter.length).toBe(edgesBefore.length);
  });
});

// ─── wikilink resolution ──────────────────────────────────────────────────────

describe("Indexer — wikilink resolution via alias and title", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTest();
  });

  afterEach(() => {
    teardownTest(ctx);
  });

  test("resolves wikilink by case-insensitive title match", () => {
    // orphan.md has title "Orphan"
    writeNote(ctx.brainRoot, "Resources/orphan.md", ORPHAN);
    ctx.indexer.indexFile(join(ctx.brainRoot, "Resources/orphan.md"));

    const resolved = ctx.indexer.resolveWikilink("orphan");
    expect(resolved).not.toBeNull();
  });

  test("resolves wikilink by alias", () => {
    const noteWithAlias = `---
title: Aliased Note
aliases: [my-alias]
---

Body text.
`;
    const absPath = writeNote(ctx.brainRoot, "Projects/aliased.md", noteWithAlias);
    ctx.indexer.indexFile(absPath);

    const resolved = ctx.indexer.resolveWikilink("my-alias");
    expect(resolved).not.toBeNull();
  });

  test("returns null for unresolvable wikilink", () => {
    const resolved = ctx.indexer.resolveWikilink("does-not-exist-anywhere");
    expect(resolved).toBeNull();
  });
});
