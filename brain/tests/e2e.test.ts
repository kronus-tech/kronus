// brain-mcp Phase 4 — End-to-end integration tests
// Tests the full chain: create → index → search → graph → backlinks → orphans → map

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";

import { runMigrations } from "../src/migrations.js";
import { Indexer } from "../src/indexer.js";
import { brainSearch } from "../src/tools/search.js";
import { brainGraph } from "../src/tools/graph.js";
import { brainCreate } from "../src/tools/create.js";
import { brainMap } from "../src/tools/map.js";
import { brainBacklinks } from "../src/tools/backlinks.js";
import { brainOrphans } from "../src/tools/orphans.js";

// ─────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────

interface TestVault {
  db: Database;
  vaultDir: string;
  indexer: Indexer;
}

function makeVault(): TestVault {
  const vaultDir = mkdtempSync(join(tmpdir(), "brain-e2e-"));
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  const indexer = new Indexer(db, vaultDir);
  return { db, vaultDir, indexer };
}

function teardownVault(vault: TestVault): void {
  vault.db.close();
  rmSync(vault.vaultDir, { recursive: true, force: true });
}

function writeNote(vaultDir: string, relPath: string, content: string): string {
  const absPath = join(vaultDir, relPath);
  mkdirSync(resolve(absPath, ".."), { recursive: true });
  writeFileSync(absPath, content, "utf-8");
  return absPath;
}

function makeFrontmatter(title: string, tags: string[] = [], extra = ""): string {
  const tagLines =
    tags.length > 0
      ? `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`
      : "";
  return `---\ntitle: "${title}"\n${tagLines}${extra ? "\n" + extra : ""}\n---\n\n# ${title}\n`;
}

// ─────────────────────────────────────────────────────────────
// E2E 1: Create → Index → Search → Verify
// ─────────────────────────────────────────────────────────────

