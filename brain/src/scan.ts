// brain-mcp Phase 1 — Full initial scan CLI

import { getDb, closeDb } from "./db.js";
import { loadConfig } from "./config.js";
import { Indexer } from "./indexer.js";

interface CountRow {
  count: number;
}

const config = loadConfig();
const db = getDb();

console.log(`[brain] Scanning ${config.brainRoots.map(r => `${r.path} (${r.label})`).join(", ")}...`);
const start = Date.now();

const indexer = new Indexer(db, config.brainRoots);
const result = indexer.initialScan();

const duration = ((Date.now() - start) / 1000).toFixed(1);

const nodeCount = db
  .query<CountRow, []>("SELECT COUNT(*) as count FROM nodes")
  .get() ?? { count: 0 };

const edgeCount = db
  .query<CountRow, []>("SELECT COUNT(*) as count FROM edges")
  .get() ?? { count: 0 };

const orphanCount = db
  .query<CountRow, []>(`
    SELECT COUNT(*) as count FROM nodes
    WHERE id NOT IN (SELECT source_id FROM edges)
      AND id NOT IN (SELECT target_id FROM edges)
  `)
  .get() ?? { count: 0 };

// Per-source counts
interface SourceCount { source_root: string; count: number }
const sourceCounts = db.query<SourceCount, []>("SELECT source_root, COUNT(*) as count FROM nodes GROUP BY source_root").all();

console.log(`[brain] ${nodeCount.count} notes indexed, ${edgeCount.count} edges, ${orphanCount.count} orphans (${duration}s)`);
console.log(`[brain] By source: ${sourceCounts.map(s => `${s.count} ${s.source_root}`).join(", ")}`);
console.log(`[brain] This run: ${result.indexed} new/updated, ${result.skipped} unchanged, ${result.removed} removed`);

closeDb();
