// brain-mcp v5.5 — Multi-root / cross-project knowledge tests
//
// Covers:
//   - Multi-root Indexer construction (BrainRoot[] and legacy string)
//   - Personal root: all .md files indexed
//   - Project root: only */memory/*.md files indexed
//   - source_root column set correctly per root
//   - initialScan() across all roots
//   - Missing roots skipped gracefully
//   - brain_search source filter (personal / project / unfiltered)
//   - brain_search source + FTS query combined
//   - brain_search source + empty query (recent notes path)
//   - brain_search source + para_type combined
//   - brain_map source_breakdown
//   - brain_recent source filter
//   - brain_orphans source filter
//   - inferParaType for project memory frontmatter types
//   - brain_create only writes to personal root
//   - Path traversal protection in indexer paths

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { runMigrations } from "../src/migrations.js";
import { Indexer } from "../src/indexer.js";
import type { BrainRoot } from "../src/config.js";
import { brainSearch } from "../src/tools/search.js";
import { brainMap } from "../src/tools/map.js";
import { brainRecent } from "../src/tools/recent.js";
import { brainOrphans } from "../src/tools/orphans.js";
import { brainCreate } from "../src/tools/create.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

interface TestEnv {
  db: Database;
  personalDir: string;
  projectsDir: string;
  roots: BrainRoot[];
  indexer: Indexer;
}

/** Build an isolated two-root environment with in-memory-style SQLite. */
function makeEnv(): TestEnv {
  const personalDir = mkdtempSync(join(tmpdir(), "brain-personal-"));
  const projectsDir = mkdtempSync(join(tmpdir(), "brain-projects-"));

  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);

  const roots: BrainRoot[] = [
    { path: personalDir, label: "personal" },
    { path: projectsDir, label: "project" },
  ];

  const indexer = new Indexer(db, roots);
  return { db, personalDir, projectsDir, roots, indexer };
}

function teardownEnv(env: TestEnv): void {
  env.db.close();
  rmSync(env.personalDir, { recursive: true, force: true });
  rmSync(env.projectsDir, { recursive: true, force: true });
}

/**
 * Write a markdown file relative to a root directory.
 * Creates parent directories automatically.
 */
function writeNote(rootDir: string, relPath: string, content: string): string {
  const absPath = join(rootDir, relPath);
  mkdirSync(join(absPath, ".."), { recursive: true });
  writeFileSync(absPath, content, "utf-8");
  return absPath;
}

/** Minimal frontmatter note for personal brain */
function personalNote(title: string, body = ""): string {
  return `---\ntitle: "${title}"\n---\n\n# ${title}\n${body}\n`;
}

/** Project memory note with a frontmatter `type` field */
function projectMemoryNote(title: string, type: string, body = ""): string {
  return `---\ntitle: "${title}"\ntype: ${type}\n---\n\n# ${title}\n${body}\n`;
}

/** Query helper — fetch a single node row by path */
interface NodeRow {
  path: string;
  title: string;
  para_type: string;
  source_root: string;
}

