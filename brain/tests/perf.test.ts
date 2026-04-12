// brain-mcp Phase 5 — Performance tests: 1000-note vault

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runMigrations } from "../src/migrations.js";
import { Indexer } from "../src/indexer.js";
import { brainSearch } from "../src/tools/search.js";
import { brainMap } from "../src/tools/map.js";
import { brainClusters } from "../src/tools/clusters.js";

// ─── Synthetic vault generator ────────────────────────────────────────────────

function generateNotes(dir: string, count: number): void {
  const paraTypes = ["Projects", "Areas", "Resources", "Archive"];
  const tagPool = [
    "ai",
    "web",
    "api",
    "testing",
    "design",
    "security",
    "deploy",
    "perf",
    "ux",
    "data",
  ];

  for (const p of paraTypes) mkdirSync(join(dir, p), { recursive: true });

  for (let i = 0; i < count; i++) {
    const para = paraTypes[i % paraTypes.length];
    const tags = [tagPool[i % tagPool.length], tagPool[(i + 3) % tagPool.length]];
    // Chain: each note links to the previous one to build a connected graph
    const links = i > 0 ? `[[note-${i - 1}]]` : "";

    const content = `---
title: Note ${i}
tags: [${tags.join(", ")}]
status: active
created: 2026-01-01
---
# Note ${i}

This is synthetic note number ${i}. ${links}
Content about ${tags.join(" and ")} topics.
Performance testing the Kronus knowledge graph with ${i + 1} total entries.
`;
    writeFileSync(join(dir, para, `note-${i}.md`), content);
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Performance: 1000 notes", () => {
  let db: Database;
  let tmpDir: string;
  let vaultDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "brain-perf-"));
    vaultDir = join(tmpDir, "vault");
    mkdirSync(vaultDir);

    generateNotes(vaultDir, 1000);

    db = new Database(join(tmpDir, "perf.sqlite"));
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initialScan indexes 1000 notes in < 10 seconds", () => {
    const indexer = new Indexer(db, vaultDir);
    const start = Date.now();
    const result = indexer.initialScan();
    const elapsed = Date.now() - start;

    console.error(`[perf] initialScan: ${result.indexed} notes in ${elapsed}ms`);
    expect(result.indexed).toBe(1000);
    expect(elapsed).toBeLessThan(10000);
  });

  it("brain_search p95 < 100ms", () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      brainSearch(db, { query: "ai testing" });
      times.push(Date.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.error(`[perf] brain_search p95: ${p95}ms (samples: ${JSON.stringify(times)})`);
    expect(p95).toBeLessThan(100);
  });

  it("brain_search with filters p95 < 100ms", () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      brainSearch(db, {
        query: "performance testing",
        filters: { para_type: "project", tags: ["ai"] },
      });
      times.push(Date.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.error(`[perf] brain_search+filters p95: ${p95}ms`);
    expect(p95).toBeLessThan(100);
  });

  it("brain_clusters on 1000 nodes < 2 seconds", () => {
    const start = Date.now();
    const result = brainClusters(db, {});
    const elapsed = Date.now() - start;

    console.error(
      `[perf] brain_clusters: ${elapsed}ms — ${result.total_clusters} clusters, ${result.singleton_count} singletons`
    );
    expect(elapsed).toBeLessThan(2000);
    // 999 notes each link to previous → expect one large cluster
    expect(result.total_clusters).toBeGreaterThanOrEqual(1);
  });

  it("brain_map p95 < 500ms", () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      brainMap(db, {});
      times.push(Date.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.error(`[perf] brain_map p95: ${p95}ms (samples: ${JSON.stringify(times)})`);
    expect(p95).toBeLessThan(500);
  });

  it("brain_map returns correct totals", () => {
    const result = brainMap(db, {});
    // 1000 notes indexed
    expect(result.totals.nodes).toBe(1000);
    // 999 wikilink edges (each note links to previous)
    expect(result.totals.edges).toBeGreaterThanOrEqual(999);
    // Health score is a number 0-100
    expect(result.health_score).toBeGreaterThanOrEqual(0);
    expect(result.health_score).toBeLessThanOrEqual(100);
  });

  it("brain_search normalizeQuery handles special chars without crashing", () => {
    const nastyInputs = [
      "(AI AND systems)",
      "foo*bar",
      "test:value",
      "((nested))",
      "^anchor",
      "tilde~",
      "",
      "   ",
      '"quoted phrase"',
    ];

    for (const input of nastyInputs) {
      expect(() => brainSearch(db, { query: input })).not.toThrow();
    }
  });
});
