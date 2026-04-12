// brain/tests/tools.test.ts
// Integration tests for all 13 brain-mcp tools.
// Uses a temp vault on disk + a temp SQLite DB — never imports db.ts.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runMigrations } from "../src/migrations.js";
import { Indexer } from "../src/indexer.js";

import { brainSearch } from "../src/tools/search.js";
import { brainGraph } from "../src/tools/graph.js";
import { brainBacklinks } from "../src/tools/backlinks.js";
import { brainOutlinks } from "../src/tools/outlinks.js";
import { brainTags } from "../src/tools/tags.js";
import { brainRecent } from "../src/tools/recent.js";
import { brainCreate } from "../src/tools/create.js";
import { brainUpdate } from "../src/tools/update.js";
import { brainOrphans } from "../src/tools/orphans.js";
import { brainClusters } from "../src/tools/clusters.js";
import { brainMap } from "../src/tools/map.js";
import { brainPath } from "../src/tools/path.js";
import { brainSuggest } from "../src/tools/suggest.js";

// ─── Vault fixtures ───────────────────────────────────────────────────────────

const ALPHA = `---
title: Project Alpha
tags: [ai, production]
status: active
---
# Project Alpha
This project uses [[beta]] and [[gamma]] for core logic.
Also related to #testing.
`;

const BETA = `---
title: Project Beta
tags: [ai, backend]
---
# Project Beta
Depends on [[alpha]]. See also [[nonexistent-page]].
`;

const GAMMA = `---
title: Gamma Resource
tags: [production]
---
# Gamma Resource
Reference material for [[alpha]].
`;

const ORPHAN_NOTE = `---
title: Orphan Note
---
# Orphan Note
This note has no links to anything.
`;

// ─── Shared suite state ───────────────────────────────────────────────────────

let tmpDir: string;
let brainRoot: string;
let db: Database;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "brain-tools-test-"));
  brainRoot = join(tmpDir, "vault");

  mkdirSync(join(brainRoot, "Projects"), { recursive: true });
  mkdirSync(join(brainRoot, "Resources"), { recursive: true });
  mkdirSync(join(brainRoot, "Areas"), { recursive: true });

  writeFileSync(join(brainRoot, "Projects/alpha.md"), ALPHA, "utf-8");
  writeFileSync(join(brainRoot, "Projects/beta.md"), BETA, "utf-8");
  writeFileSync(join(brainRoot, "Resources/gamma.md"), GAMMA, "utf-8");
  writeFileSync(join(brainRoot, "Areas/orphan.md"), ORPHAN_NOTE, "utf-8");

  const dbPath = join(tmpDir, "test.sqlite");
  db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);

  const indexer = new Indexer(db, brainRoot);
  indexer.initialScan();
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── brain_search ─────────────────────────────────────────────────────────────

describe("brain_search", () => {
  test("returns results for a matching query", () => {
    const res = brainSearch(db, { query: "Alpha" });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.query).toBe("Alpha");
    const paths = res.results.map((r) => r.path);
    expect(paths.some((p) => p.includes("alpha"))).toBe(true);
  });

  test("returns empty results for a nonexistent query term", () => {
    const res = brainSearch(db, { query: "xyzzy_does_not_exist_in_any_note" });
    expect(res.results).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  test("respects the limit parameter", () => {
    // We have 4 notes; requesting limit=2 must return at most 2
    const res = brainSearch(db, { query: "", limit: 2 });
    expect(res.results.length).toBeLessThanOrEqual(2);
  });

  test("clamps limit to 50 maximum", () => {
    // Requesting 999 should silently clamp — result count ≤ 50
    const res = brainSearch(db, { query: "", limit: 999 });
    expect(res.results.length).toBeLessThanOrEqual(50);
  });

  test("filters by para_type when provided", () => {
    const res = brainSearch(db, {
      query: "",
      filters: { para_type: "resource" },
    });
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) {
      expect(r.para_type).toBe("resource");
    }
  });

  test("empty query returns recent notes sorted by modified_at desc", () => {
    const res = brainSearch(db, { query: "" });
    expect(res.results.length).toBeGreaterThan(0);
    // Verify descending order
    for (let i = 1; i < res.results.length; i++) {
      expect(res.results[i - 1]!.modified_at >= res.results[i]!.modified_at).toBe(true);
    }
  });

  test("result objects include required fields", () => {
    const res = brainSearch(db, { query: "" });
    const r = res.results[0]!;
    expect(typeof r.path).toBe("string");
    expect(typeof r.title).toBe("string");
    expect(typeof r.para_type).toBe("string");
    expect(Array.isArray(r.tags)).toBe(true);
    expect(typeof r.word_count).toBe("number");
    expect(typeof r.modified_at).toBe("string");
  });
});