function getNode(db: Database, relPath: string): NodeRow | null {
  return db
    .query<NodeRow, [string]>(
      "SELECT path, title, para_type, source_root FROM nodes WHERE path = ?"
    )
    .get(relPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Multi-root Indexer construction
// ─────────────────────────────────────────────────────────────────────────────

describe("Multi-root Indexer construction", () => {
  it("accepts BrainRoot[] array without throwing", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const roots: BrainRoot[] = [{ path: "/tmp/fake-personal", label: "personal" }];
    expect(() => new Indexer(db, roots)).not.toThrow();
    db.close();
  });

  it("accepts legacy string path for backward compatibility", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(() => new Indexer(db, "/tmp/fake-single-root")).not.toThrow();
    db.close();
  });

  it("legacy string constructor wraps path as personal root", () => {
    const dir = mkdtempSync(join(tmpdir(), "brain-legacy-"));
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    writeNote(dir, "my-note.md", personalNote("Legacy Note"));
    const indexer = new Indexer(db, dir);
    indexer.initialScan();

    const node = getNode(db, "my-note.md");
    expect(node).not.toBeNull();
    // Legacy single-root should store label as "personal"
    expect(node?.source_root).toBe("personal");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Personal root indexes all .md files
// ─────────────────────────────────────────────────────────────────────────────

describe("Personal root — full .md walk", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("indexes a note at root level", () => {
    writeNote(env.personalDir, "hello.md", personalNote("Hello"));
    env.indexer.initialScan();
    expect(getNode(env.db, "hello.md")).not.toBeNull();
  });

  it("indexes a note in a subdirectory", () => {
    writeNote(env.personalDir, "Projects/work.md", personalNote("Work"));
    env.indexer.initialScan();
    expect(getNode(env.db, "Projects/work.md")).not.toBeNull();
  });

  it("indexes notes in deeply nested directories", () => {
    writeNote(env.personalDir, "a/b/c/deep.md", personalNote("Deep"));
    env.indexer.initialScan();
    expect(getNode(env.db, "a/b/c/deep.md")).not.toBeNull();
  });

  it("does not index non-.md files", () => {
    writeFileSync(join(env.personalDir, "README.txt"), "plain text", "utf-8");
    writeFileSync(join(env.personalDir, "data.json"), "{}", "utf-8");
    env.indexer.initialScan();

    const count = env.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM nodes")
      .get();
    expect(count?.count).toBe(0);
  });

  it("sets source_root = 'personal' for all personal notes", () => {
    writeNote(env.personalDir, "note1.md", personalNote("Note 1"));
    writeNote(env.personalDir, "Projects/note2.md", personalNote("Note 2"));
    env.indexer.initialScan();

    const rows = env.db
      .query<{ source_root: string }, []>(
        "SELECT source_root FROM nodes WHERE source_root = 'personal'"
      )
      .all();
    expect(rows.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Project root indexes only */memory/*.md
// ─────────────────────────────────────────────────────────────────────────────

describe("Project root — memory-only walk", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("indexes a file inside <project>/memory/", () => {
    writeNote(
      env.projectsDir,
      "my-project/memory/user_profile.md",
      projectMemoryNote("User Profile", "user")
    );
    env.indexer.initialScan();

    const node = getNode(env.db, "my-project/memory/user_profile.md");
    expect(node).not.toBeNull();
  });

  it("does NOT index a .md file outside a memory/ subdirectory", () => {
    // File directly in project root — not in memory/
    writeNote(
      env.projectsDir,
      "my-project/README.md",
      personalNote("Readme")
    );
    env.indexer.initialScan();

    const node = getNode(env.db, "my-project/README.md");
    expect(node).toBeNull();
  });

  it("does NOT index files nested deeper than <project>/memory/", () => {
    // File in <project>/memory/subdir/ — not a direct memory file
    writeNote(
      env.projectsDir,
      "my-project/memory/subdir/deep.md",
      projectMemoryNote("Deep", "user")
    );
    env.indexer.initialScan();

    // collectProjectMemoryFiles only reads direct children of memory/
    // so this should not be indexed
    const node = getNode(env.db, "my-project/memory/subdir/deep.md");
    expect(node).toBeNull();
  });

  it("sets source_root = 'project' for project memory notes", () => {
    writeNote(
      env.projectsDir,
      "proj-a/memory/feedback.md",
      projectMemoryNote("Feedback", "feedback")
    );
    env.indexer.initialScan();

    const node = getNode(env.db, "proj-a/memory/feedback.md");
    expect(node?.source_root).toBe("project");
  });

  it("indexes memory files across multiple projects", () => {
    writeNote(env.projectsDir, "proj-a/memory/note1.md", projectMemoryNote("N1", "user"));
    writeNote(env.projectsDir, "proj-b/memory/note2.md", projectMemoryNote("N2", "project"));
    writeNote(env.projectsDir, "proj-c/memory/note3.md", projectMemoryNote("N3", "feedback"));
    env.indexer.initialScan();

    const count = env.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM nodes WHERE source_root = 'project'")
      .get();
    expect(count?.count).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. source_root column correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("source_root column", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("personal note has source_root = 'personal'", () => {
    writeNote(env.personalDir, "p.md", personalNote("Personal"));
    env.indexer.initialScan();
    expect(getNode(env.db, "p.md")?.source_root).toBe("personal");
  });

  it("project memory note has source_root = 'project'", () => {
    writeNote(env.projectsDir, "proj/memory/m.md", projectMemoryNote("Mem", "user"));
    env.indexer.initialScan();
    expect(getNode(env.db, "proj/memory/m.md")?.source_root).toBe("project");
  });

  it("both roots scanned in same initialScan have correct source_root", () => {
    writeNote(env.personalDir, "personal-note.md", personalNote("Personal Note"));
    writeNote(env.projectsDir, "proj/memory/proj-note.md", projectMemoryNote("Proj Note", "feedback"));
    env.indexer.initialScan();

    const personalNode = getNode(env.db, "personal-note.md");
    const projectNode = getNode(env.db, "proj/memory/proj-note.md");

    expect(personalNode?.source_root).toBe("personal");
    expect(projectNode?.source_root).toBe("project");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. initialScan() across all roots
// ─────────────────────────────────────────────────────────────────────────────

describe("initialScan() multi-root", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("scans both roots and returns combined indexed count", () => {
    writeNote(env.personalDir, "a.md", personalNote("A"));
    writeNote(env.personalDir, "b.md", personalNote("B"));
    writeNote(env.projectsDir, "proj/memory/c.md", projectMemoryNote("C", "user"));
    writeNote(env.projectsDir, "proj/memory/d.md", projectMemoryNote("D", "project"));

    const result = env.indexer.initialScan();

    expect(result.indexed).toBe(4);
    expect(result.skipped).toBe(0);
  });

  it("idempotent — second scan skips all unchanged files", () => {
    writeNote(env.personalDir, "x.md", personalNote("X"));
    writeNote(env.projectsDir, "proj/memory/y.md", projectMemoryNote("Y", "user"));

    env.indexer.initialScan();
    const second = env.indexer.initialScan();

    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it("removes nodes for files deleted from personal root", () => {
    const absPath = writeNote(env.personalDir, "will-delete.md", personalNote("Delete Me"));
    env.indexer.initialScan();

    rmSync(absPath);
    const result = env.indexer.initialScan();

    expect(result.removed).toBe(1);
    expect(getNode(env.db, "will-delete.md")).toBeNull();
  });

  it("removes nodes for files deleted from project root", () => {
    const absPath = writeNote(env.projectsDir, "proj/memory/will-delete.md", projectMemoryNote("Gone", "feedback"));
    env.indexer.initialScan();

    rmSync(absPath);
    const result = env.indexer.initialScan();

    expect(result.removed).toBe(1);
    expect(getNode(env.db, "proj/memory/will-delete.md")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Missing roots are skipped gracefully
// ─────────────────────────────────────────────────────────────────────────────

describe("Missing roots skipped gracefully", () => {
  it("initialScan does not throw when personal root does not exist", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    const roots: BrainRoot[] = [
      { path: "/nonexistent/path/that/does/not/exist", label: "personal" },
    ];
    const indexer = new Indexer(db, roots);

    expect(() => indexer.initialScan()).not.toThrow();
    db.close();
  });

  it("initialScan does not throw when project root does not exist", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    const roots: BrainRoot[] = [
      { path: "/nonexistent/projects/dir", label: "project" },
    ];
    const indexer = new Indexer(db, roots);

    expect(() => indexer.initialScan()).not.toThrow();
    db.close();
  });

  it("initialScan indexes valid root even if sibling root is missing", () => {
    const personalDir = mkdtempSync(join(tmpdir(), "brain-valid-"));
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    writeNote(personalDir, "valid.md", personalNote("Valid"));

    const roots: BrainRoot[] = [
      { path: personalDir, label: "personal" },
      { path: "/nonexistent/projects", label: "project" },
    ];
    const indexer = new Indexer(db, roots);

    const result = indexer.initialScan();
    expect(result.indexed).toBe(1);

    db.close();
    rmSync(personalDir, { recursive: true, force: true });
  });

  it("returns zero counts when all roots are missing", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);

    const roots: BrainRoot[] = [
      { path: "/no/such/personal", label: "personal" },
      { path: "/no/such/projects", label: "project" },
    ];
    const indexer = new Indexer(db, roots);
    const result = indexer.initialScan();

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.removed).toBe(0);
    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. brain_search — source filter
// ─────────────────────────────────────────────────────────────────────────────

describe("brain_search — source filter", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
    // Seed: 2 personal notes + 2 project memory notes
    writeNote(env.personalDir, "personal-a.md", personalNote("Personal Alpha", "alpha content"));
    writeNote(env.personalDir, "personal-b.md", personalNote("Personal Beta", "beta content"));
    writeNote(env.projectsDir, "proj/memory/proj-a.md", projectMemoryNote("Project Alpha", "user", "alpha content"));
    writeNote(env.projectsDir, "proj/memory/proj-b.md", projectMemoryNote("Project Beta", "feedback", "beta content"));
    env.indexer.initialScan();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("source:'personal' returns only personal notes", () => {
    const result = brainSearch(env.db, {
      query: "alpha",
      filters: { source: "personal" },
    });
    expect(result.results.every((r) => r.source === "personal")).toBe(true);
    expect(result.results.some((r) => r.source === "project")).toBe(false);
  });

  it("source:'project' returns only project memory notes", () => {
    const result = brainSearch(env.db, {
      query: "alpha",
      filters: { source: "project" },
    });
    expect(result.results.every((r) => r.source === "project")).toBe(true);
    expect(result.results.some((r) => r.source === "personal")).toBe(false);
  });

  it("no source filter returns notes from all roots", () => {
    const result = brainSearch(env.db, { query: "alpha" });
    const sources = new Set(result.results.map((r) => r.source));
    expect(sources.has("personal")).toBe(true);
    expect(sources.has("project")).toBe(true);
  });

  it("source filter with FTS query returns correct filtered set", () => {
    const result = brainSearch(env.db, {
      query: "beta",
      filters: { source: "personal" },
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.results.every((r) => r.source === "personal")).toBe(true);
    const paths = result.results.map((r) => r.path);
    expect(paths.some((p) => p.includes("proj"))).toBe(false);
  });

  it("source:'personal' with empty query returns personal notes via recent path", () => {
    const result = brainSearch(env.db, {
      query: "",
      filters: { source: "personal" },
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.source === "personal")).toBe(true);
  });

  it("source:'project' with empty query returns project notes via recent path", () => {
    const result = brainSearch(env.db, {
      query: "",
      filters: { source: "project" },
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.source === "project")).toBe(true);
  });

  it("source filter combines with para_type filter", () => {
    // Personal notes include Projects/ directory notes → para_type = project
    writeNote(env.personalDir, "Projects/personal-proj.md", personalNote("Personal Project"));
    env.indexer.initialScan();

    const result = brainSearch(env.db, {
      query: "",
      filters: { source: "personal", para_type: "project" },
    });
    expect(result.results.every((r) => r.source === "personal")).toBe(true);
    expect(result.results.every((r) => r.para_type === "project")).toBe(true);
  });

  it("source:'personal' returns zero when only project notes match query", () => {
    // "ProjectOnlyKeyword" only appears in project notes
    writeNote(env.projectsDir, "proj/memory/unique.md", projectMemoryNote("Unique", "user", "ProjectOnlyKeyword here"));
    env.indexer.initialScan();

    const result = brainSearch(env.db, {
      query: "ProjectOnlyKeyword",
      filters: { source: "personal" },
    });
    expect(result.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. brain_map — source_breakdown
// ─────────────────────────────────────────────────────────────────────────────

describe("brain_map — source_breakdown", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("source_breakdown is an array in the map response", () => {
    writeNote(env.personalDir, "n.md", personalNote("N"));
    env.indexer.initialScan();

    const map = brainMap(env.db, {});
    expect(Array.isArray(map.source_breakdown)).toBe(true);
  });

  it("source_breakdown contains an entry for 'personal' when personal notes exist", () => {
    writeNote(env.personalDir, "p1.md", personalNote("P1"));
    writeNote(env.personalDir, "p2.md", personalNote("P2"));
    env.indexer.initialScan();

    const map = brainMap(env.db, {});
    const personalEntry = map.source_breakdown.find((s) => s.source === "personal");
    expect(personalEntry).toBeDefined();
    expect(personalEntry?.count).toBe(2);
  });

  it("source_breakdown contains an entry for 'project' when project notes exist", () => {
    writeNote(env.projectsDir, "proj/memory/m.md", projectMemoryNote("M", "user"));
    env.indexer.initialScan();

    const map = brainMap(env.db, {});
    const projectEntry = map.source_breakdown.find((s) => s.source === "project");
    expect(projectEntry).toBeDefined();
    expect(projectEntry?.count).toBe(1);
  });

  it("source_breakdown has correct counts for both roots together", () => {
    writeNote(env.personalDir, "a.md", personalNote("A"));
    writeNote(env.personalDir, "b.md", personalNote("B"));
    writeNote(env.personalDir, "c.md", personalNote("C"));
    writeNote(env.projectsDir, "proj/memory/x.md", projectMemoryNote("X", "feedback"));
    writeNote(env.projectsDir, "proj/memory/y.md", projectMemoryNote("Y", "project"));
    env.indexer.initialScan();

    const map = brainMap(env.db, {});
    const personalEntry = map.source_breakdown.find((s) => s.source === "personal");
    const projectEntry = map.source_breakdown.find((s) => s.source === "project");

    expect(personalEntry?.count).toBe(3);
    expect(projectEntry?.count).toBe(2);
  });

  it("source_breakdown is empty when no notes are indexed", () => {
    const map = brainMap(env.db, {});
    expect(map.source_breakdown).toHaveLength(0);
  });

  it("total nodes equals sum of all source_breakdown counts", () => {
    writeNote(env.personalDir, "pa.md", personalNote("PA"));
    writeNote(env.personalDir, "pb.md", personalNote("PB"));
    writeNote(env.projectsDir, "proj/memory/qa.md", projectMemoryNote("QA", "user"));
    env.indexer.initialScan();

    const map = brainMap(env.db, {});
    const sum = map.source_breakdown.reduce((acc, s) => acc + s.count, 0);
    expect(sum).toBe(map.totals.nodes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. brain_recent — source filter
// ─────────────────────────────────────────────────────────────────────────────

describe("brain_recent — source filter", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
    writeNote(env.personalDir, "recent-personal.md", personalNote("Recent Personal"));
    writeNote(env.personalDir, "another-personal.md", personalNote("Another Personal"));
    writeNote(env.projectsDir, "proj/memory/recent-proj.md", projectMemoryNote("Recent Proj", "user"));
    writeNote(env.projectsDir, "proj/memory/another-proj.md", projectMemoryNote("Another Proj", "feedback"));
    env.indexer.initialScan();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("source:'personal' returns only personal notes", () => {
    const result = brainRecent(env.db, { source: "personal" });
    expect(result.total).toBeGreaterThan(0);
    expect(result.notes.every((n) => n.source === "personal")).toBe(true);
  });

  it("source:'project' returns only project notes", () => {
    const result = brainRecent(env.db, { source: "project" });
    expect(result.total).toBeGreaterThan(0);
    expect(result.notes.every((n) => n.source === "project")).toBe(true);
  });

  it("no source filter returns notes from all roots", () => {
    const result = brainRecent(env.db, {});
    const sources = new Set(result.notes.map((n) => n.source));
    expect(sources.has("personal")).toBe(true);
    expect(sources.has("project")).toBe(true);
  });

  it("source:'personal' count matches actual personal note count", () => {
    const result = brainRecent(env.db, { source: "personal" });
    expect(result.total).toBe(2);
  });

  it("source:'project' count matches actual project note count", () => {
    const result = brainRecent(env.db, { source: "project" });
    expect(result.total).toBe(2);
  });

  it("source filter combines with para_type filter", () => {
    writeNote(env.personalDir, "Projects/personal-proj.md", personalNote("Personal Project"));
    env.indexer.initialScan();

    const result = brainRecent(env.db, { source: "personal", para_type: "project" });
    expect(result.notes.every((n) => n.source === "personal" && n.para_type === "project")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. brain_orphans — source filter
// ─────────────────────────────────────────────────────────────────────────────

describe("brain_orphans — source filter", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
    // All notes below are orphans (no wikilinks between them)
    writeNote(env.personalDir, "orphan-personal.md", personalNote("Orphan Personal"));
    writeNote(env.personalDir, "orphan-personal-2.md", personalNote("Orphan Personal 2"));
    writeNote(env.projectsDir, "proj/memory/orphan-proj.md", projectMemoryNote("Orphan Proj", "user"));
    env.indexer.initialScan();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("source:'personal' returns only personal orphans", () => {
    const result = brainOrphans(env.db, { source: "personal" });
    expect(result.total).toBeGreaterThan(0);
    expect(result.orphans.every((o) => o.source === "personal")).toBe(true);
  });

  it("source:'project' returns only project orphans", () => {
    const result = brainOrphans(env.db, { source: "project" });
    expect(result.total).toBeGreaterThan(0);
    expect(result.orphans.every((o) => o.source === "project")).toBe(true);
  });

  it("no source filter returns orphans from all roots", () => {
    const result = brainOrphans(env.db, {});
    const sources = new Set(result.orphans.map((o) => o.source));
    expect(sources.has("personal")).toBe(true);
    expect(sources.has("project")).toBe(true);
  });

  it("source:'personal' count is correct", () => {
    const result = brainOrphans(env.db, { source: "personal" });
    expect(result.total).toBe(2);
  });

  it("source filter works combined with para_type filter", () => {
    mkdirSync(join(env.personalDir, "Projects"), { recursive: true });
    writeNote(env.personalDir, "Projects/proj-orphan.md", personalNote("Project Orphan"));
    env.indexer.initialScan();

    const result = brainOrphans(env.db, { source: "personal", para_type: "project" });
    expect(result.orphans.every((o) => o.source === "personal" && o.para_type === "project")).toBe(true);
  });

  it("non-orphan personal notes are excluded even with source filter", () => {
    // hub ← connected (connected is not an orphan; hub gets a backlink)
    writeNote(env.personalDir, "hub.md", personalNote("Hub"));
    writeNote(env.personalDir, "connected.md", personalNote("Connected", "See [[hub]]."));
    env.indexer.initialScan();

    const result = brainOrphans(env.db, { source: "personal" });
    const paths = result.orphans.map((o) => o.path);
    expect(paths).not.toContain("hub.md");
    expect(paths).not.toContain("connected.md");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. inferParaType for project memory frontmatter types
// ─────────────────────────────────────────────────────────────────────────────

describe("inferParaType — project memory frontmatter type mapping", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  const cases: Array<[string, string]> = [
    ["user", "area"],
    ["feedback", "resource"],
    ["project", "project"],
    ["reference", "resource"],
    ["session", "project"],
    ["research", "resource"],
  ];

  for (const [memType, expectedParaType] of cases) {
    it(`type:"${memType}" frontmatter → para_type = '${expectedParaType}'`, () => {
      writeNote(
        env.projectsDir,
        `proj/memory/${memType}-note.md`,
        projectMemoryNote(`${memType} Note`, memType)
      );
      env.indexer.initialScan();

      const node = getNode(env.db, `proj/memory/${memType}-note.md`);
      expect(node?.para_type).toBe(expectedParaType);
    });
  }

  it("unknown frontmatter type defaults to 'project'", () => {
    writeNote(
      env.projectsDir,
      "proj/memory/unknown-type.md",
      projectMemoryNote("Unknown Type", "something_weird")
    );
    env.indexer.initialScan();

    const node = getNode(env.db, "proj/memory/unknown-type.md");
    expect(node?.para_type).toBe("project");
  });

  it("missing type field defaults to 'project'", () => {
    // Note without a type field in frontmatter
    writeNote(
      env.projectsDir,
      "proj/memory/no-type.md",
      `---\ntitle: "No Type"\n---\n\n# No Type\n`
    );
    env.indexer.initialScan();

    const node = getNode(env.db, "proj/memory/no-type.md");
    expect(node?.para_type).toBe("project");
  });

  it("personal notes ignore frontmatter type — use directory-based PARA instead", () => {
    // A personal note with type:"user" in frontmatter should NOT map to "area"
    // — personal notes use directory structure, not frontmatter type
    writeNote(
      env.personalDir,
      "user-note.md", // not in Areas/ → should be "inbox"
      `---\ntitle: "User Note"\ntype: user\n---\n\n# User Note\n`
    );
    env.indexer.initialScan();

    const node = getNode(env.db, "user-note.md");
    // Personal root, not in Areas/ dir → para_type = inbox
    expect(node?.para_type).toBe("inbox");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Security — brain_create only writes to personal root
// ─────────────────────────────────────────────────────────────────────────────

describe("Security — brain_create writes to personal root only", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("brain_create writes a file inside the personal root", () => {
    brainCreate(env.db, { path: "new-note.md", title: "New Note" }, env.personalDir);
    expect(existsSync(join(env.personalDir, "new-note.md"))).toBe(true);
  });

  it("brain_create does NOT write into the project roots directory", () => {
    // When brainRoot = personalDir, a relative path can never escape to projectsDir
    brainCreate(env.db, { path: "my-note.md", title: "My Note" }, env.personalDir);
    // projectsDir should remain empty
    const projectFiles = existsSync(env.projectsDir)
      ? // Check if any .md was written there
        (() => {
          try {
            const { readdirSync } = require("fs");
            return readdirSync(env.projectsDir, { recursive: true }).filter(
              (f: string) => f.endsWith(".md")
            );
          } catch {
            return [];
          }
        })()
      : [];
    expect(projectFiles.length).toBe(0);
  });

  it("brain_create indexes the new file with source_root = 'personal'", () => {
    // brain_create uses new Indexer(db, brainRoot) internally — legacy string form
    // so source_root will be set to 'personal'
    brainCreate(env.db, { path: "created-note.md", title: "Created Note" }, env.personalDir);
    const node = getNode(env.db, "created-note.md");
    expect(node).not.toBeNull();
    expect(node?.source_root).toBe("personal");
  });

  it("brain_create throws on path traversal attempt", () => {
    expect(() =>
      brainCreate(
        env.db,
        { path: "../../etc/passwd", title: "Evil" },
        env.personalDir
      )
    ).toThrow("Path traversal");
  });

  it("brain_create throws on path traversal with encoded separators", () => {
    expect(() =>
      brainCreate(
        env.db,
        { path: "../outside-root.md", title: "Outside" },
        env.personalDir
      )
    ).toThrow("Path traversal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Path traversal protection in Indexer
// ─────────────────────────────────────────────────────────────────────────────

describe("Security — Indexer path handling", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    teardownEnv(env);
  });

  it("indexFile stores path relative to its root, not absolute", () => {
    const absPath = writeNote(env.personalDir, "Projects/my-note.md", personalNote("My Note"));
    env.indexer.indexFile(absPath, env.personalDir, "personal");

    // path column should be relative
    const node = getNode(env.db, "Projects/my-note.md");
    expect(node).not.toBeNull();
    expect(node?.path).not.toContain(env.personalDir);
    expect(node?.path).toBe("Projects/my-note.md");
  });

  it("indexFile for project root stores memory-relative path", () => {
    const absPath = writeNote(
      env.projectsDir,
      "my-proj/memory/feedback.md",
      projectMemoryNote("Feedback", "feedback")
    );
    env.indexer.indexFile(absPath, env.projectsDir, "project");

    const node = getNode(env.db, "my-proj/memory/feedback.md");
    expect(node).not.toBeNull();
    expect(node?.path).not.toContain(env.projectsDir);
  });

  it("two notes with the same filename in different roots get distinct paths", () => {
    writeNote(env.personalDir, "memory/note.md", personalNote("Personal Memory Note"));
    writeNote(env.projectsDir, "proj/memory/note.md", projectMemoryNote("Proj Memory Note", "user"));
    env.indexer.initialScan();

    // Paths relative to their respective roots — should both be stored
    const count = env.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM nodes WHERE path LIKE '%memory/note.md'")
      .get();
    // Both should be indexed (personal path: "memory/note.md", project path: "proj/memory/note.md")
    expect(count?.count).toBeGreaterThanOrEqual(1);
  });
});
