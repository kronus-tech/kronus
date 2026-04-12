/**
 * brain/tests/db.test.ts
 *
 * Tests for the SQLite schema applied by runMigrations().
 *
 * Strategy: create a fresh Database in a temp directory for each test group,
 * run runMigrations(), then assert on the resulting schema.
 * db.ts is intentionally NOT imported — it opens the real ~/.kronus/brain.sqlite
 * on module load and we don't want side-effects in tests.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runMigrations } from "../src/migrations.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

interface PragmaTableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface PragmaJournalModeRow {
  journal_mode: string;
}

interface PragmaForeignKeysRow {
  foreign_keys: number;
}

interface MetadataRow {
  key: string;
  value: string;
}

interface SqliteMasterRow {
  type: string;
  name: string;
  tbl_name: string;
  rootpage: number;
  sql: string | null;
}

/** Open a fresh in-file DB in a temp dir, configure pragmas, run migrations. */
function createTestDb(dir: string): Database {
  const db = new Database(join(dir, "test.sqlite"));
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

/** Return the list of column names for a given table. */
function columnNames(db: Database, table: string): string[] {
  // PRAGMA doesn't support parameterized queries — table name is trusted (hardcoded in tests)
  const rows = db
    .query<PragmaTableInfoRow, []>(`PRAGMA table_info(${table})`)
    .all();
  return rows.map((r) => r.name);
}

/** Return true when a table / virtual-table / view with that name exists. */
function tableExists(db: Database, name: string): boolean {
  const row = db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ?"
    )
    .get(name);
  return (row?.count ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────
// Suite-level temp directory — one directory shared by the
// tests that inspect a fully-migrated DB.
// ─────────────────────────────────────────────────────────────

let tmpDir: string;
let db: Database;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kronus-brain-test-"));
  db = createTestDb(tmpDir);
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// 1. Tables exist
// ─────────────────────────────────────────────────────────────

describe("schema — tables exist after migrations", () => {
  test("nodes table exists", () => {
    expect(tableExists(db, "nodes")).toBe(true);
  });

  test("edges table exists", () => {
    expect(tableExists(db, "edges")).toBe(true);
  });

  test("metadata table exists", () => {
    expect(tableExists(db, "metadata")).toBe(true);
  });

  test("dangling_links table exists", () => {
    expect(tableExists(db, "dangling_links")).toBe(true);
  });

  test("nodes_fts virtual table exists", () => {
    expect(tableExists(db, "nodes_fts")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. nodes table — 16 columns
// ─────────────────────────────────────────────────────────────

describe("schema — nodes table columns", () => {
  test("nodes table has exactly 17 columns", () => {
    const rows = db
      .query<PragmaTableInfoRow, []>("PRAGMA table_info(nodes)")
      .all();
    expect(rows.length).toBe(17);
  });

  const expectedColumns = [
    "id",
    "path",
    "title",
    "para_type",
    "tags",
    "aliases",
    "status",
    "frontmatter",
    "content",
    "content_hash",
    "word_count",
    "heading_tree",
    "embedding",
    "created_at",
    "modified_at",
    "indexed_at",
    "source_root",
  ];

  for (const col of expectedColumns) {
    test(`nodes table has column: ${col}`, () => {
      expect(columnNames(db, "nodes")).toContain(col);
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. edges table columns
// ─────────────────────────────────────────────────────────────

describe("schema — edges table columns", () => {
  const expectedColumns = [
    "id",
    "source_id",
    "target_id",
    "edge_type",
    "weight",
    "context",
    "created_at",
  ];

  test("edges table has exactly 7 columns", () => {
    const rows = db
      .query<PragmaTableInfoRow, []>("PRAGMA table_info(edges)")
      .all();
    expect(rows.length).toBe(7);
  });

  for (const col of expectedColumns) {
    test(`edges table has column: ${col}`, () => {
      expect(columnNames(db, "edges")).toContain(col);
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. metadata seeds
// ─────────────────────────────────────────────────────────────

describe("schema — metadata seeds", () => {
  test("schema_version is '2' after all migrations", () => {
    const row = db
      .query<MetadataRow, [string]>(
        "SELECT value FROM metadata WHERE key = ?"
      )
      .get("schema_version");
    expect(row).not.toBeNull();
    expect(row?.value).toBe("2");
  });

  test("last_full_scan seed row exists", () => {
    const row = db
      .query<MetadataRow, [string]>(
        "SELECT value FROM metadata WHERE key = ?"
      )
      .get("last_full_scan");
    expect(row).not.toBeNull();
  });

  test("total_nodes seed row exists with value '0'", () => {
    const row = db
      .query<MetadataRow, [string]>(
        "SELECT value FROM metadata WHERE key = ?"
      )
      .get("total_nodes");
    expect(row?.value).toBe("0");
  });

  test("total_edges seed row exists with value '0'", () => {
    const row = db
      .query<MetadataRow, [string]>(
        "SELECT value FROM metadata WHERE key = ?"
      )
      .get("total_edges");
    expect(row?.value).toBe("0");
  });
});

// ─────────────────────────────────────────────────────────────
// 5. PRAGMA settings
// ─────────────────────────────────────────────────────────────

describe("pragma — WAL mode", () => {
  test("journal_mode is wal", () => {
    const row = db
      .query<PragmaJournalModeRow, []>("PRAGMA journal_mode")
      .get();
    expect(row?.journal_mode).toBe("wal");
  });
});

describe("pragma — foreign keys", () => {
  test("foreign_keys is ON (1)", () => {
    const row = db
      .query<PragmaForeignKeysRow, []>("PRAGMA foreign_keys")
      .get();
    expect(row?.foreign_keys).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. FTS5 virtual table
// ─────────────────────────────────────────────────────────────

describe("schema — FTS5 virtual table", () => {
  test("nodes_fts is a virtual table (fts5)", () => {
    const row = db
      .query<SqliteMasterRow, [string]>(
        "SELECT * FROM sqlite_master WHERE name = ?"
      )
      .get("nodes_fts");
    expect(row).not.toBeNull();
    expect(row?.type).toBe("table");
    // The SQL definition should contain 'fts5'
    expect(row?.sql?.toLowerCase()).toContain("fts5");
  });

  test("nodes_fts can be queried without error", () => {
    // An empty FTS table should return zero rows but not throw
    const rows = db
      .query<{ rowid: number }, []>("SELECT rowid FROM nodes_fts LIMIT 1")
      .all();
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. dangling_links table
// ─────────────────────────────────────────────────────────────

describe("schema — dangling_links table", () => {
  const expectedColumns = ["source_id", "target_text", "context"];

  for (const col of expectedColumns) {
    test(`dangling_links table has column: ${col}`, () => {
      expect(columnNames(db, "dangling_links")).toContain(col);
    });
  }

  test("dangling_links has exactly 3 columns", () => {
    const rows = db
      .query<PragmaTableInfoRow, []>("PRAGMA table_info(dangling_links)")
      .all();
    expect(rows.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────
// 8. Idempotency — running migrations twice produces same state
// ─────────────────────────────────────────────────────────────

describe("runMigrations — idempotency", () => {
  let idempotentDir: string;
  let idempotentDb: Database;

  beforeEach(() => {
    idempotentDir = mkdtempSync(join(tmpdir(), "kronus-idempotent-"));
    idempotentDb = new Database(join(idempotentDir, "idempotent.sqlite"));
    idempotentDb.run("PRAGMA journal_mode=WAL");
    idempotentDb.run("PRAGMA foreign_keys=ON");
  });

  afterEach(() => {
    idempotentDb.close();
    rmSync(idempotentDir, { recursive: true, force: true });
  });

  test("calling runMigrations twice does not throw", () => {
    expect(() => {
      runMigrations(idempotentDb);
      runMigrations(idempotentDb);
    }).not.toThrow();
  });

  test("schema_version is still '2' after second runMigrations call", () => {
    runMigrations(idempotentDb);
    runMigrations(idempotentDb);

    const row = idempotentDb
      .query<MetadataRow, [string]>(
        "SELECT value FROM metadata WHERE key = ?"
      )
      .get("schema_version");
    expect(row?.value).toBe("2");
  });

  test("nodes table column count is still 17 after second run", () => {
    runMigrations(idempotentDb);
    runMigrations(idempotentDb);

    const rows = idempotentDb
      .query<PragmaTableInfoRow, []>("PRAGMA table_info(nodes)")
      .all();
    expect(rows.length).toBe(17);
  });

  test("total_nodes seed value is not duplicated after second run", () => {
    runMigrations(idempotentDb);
    runMigrations(idempotentDb);

    // There must be exactly one row for each key (PRIMARY KEY enforcement)
    const rows = idempotentDb
      .query<MetadataRow, []>(
        "SELECT key, value FROM metadata WHERE key = 'total_nodes'"
      )
      .all();
    expect(rows.length).toBe(1);
  });

  test("edges table still has 7 columns after second run", () => {
    runMigrations(idempotentDb);
    runMigrations(idempotentDb);

    const rows = idempotentDb
      .query<PragmaTableInfoRow, []>("PRAGMA table_info(edges)")
      .all();
    expect(rows.length).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. Basic data integrity — inserts and foreign-key enforcement
// ─────────────────────────────────────────────────────────────

describe("schema — basic data integrity", () => {
  let integrityDir: string;
  let integrityDb: Database;

  beforeEach(() => {
    integrityDir = mkdtempSync(join(tmpdir(), "kronus-integrity-"));
    integrityDb = new Database(join(integrityDir, "integrity.sqlite"));
    integrityDb.run("PRAGMA journal_mode=WAL");
    integrityDb.run("PRAGMA foreign_keys=ON");
    runMigrations(integrityDb);
  });

  afterEach(() => {
    integrityDb.close();
    rmSync(integrityDir, { recursive: true, force: true });
  });

  test("can insert a valid node row", () => {
    expect(() => {
      integrityDb.run(
        `INSERT INTO nodes
           (path, title, para_type, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "Projects/test.md",
          "Test Node",
          "project",
          "2024-01-01T00:00:00Z",
          "2024-01-01T00:00:00Z",
        ]
      );
    }).not.toThrow();
  });

  test("para_type CHECK constraint rejects invalid value", () => {
    expect(() => {
      integrityDb.run(
        `INSERT INTO nodes
           (path, title, para_type, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "Projects/bad.md",
          "Bad Node",
          "invalid_type",
          "2024-01-01T00:00:00Z",
          "2024-01-01T00:00:00Z",
        ]
      );
    }).toThrow();
  });

  test("edge_type CHECK constraint rejects invalid value", () => {
    // Insert a node first so we have a valid source_id / target_id
    integrityDb.run(
      `INSERT INTO nodes (path, title, para_type, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        "Projects/edge-test.md",
        "Edge Test",
        "area",
        "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z",
      ]
    );
    const nodeId = integrityDb
      .query<{ id: number }, []>("SELECT last_insert_rowid() AS id")
      .get()?.id;

    expect(() => {
      integrityDb.run(
        `INSERT INTO edges (source_id, target_id, edge_type)
         VALUES (?, ?, ?)`,
        [nodeId, nodeId, "not_a_real_type"]
      );
    }).toThrow();
  });

  test("foreign key violation on edges is rejected when FK enforcement is ON", () => {
    expect(() => {
      integrityDb.run(
        `INSERT INTO edges (source_id, target_id, edge_type)
         VALUES (?, ?, ?)`,
        [99999, 99999, "wikilink"]
      );
    }).toThrow();
  });

  test("dangling_links foreign key is enforced", () => {
    expect(() => {
      integrityDb.run(
        `INSERT INTO dangling_links (source_id, target_text)
         VALUES (?, ?)`,
        [99999, "[[nonexistent]]"]
      );
    }).toThrow();
  });

  test("FTS is populated automatically via trigger on node insert", () => {
    integrityDb.run(
      `INSERT INTO nodes (path, title, para_type, content, tags, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "Areas/fts-test.md",
        "FTS Trigger Test",
        "area",
        "Some searchable content",
        '["fts","test"]',
        "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z",
      ]
    );

    const row = integrityDb
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH ?"
      )
      .get("FTS");
    expect(row).not.toBeNull();
  });
});