// ─── brain_graph ─────────────────────────────────────────────────────────────

describe("brain_graph", () => {
  test("returns the node with correct fields for alpha", () => {
    const res = brainGraph(db, { path: "Projects/alpha.md" });
    expect(res.node.path).toBe("Projects/alpha.md");
    expect(res.node.title).toBe("Project Alpha");
    expect(res.node.para_type).toBe("project");
    expect(Array.isArray(res.node.tags)).toBe(true);
    expect(res.node.tags).toContain("ai");
    expect(res.node.tags).toContain("production");
  });

  test("returns outlinks from alpha (links to beta and gamma)", () => {
    const res = brainGraph(db, { path: "Projects/alpha.md" });
    const outPaths = res.outlinks.map((o) => o.path);
    expect(outPaths.some((p) => p.includes("beta"))).toBe(true);
    expect(outPaths.some((p) => p.includes("gamma"))).toBe(true);
  });

  test("returns backlinks for gamma (alpha links to gamma)", () => {
    const res = brainGraph(db, { path: "Resources/gamma.md" });
    const backPaths = res.backlinks.map((b) => b.path);
    expect(backPaths.some((p) => p.includes("alpha"))).toBe(true);
  });

  test("returns dangling links for beta (links nonexistent-page)", () => {
    const res = brainGraph(db, { path: "Projects/beta.md" });
    expect(res.dangling.length).toBeGreaterThan(0);
    const targets = res.dangling.map((d) => d.target_text);
    expect(targets).toContain("nonexistent-page");
  });

  test("throws when node path does not exist in DB", () => {
    expect(() => brainGraph(db, { path: "Projects/does-not-exist.md" })).toThrow(
      "Node not found"
    );
  });

  test("outlinks have required edge fields", () => {
    const res = brainGraph(db, { path: "Projects/alpha.md" });
    if (res.outlinks.length > 0) {
      const o = res.outlinks[0]!;
      expect(typeof o.path).toBe("string");
      expect(typeof o.title).toBe("string");
      expect(o.edge_type).toBe("wikilink");
      expect(typeof o.weight).toBe("number");
    }
  });
});

// ─── brain_backlinks ─────────────────────────────────────────────────────────