describe("E2E: Create → Index → Search → Verify", () => {
  let vault: TestVault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    teardownVault(vault);
  });

  it("brain_create writes a file to disk", () => {
    brainCreate(vault.db, { path: "my-note.md", title: "My Note" }, vault.vaultDir);
    expect(existsSync(join(vault.vaultDir, "my-note.md"))).toBe(true);
  });

  it("file on disk has correct title in frontmatter", () => {
    brainCreate(vault.db, { path: "my-note.md", title: "My Note" }, vault.vaultDir);
    const content = readFileSync(join(vault.vaultDir, "my-note.md"), "utf-8");
    expect(content).toContain('title: "My Note"');
  });

  it("node appears in SQLite after brain_create", () => {
    brainCreate(vault.db, { path: "my-note.md", title: "My Note" }, vault.vaultDir);
    interface CountRow { count: number }
    const row = vault.db
      .query<CountRow, [string]>("SELECT COUNT(*) as count FROM nodes WHERE path = ?")
      .get("my-note.md");
    expect(row?.count).toBe(1);
  });

  it("brain_search finds the note by title keyword", () => {
    brainCreate(vault.db, { path: "my-note.md", title: "UniqueSearchTarget" }, vault.vaultDir);
    const result = brainSearch(vault.db, { query: "UniqueSearchTarget" });
    expect(result.total).toBeGreaterThan(0);
    expect(result.results[0].title).toBe("UniqueSearchTarget");
  });

  it("brain_graph shows the node with correct PARA type (inbox default)", () => {
    brainCreate(vault.db, { path: "my-note.md", title: "My Note" }, vault.vaultDir);
    const graph = brainGraph(vault.db, { path: "my-note.md" });
    expect(graph.node.title).toBe("My Note");
    expect(graph.node.para_type).toBe("inbox");
  });

  it("brain_graph shows project para_type for Projects/ path", () => {
    brainCreate(
      vault.db,
      { path: "Projects/my-project.md", title: "My Project" },
      vault.vaultDir
    );
    const graph = brainGraph(vault.db, { path: "Projects/my-project.md" });
    expect(graph.node.para_type).toBe("project");
  });

  it("brain_create adds .md extension automatically", () => {
    const result = brainCreate(
      vault.db,
      { path: "no-extension", title: "No Extension" },
      vault.vaultDir
    );
    expect(result.path).toBe("no-extension.md");
    expect(existsSync(join(vault.vaultDir, "no-extension.md"))).toBe(true);
  });

  it("brain_create throws if file already exists", () => {
    brainCreate(vault.db, { path: "dupe.md", title: "Dupe" }, vault.vaultDir);
    expect(() =>
      brainCreate(vault.db, { path: "dupe.md", title: "Dupe" }, vault.vaultDir)
    ).toThrow("already exists");
  });

  it("brain_create throws on path traversal", () => {
    expect(() =>
      brainCreate(vault.db, { path: "../../etc/passwd", title: "Evil" }, vault.vaultDir)
    ).toThrow("Path traversal");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E 2: Wikilink → Edge → Backlink
// ─────────────────────────────────────────────────────────────

describe("E2E: Wikilink → Edge → Backlink", () => {
  let vault: TestVault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    teardownVault(vault);
  });

  it("brain_backlinks for note-b shows note-a as backlink after indexing both", () => {
    // note-a links to note-b via wikilink
    writeNote(
      vault.vaultDir,
      "note-a.md",
      makeFrontmatter("Note A") + "\nSee also [[note-b]] for more details."
    );
    writeNote(vault.vaultDir, "note-b.md", makeFrontmatter("Note B"));

    // Initial scan resolves wikilinks across both files
    vault.indexer.initialScan();

    const bl = brainBacklinks(vault.db, { path: "note-b.md" });
    expect(bl.total).toBe(1);
    expect(bl.backlinks[0].path).toBe("note-a.md");
  });

  it("brain_graph for note-a shows note-b as outlink", () => {
    writeNote(
      vault.vaultDir,
      "note-a.md",
      makeFrontmatter("Note A") + "\nSee also [[note-b]] for more details."
    );
    writeNote(vault.vaultDir, "note-b.md", makeFrontmatter("Note B"));

    vault.indexer.initialScan();

    const graph = brainGraph(vault.db, { path: "note-a.md" });
    const outlinkPaths = graph.outlinks.map((e) => e.path);
    expect(outlinkPaths).toContain("note-b.md");
  });

  it("backlinks returns empty if no notes link to target", () => {
    writeNote(vault.vaultDir, "isolated.md", makeFrontmatter("Isolated"));
    vault.indexer.initialScan();

    const bl = brainBacklinks(vault.db, { path: "isolated.md" });
    expect(bl.total).toBe(0);
  });

  it("brain_backlinks throws if node does not exist", () => {
    expect(() =>
      brainBacklinks(vault.db, { path: "nonexistent.md" })
    ).toThrow("Node not found");
  });

  it("dangling link is recorded when target does not exist", () => {
    writeNote(
      vault.vaultDir,
      "source.md",
      makeFrontmatter("Source") + "\nLinks to [[ghost-note]] here."
    );
    vault.indexer.initialScan();

    const graph = brainGraph(vault.db, { path: "source.md" });
    expect(graph.dangling.some((d) => d.target_text === "ghost-note")).toBe(true);
  });

  it("dangling link resolves after target note is created and re-indexed", () => {
    writeNote(
      vault.vaultDir,
      "source.md",
      makeFrontmatter("Source") + "\nLinks to [[future-note]] here."
    );
    vault.indexer.initialScan();

    // Dangling initially
    const beforeGraph = brainGraph(vault.db, { path: "source.md" });
    expect(beforeGraph.dangling.some((d) => d.target_text === "future-note")).toBe(true);

    // Create the target
    writeNote(vault.vaultDir, "future-note.md", makeFrontmatter("Future Note"));
    vault.indexer.initialScan();

    // Should now be a real edge
    const afterGraph = brainGraph(vault.db, { path: "source.md" });
    const outlinkPaths = afterGraph.outlinks.map((e) => e.path);
    expect(outlinkPaths).toContain("future-note.md");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E 3: Orphan → Connect → No Longer Orphan
// ─────────────────────────────────────────────────────────────

describe("E2E: Orphan → Connect → No Longer Orphan", () => {
  let vault: TestVault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    teardownVault(vault);
  });

  it("brain_orphans includes a note with no links", () => {
    writeNote(vault.vaultDir, "lonely.md", makeFrontmatter("Lonely Note"));
    vault.indexer.initialScan();

    const result = brainOrphans(vault.db, {});
    const paths = result.orphans.map((o) => o.path);
    expect(paths).toContain("lonely.md");
  });

  it("brain_orphans does not include a note that has an outlink", () => {
    writeNote(vault.vaultDir, "hub.md", makeFrontmatter("Hub"));
    writeNote(
      vault.vaultDir,
      "connected.md",
      makeFrontmatter("Connected") + "\nSee [[hub]]."
    );
    vault.indexer.initialScan();

    const result = brainOrphans(vault.db, {});
    const paths = result.orphans.map((o) => o.path);
    expect(paths).not.toContain("connected.md");
    // hub is a target (backlink from connected), so it also has a connection
    expect(paths).not.toContain("hub.md");
  });

  it("brain_orphans no longer includes note after adding a wikilink to it", () => {
    writeNote(vault.vaultDir, "hub.md", makeFrontmatter("Hub"));
    writeNote(vault.vaultDir, "orphan.md", makeFrontmatter("Orphan"));
    vault.indexer.initialScan();

    // Confirm orphan before
    const before = brainOrphans(vault.db, {});
    expect(before.orphans.map((o) => o.path)).toContain("orphan.md");

    // Update orphan to reference hub
    writeNote(
      vault.vaultDir,
      "orphan.md",
      makeFrontmatter("Orphan") + "\nNow linked to [[hub]]."
    );
    vault.indexer.initialScan();

    const after = brainOrphans(vault.db, {});
    expect(after.orphans.map((o) => o.path)).not.toContain("orphan.md");
  });

  it("brain_orphans respects para_type filter", () => {
    mkdirSync(join(vault.vaultDir, "Projects"), { recursive: true });
    writeNote(vault.vaultDir, "Projects/proj-orphan.md", makeFrontmatter("Project Orphan"));
    writeNote(vault.vaultDir, "inbox-orphan.md", makeFrontmatter("Inbox Orphan"));
    vault.indexer.initialScan();

    const result = brainOrphans(vault.db, { para_type: "project" });
    const paths = result.orphans.map((o) => o.path);
    expect(paths).toContain("Projects/proj-orphan.md");
    expect(paths).not.toContain("inbox-orphan.md");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E 4: brain_map health score
// ─────────────────────────────────────────────────────────────

describe("E2E: brain_map health score", () => {
  let vault: TestVault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    teardownVault(vault);
  });

  it("brain_map returns a health_score between 0 and 100", () => {
    writeNote(vault.vaultDir, "a.md", makeFrontmatter("A"));
    writeNote(vault.vaultDir, "b.md", makeFrontmatter("B"));
    writeNote(vault.vaultDir, "c.md", makeFrontmatter("C") + "\n[[a]]");
    writeNote(vault.vaultDir, "d.md", makeFrontmatter("D") + "\n[[b]]");
    writeNote(vault.vaultDir, "e.md", makeFrontmatter("E"));
    vault.indexer.initialScan();

    const map = brainMap(vault.db, {});
    expect(map.health_score).toBeGreaterThanOrEqual(0);
    expect(map.health_score).toBeLessThanOrEqual(100);
  });

  it("health_score increases after orphans are connected", () => {
    // All 5 notes start as orphans
    for (let i = 1; i <= 5; i++) {
      writeNote(vault.vaultDir, `note${i}.md`, makeFrontmatter(`Note ${i}`));
    }
    vault.indexer.initialScan();
    const before = brainMap(vault.db, {});

    // Connect all notes into a chain: note1 → note2 → note3 → note4 → note5
    for (let i = 1; i <= 4; i++) {
      writeNote(
        vault.vaultDir,
        `note${i}.md`,
        makeFrontmatter(`Note ${i}`) + `\n[[note${i + 1}]]`
      );
    }
    vault.indexer.initialScan();
    const after = brainMap(vault.db, {});

    expect(after.health_score).toBeGreaterThan(before.health_score);
  });

  it("brain_map reports correct node count", () => {
    writeNote(vault.vaultDir, "x.md", makeFrontmatter("X"));
    writeNote(vault.vaultDir, "y.md", makeFrontmatter("Y"));
    writeNote(vault.vaultDir, "z.md", makeFrontmatter("Z"));
    vault.indexer.initialScan();

    const map = brainMap(vault.db, {});
    expect(map.totals.nodes).toBe(3);
  });

  it("brain_map reports correct orphan count", () => {
    writeNote(vault.vaultDir, "alone.md", makeFrontmatter("Alone"));
    writeNote(vault.vaultDir, "hub.md", makeFrontmatter("Hub"));
    writeNote(vault.vaultDir, "spoke.md", makeFrontmatter("Spoke") + "\n[[hub]]");
    vault.indexer.initialScan();

    const map = brainMap(vault.db, {});
    // 'alone' has no edges; hub and spoke are connected
    expect(map.totals.orphans).toBe(1);
  });

  it("brain_map returns a PARA breakdown", () => {
    mkdirSync(join(vault.vaultDir, "Projects"), { recursive: true });
    mkdirSync(join(vault.vaultDir, "Areas"), { recursive: true });
    writeNote(vault.vaultDir, "Projects/p1.md", makeFrontmatter("Project 1"));
    writeNote(vault.vaultDir, "Areas/a1.md", makeFrontmatter("Area 1"));
    writeNote(vault.vaultDir, "inbox.md", makeFrontmatter("Inbox"));
    vault.indexer.initialScan();

    const map = brainMap(vault.db, {});
    const types = map.para_breakdown.map((b) => b.type);
    expect(types).toContain("project");
    expect(types).toContain("area");
    expect(types).toContain("inbox");
  });
});

// ─────────────────────────────────────────────────────────────
// E2E 5: Performance — brain_search on synthetic dataset
// ─────────────────────────────────────────────────────────────

describe("Performance: brain_search on synthetic dataset", () => {
  let vault: TestVault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    teardownVault(vault);
  });

  it("brain_search on 100 notes completes in under 200ms", () => {
    // Write 100 synthetic notes
    for (let i = 0; i < 100; i++) {
      writeNote(
        vault.vaultDir,
        `note-${i}.md`,
        makeFrontmatter(`Synthetic Note ${i}`, ["test", "synthetic"]) +
          `\nThis is the body of note number ${i}. It contains synthetic content for testing purposes.`
      );
    }

    vault.indexer.initialScan();

    const start = performance.now();
    const result = brainSearch(vault.db, { query: "synthetic", limit: 10 });
    const elapsed = performance.now() - start;

    expect(result.total).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  it("brain_search with empty query returns recent notes quickly", () => {
    for (let i = 0; i < 100; i++) {
      writeNote(
        vault.vaultDir,
        `note-${i}.md`,
        makeFrontmatter(`Recent Note ${i}`)
      );
    }

    vault.indexer.initialScan();

    const start = performance.now();
    const result = brainSearch(vault.db, { query: "", limit: 10 });
    const elapsed = performance.now() - start;

    expect(result.results.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(200);
  });

  it("initialScan indexes 100 notes without error", () => {
    for (let i = 0; i < 100; i++) {
      writeNote(
        vault.vaultDir,
        `bulk-${i}.md`,
        makeFrontmatter(`Bulk Note ${i}`)
      );
    }

    const scanResult = vault.indexer.initialScan();
    expect(scanResult.indexed).toBe(100);
    expect(scanResult.skipped).toBe(0);

    const map = brainMap(vault.db, {});
    expect(map.totals.nodes).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────
// E2E 6: brain_search filters
// ─────────────────────────────────────────────────────────────

describe("E2E: brain_search filters", () => {
  let vault: TestVault;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    teardownVault(vault);
  });

  it("brain_search filters by para_type", () => {
    mkdirSync(join(vault.vaultDir, "Projects"), { recursive: true });
    writeNote(vault.vaultDir, "Projects/alpha.md", makeFrontmatter("Alpha Project"));
    writeNote(vault.vaultDir, "alpha-inbox.md", makeFrontmatter("Alpha Inbox"));
    vault.indexer.initialScan();

    const result = brainSearch(vault.db, {
      query: "alpha",
      filters: { para_type: "project" },
    });
    expect(result.total).toBe(1);
    expect(result.results[0].path).toBe("Projects/alpha.md");
  });

  it("brain_search empty query with para_type filter returns only matching type", () => {
    mkdirSync(join(vault.vaultDir, "Resources"), { recursive: true });
    writeNote(vault.vaultDir, "Resources/r1.md", makeFrontmatter("Resource 1"));
    writeNote(vault.vaultDir, "inbox1.md", makeFrontmatter("Inbox 1"));
    vault.indexer.initialScan();

    const result = brainSearch(vault.db, {
      query: "",
      filters: { para_type: "resource" },
    });
    const paths = result.results.map((r) => r.path);
    expect(paths).toContain("Resources/r1.md");
    expect(paths).not.toContain("inbox1.md");
  });
});