describe("brain_backlinks", () => {
  test("returns backlinks for beta — alpha links to beta", () => {
    const res = brainBacklinks(db, { path: "Projects/beta.md" });
    expect(res.path).toBe("Projects/beta.md");
    expect(res.total).toBeGreaterThan(0);
    const paths = res.backlinks.map((b) => b.path);
    expect(paths.some((p) => p.includes("alpha"))).toBe(true);
  });

  test("returns empty backlinks for orphan (nothing links to it)", () => {
    const res = brainBacklinks(db, { path: "Areas/orphan.md" });
    expect(res.backlinks).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  test("backlink results include tags as parsed array", () => {
    const res = brainBacklinks(db, { path: "Projects/beta.md" });
    for (const b of res.backlinks) {
      expect(Array.isArray(b.tags)).toBe(true);
    }
  });

  test("throws when path not found", () => {
    expect(() => brainBacklinks(db, { path: "nope.md" })).toThrow("Node not found");
  });
});

// ─── brain_outlinks ──────────────────────────────────────────────────────────

describe("brain_outlinks", () => {
  test("returns resolved outlinks for alpha (beta and gamma)", () => {
    const res = brainOutlinks(db, { path: "Projects/alpha.md" });
    expect(res.path).toBe("Projects/alpha.md");
    expect(res.total).toBeGreaterThanOrEqual(2);
    const paths = res.outlinks.map((o) => o.path);
    expect(paths.some((p) => p.includes("beta"))).toBe(true);
    expect(paths.some((p) => p.includes("gamma"))).toBe(true);
  });

  test("includes dangling links for beta (nonexistent-page)", () => {
    const res = brainOutlinks(db, { path: "Projects/beta.md" });
    expect(res.dangling.length).toBeGreaterThan(0);
    const targets = res.dangling.map((d) => d.target_text);
    expect(targets).toContain("nonexistent-page");
  });

  test("orphan has zero outlinks and zero dangling", () => {
    const res = brainOutlinks(db, { path: "Areas/orphan.md" });
    expect(res.outlinks).toHaveLength(0);
    expect(res.dangling).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  test("outlink results include tags as parsed array", () => {
    const res = brainOutlinks(db, { path: "Projects/alpha.md" });
    for (const o of res.outlinks) {
      expect(Array.isArray(o.tags)).toBe(true);
    }
  });

  test("throws when path not found", () => {
    expect(() => brainOutlinks(db, { path: "nope.md" })).toThrow("Node not found");
  });
});

// ─── brain_tags ──────────────────────────────────────────────────────────────

describe("brain_tags", () => {
  test("no tag param returns full tag index with counts", () => {
    const res = brainTags(db, {});
    expect(res.mode).toBe("index");
    if (res.mode === "index") {
      expect(res.tags.length).toBeGreaterThan(0);
      expect(typeof res.total_unique).toBe("number");
      // ai tag should exist and have count >= 2 (alpha + beta both tagged ai)
      const aiEntry = res.tags.find((t) => t.tag === "ai");
      expect(aiEntry).toBeDefined();
      expect(aiEntry!.count).toBeGreaterThanOrEqual(2);
    }
  });

  test("tag='ai' returns alpha and beta", () => {
    const res = brainTags(db, { tag: "ai" });
    expect(res.mode).toBe("filter");
    if (res.mode === "filter") {
      expect(res.tag).toBe("ai");
      expect(res.total).toBeGreaterThanOrEqual(2);
      const paths = res.notes.map((n) => n.path);
      expect(paths.some((p) => p.includes("alpha"))).toBe(true);
      expect(paths.some((p) => p.includes("beta"))).toBe(true);
    }
  });

  test("tag='production' returns alpha and gamma", () => {
    const res = brainTags(db, { tag: "production" });
    expect(res.mode).toBe("filter");
    if (res.mode === "filter") {
      expect(res.total).toBeGreaterThanOrEqual(2);
      const paths = res.notes.map((n) => n.path);
      expect(paths.some((p) => p.includes("alpha"))).toBe(true);
      expect(paths.some((p) => p.includes("gamma"))).toBe(true);
    }
  });

  test("tag='nonexistent-tag' returns zero notes", () => {
    const res = brainTags(db, { tag: "nonexistent-tag-xyz" });
    expect(res.mode).toBe("filter");
    if (res.mode === "filter") {
      expect(res.total).toBe(0);
      expect(res.notes).toHaveLength(0);
    }
  });

  test("index tags are sorted by count desc", () => {
    const res = brainTags(db, {});
    if (res.mode === "index" && res.tags.length > 1) {
      for (let i = 1; i < res.tags.length; i++) {
        expect(res.tags[i - 1]!.count >= res.tags[i]!.count).toBe(true);
      }
    }
  });

  test("filter response notes have tags parsed as array", () => {
    const res = brainTags(db, { tag: "ai" });
    if (res.mode === "filter") {
      for (const note of res.notes) {
        expect(Array.isArray(note.tags)).toBe(true);
        expect(note.tags).toContain("ai");
      }
    }
  });
});

// ─── brain_recent ────────────────────────────────────────────────────────────

describe("brain_recent", () => {
  test("returns notes sorted by modified_at desc", () => {
    const res = brainRecent(db, {});
    expect(res.notes.length).toBeGreaterThan(0);
    for (let i = 1; i < res.notes.length; i++) {
      expect(res.notes[i - 1]!.modified_at >= res.notes[i]!.modified_at).toBe(true);
    }
  });

  test("respects limit parameter", () => {
    const res = brainRecent(db, { limit: 2 });
    expect(res.notes.length).toBeLessThanOrEqual(2);
  });

  test("clamps limit to 100 maximum", () => {
    const res = brainRecent(db, { limit: 500 });
    expect(res.notes.length).toBeLessThanOrEqual(100);
  });

  test("filters by para_type", () => {
    const res = brainRecent(db, { para_type: "project" });
    expect(res.notes.length).toBeGreaterThan(0);
    for (const n of res.notes) {
      expect(n.para_type).toBe("project");
    }
  });

  test("days=null is reflected in response", () => {
    const res = brainRecent(db, {});
    expect(res.days).toBeNull();
  });

  test("days param is echoed in response", () => {
    const res = brainRecent(db, { days: 365 });
    expect(res.days).toBe(365);
  });

  test("notes have tags parsed as array", () => {
    const res = brainRecent(db, {});
    for (const n of res.notes) {
      expect(Array.isArray(n.tags)).toBe(true);
    }
  });
});

// ─── brain_create ────────────────────────────────────────────────────────────

describe("brain_create", () => {
  test("creates a new file on disk and indexes it", () => {
    const res = brainCreate(
      db,
      {
        path: "Projects/new-note.md",
        title: "New Note",
        tags: ["test-create"],
        status: "draft",
      },
      brainRoot
    );

    expect(res.created).toBe(true);
    expect(res.title).toBe("New Note");
    expect(res.path).toBe("Projects/new-note.md");

    // File must exist on disk
    expect(existsSync(join(brainRoot, "Projects/new-note.md"))).toBe(true);

    // Node must be in DB
    const node = db
      .query<{ id: number; title: string }, [string]>(
        "SELECT id, title FROM nodes WHERE path = ?"
      )
      .get("Projects/new-note.md");
    expect(node).not.toBeNull();
    expect(node!.title).toBe("New Note");
  });

  test("returns a node_id that is a positive integer", () => {
    brainCreate(
      db,
      { path: "Projects/id-test.md", title: "ID Test" },
      brainRoot
    );

    const node = db
      .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE path = ?")
      .get("Projects/id-test.md");
    expect(node).not.toBeNull();
    expect(node!.id).toBeGreaterThan(0);
  });

  test("appends .md extension when path has none", () => {
    const res = brainCreate(
      db,
      { path: "Projects/no-ext", title: "No Extension" },
      brainRoot
    );

    expect(res.path.endsWith(".md")).toBe(true);
    expect(existsSync(join(brainRoot, "Projects/no-ext.md"))).toBe(true);
  });

  test("throws when file already exists", () => {
    // alpha.md was created in beforeAll
    expect(() =>
      brainCreate(
        db,
        { path: "Projects/alpha.md", title: "Duplicate" },
        brainRoot
      )
    ).toThrow("already exists");
  });

  test("rejects path traversal attempts", () => {
    expect(() =>
      brainCreate(
        db,
        { path: "../../etc/passwd", title: "Traversal" },
        brainRoot
      )
    ).toThrow("Path traversal");
  });

  test("creates nested directories automatically", () => {
    brainCreate(
      db,
      { path: "Projects/deep/nested/note.md", title: "Deep Note" },
      brainRoot
    );
    expect(existsSync(join(brainRoot, "Projects/deep/nested/note.md"))).toBe(true);
  });

  test("generated frontmatter includes title and tags", () => {
    brainCreate(
      db,
      {
        path: "Projects/fm-check.md",
        title: "FM Check",
        tags: ["tag-a", "tag-b"],
        status: "active",
      },
      brainRoot
    );

    const raw = readFileSync(join(brainRoot, "Projects/fm-check.md"), "utf-8");
    expect(raw).toContain("FM Check");
    expect(raw).toContain("tag-a");
    expect(raw).toContain("tag-b");
    expect(raw).toContain("active");
  });
});

// ─── brain_update ────────────────────────────────────────────────────────────

describe("brain_update", () => {
  // Create a dedicated note for update tests so mutations don't leak
  const UPDATE_PATH = "Projects/update-target.md";
  const UPDATE_CONTENT = `---
title: Update Target
tags: [original-tag]
status: draft
---
# Update Target
Original body content.
`;

  beforeAll(() => {
    writeFileSync(join(brainRoot, UPDATE_PATH), UPDATE_CONTENT, "utf-8");
    const indexer = new Indexer(db, brainRoot);
    indexer.indexFile(join(brainRoot, UPDATE_PATH));
  });

  test("updates status frontmatter field and re-indexes", () => {
    const res = brainUpdate(
      db,
      { path: UPDATE_PATH, status: "active" },
      brainRoot
    );

    expect(res.updated).toBe(true);
    expect(res.path).toBe(UPDATE_PATH);

    // The DB node should reflect the new status
    const node = db
      .query<{ status: string | null }, [string]>(
        "SELECT status FROM nodes WHERE path = ?"
      )
      .get(UPDATE_PATH);
    expect(node?.status).toBe("active");
  });

  test("appending text grows the body", () => {
    const before = readFileSync(join(brainRoot, UPDATE_PATH), "utf-8");

    brainUpdate(
      db,
      { path: UPDATE_PATH, append: "## Appended Section\nNew content." },
      brainRoot
    );

    const after = readFileSync(join(brainRoot, UPDATE_PATH), "utf-8");
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("Appended Section");
  });

  test("replacing tags updates frontmatter and re-indexes", () => {
    brainUpdate(
      db,
      { path: UPDATE_PATH, tags: ["new-tag-a", "new-tag-b"] },
      brainRoot
    );

    const node = db
      .query<{ tags: string }, [string]>("SELECT tags FROM nodes WHERE path = ?")
      .get(UPDATE_PATH);

    const tags: string[] = JSON.parse(node!.tags);
    expect(tags).toContain("new-tag-a");
    expect(tags).toContain("new-tag-b");
    expect(tags).not.toContain("original-tag");
  });

  test("throws on path traversal", () => {
    expect(() =>
      brainUpdate(db, { path: "../../etc/passwd", status: "evil" }, brainRoot)
    ).toThrow("Path traversal");
  });
});

// ─── brain_orphans ───────────────────────────────────────────────────────────

describe("brain_orphans", () => {
  test("returns the orphan note (Areas/orphan.md)", () => {
    const res = brainOrphans(db, {});
    expect(res.total).toBeGreaterThan(0);
    const paths = res.orphans.map((o) => o.path);
    expect(paths.some((p) => p.includes("orphan"))).toBe(true);
  });

  test("does not include connected notes like alpha", () => {
    const res = brainOrphans(db, {});
    const paths = res.orphans.map((o) => o.path);
    // alpha has outlinks and is a backlink target — should never be an orphan
    expect(paths.some((p) => p.includes("alpha"))).toBe(false);
  });

  test("filters by para_type", () => {
    const res = brainOrphans(db, { para_type: "area" });
    for (const o of res.orphans) {
      expect(o.para_type).toBe("area");
    }
  });

  test("respects limit", () => {
    const res = brainOrphans(db, { limit: 1 });
    expect(res.orphans.length).toBeLessThanOrEqual(1);
  });

  test("orphan results have tags parsed as array", () => {
    const res = brainOrphans(db, {});
    for (const o of res.orphans) {
      expect(Array.isArray(o.tags)).toBe(true);
    }
  });
});

// ─── brain_clusters ──────────────────────────────────────────────────────────

describe("brain_clusters", () => {
  test("returns at least one cluster containing connected notes", () => {
    // alpha, beta, gamma form a connected component via wikilinks + tag_co
    const res = brainClusters(db, {});
    expect(res.clusters.length).toBeGreaterThanOrEqual(1);

    // The main cluster should have size >= 2
    const largest = res.clusters[0]!;
    expect(largest.size).toBeGreaterThanOrEqual(2);
  });

  test("orphan note is counted as a singleton", () => {
    const res = brainClusters(db, {});
    // orphan has no edges so it should be in singleton_count
    expect(res.singleton_count).toBeGreaterThanOrEqual(1);
  });

  test("total_nodes_clustered matches sum of cluster sizes", () => {
    const res = brainClusters(db, {});
    const summed = res.clusters.reduce((acc, c) => acc + c.size, 0);
    expect(summed).toBe(res.total_nodes_clustered);
  });

  test("cluster members have path, title, para_type fields", () => {
    const res = brainClusters(db, {});
    if (res.clusters.length > 0) {
      for (const m of res.clusters[0]!.members) {
        expect(typeof m.path).toBe("string");
        expect(typeof m.title).toBe("string");
        expect(typeof m.para_type).toBe("string");
      }
    }
  });

  test("min_size=10 returns no clusters for a small vault", () => {
    // Our test vault has at most 4 notes — a min_size of 10 returns nothing
    const res = brainClusters(db, { min_size: 10 });
    expect(res.clusters).toHaveLength(0);
    expect(res.total_clusters).toBe(0);
  });
});

// ─── brain_map ───────────────────────────────────────────────────────────────

describe("brain_map", () => {
  test("total_nodes is 4 (the 4 fixture notes + any created in earlier tests)", () => {
    const res = brainMap(db, {});
    // We have at least 4 fixture notes; create tests may have added more
    expect(res.totals.nodes).toBeGreaterThanOrEqual(4);
  });

  test("para_breakdown includes project, resource, and area entries", () => {
    const res = brainMap(db, {});
    const types = res.para_breakdown.map((p) => p.type);
    expect(types).toContain("project");
    expect(types).toContain("resource");
    expect(types).toContain("area");
  });

  test("health_score is a number between 0 and 100 inclusive", () => {
    const res = brainMap(db, {});
    expect(typeof res.health_score).toBe("number");
    expect(res.health_score).toBeGreaterThanOrEqual(0);
    expect(res.health_score).toBeLessThanOrEqual(100);
  });

  test("totals.edges is greater than zero", () => {
    const res = brainMap(db, {});
    expect(res.totals.edges).toBeGreaterThan(0);
  });

  test("totals.dangling_links is greater than zero (beta links nonexistent-page)", () => {
    const res = brainMap(db, {});
    expect(res.totals.dangling_links).toBeGreaterThan(0);
  });

  test("totals.orphans is at least 1", () => {
    const res = brainMap(db, {});
    expect(res.totals.orphans).toBeGreaterThanOrEqual(1);
  });

  test("last_full_scan is a non-empty string after initialScan", () => {
    const res = brainMap(db, {});
    expect(typeof res.last_full_scan).toBe("string");
    expect(res.last_full_scan.length).toBeGreaterThan(0);
  });

  test("top_tags contains 'ai' tag", () => {
    const res = brainMap(db, {});
    const tagNames = res.top_tags.map((t) => t.tag);
    expect(tagNames).toContain("ai");
  });
});

// ─── brain_path ──────────────────────────────────────────────────────────────

describe("brain_path", () => {
  test("finds direct path from alpha to gamma (alpha → gamma via wikilink)", () => {
    const res = brainPath(db, {
      source: "Projects/alpha.md",
      target: "Resources/gamma.md",
    });
    expect(res.found).toBe(true);
    if (res.found) {
      expect(res.length).toBeGreaterThan(0);
      const pathPaths = res.path.map((s) => s.path);
      expect(pathPaths[0]).toBe("Projects/alpha.md");
      expect(pathPaths[pathPaths.length - 1]).toBe("Resources/gamma.md");
    }
  });

  test("finds path from gamma to alpha (reverse direction — BFS is undirected)", () => {
    const res = brainPath(db, {
      source: "Resources/gamma.md",
      target: "Projects/alpha.md",
    });
    expect(res.found).toBe(true);
  });

  test("returns found:false when orphan has no path to alpha", () => {
    const res = brainPath(db, {
      source: "Areas/orphan.md",
      target: "Projects/alpha.md",
    });
    // Orphan has no edges — cannot reach alpha
    expect(res.found).toBe(false);
    if (!res.found) {
      expect(res.source).toBe("Areas/orphan.md");
      expect(res.target).toBe("Projects/alpha.md");
      expect(typeof res.max_depth).toBe("number");
    }
  });

  test("self-path returns found:true with length 0", () => {
    const res = brainPath(db, {
      source: "Projects/alpha.md",
      target: "Projects/alpha.md",
    });
    expect(res.found).toBe(true);
    if (res.found) {
      expect(res.length).toBe(0);
      expect(res.path).toHaveLength(1);
    }
  });

  test("throws when source node does not exist", () => {
    expect(() =>
      brainPath(db, { source: "nope.md", target: "Projects/alpha.md" })
    ).toThrow("Source node not found");
  });

  test("throws when target node does not exist", () => {
    expect(() =>
      brainPath(db, { source: "Projects/alpha.md", target: "nope.md" })
    ).toThrow("Target node not found");
  });
});

// ─── brain_suggest ───────────────────────────────────────────────────────────

describe("brain_suggest", () => {
  test("suggests gamma for alpha (shared 'production' tag)", () => {
    const res = brainSuggest(db, { path: "Projects/alpha.md" });
    expect(res.path).toBe("Projects/alpha.md");
    expect(res.suggestions.length).toBeGreaterThan(0);
    const paths = res.suggestions.map((s) => s.path);
    // gamma shares the 'production' tag with alpha
    expect(paths.some((p) => p.includes("gamma"))).toBe(true);
  });

  test("suggestion scores are between 0 and 1 exclusive", () => {
    const res = brainSuggest(db, { path: "Projects/alpha.md" });
    for (const s of res.suggestions) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  test("suggestions are sorted by score descending", () => {
    const res = brainSuggest(db, { path: "Projects/alpha.md" });
    for (let i = 1; i < res.suggestions.length; i++) {
      expect(res.suggestions[i - 1]!.score >= res.suggestions[i]!.score).toBe(true);
    }
  });

  test("reasons object has correct shape", () => {
    const res = brainSuggest(db, { path: "Projects/alpha.md" });
    for (const s of res.suggestions) {
      expect(typeof s.reasons.shared_tags).toBe("number");
      expect(typeof s.reasons.shared_outlinks).toBe("number");
      expect(typeof s.reasons.shared_backlinks).toBe("number");
    }
  });

  test("returns empty suggestions for orphan (no shared anything)", () => {
    const res = brainSuggest(db, { path: "Areas/orphan.md" });
    expect(res.suggestions).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  test("respects limit parameter", () => {
    const res = brainSuggest(db, { path: "Projects/alpha.md", limit: 1 });
    expect(res.suggestions.length).toBeLessThanOrEqual(1);
  });

  test("does not include the source note in suggestions", () => {
    const res = brainSuggest(db, { path: "Projects/alpha.md" });
    const paths = res.suggestions.map((s) => s.path);
    expect(paths).not.toContain("Projects/alpha.md");
  });

  test("throws when path not found", () => {
    expect(() => brainSuggest(db, { path: "nope.md" })).toThrow("Node not found");
  });
});
