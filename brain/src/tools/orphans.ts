// brain-mcp Phase 2 — Tool: brain_orphans

import { type Database } from "bun:sqlite";

export interface OrphansParams {
  para_type?: string;
  source?: string;
  limit?: number;
}

interface OrphanRow {
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
  source_root: string;
}

export interface OrphanNote {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
  source: string;
}

export interface OrphansResponse {
  orphans: OrphanNote[];
  total: number;
}

const VALID_SOURCES = new Set(["personal", "project"]);

export function brainOrphans(db: Database, params: OrphansParams): OrphansResponse {
  // BRAIN-013: Validate source filter
  if (params.source && !VALID_SOURCES.has(params.source)) {
    return { orphans: [], total: 0 };
  }
  const limit = Math.min(params.limit ?? 50, 200);

  let sql = `
    SELECT path, title, para_type, tags, word_count, modified_at, source_root
    FROM nodes
    WHERE id NOT IN (SELECT DISTINCT source_id FROM edges)
      AND id NOT IN (SELECT DISTINCT target_id FROM edges)
  `;
  const sqlParams: (string | number)[] = [];

  if (params.para_type) {
    sql += " AND para_type = ?";
    sqlParams.push(params.para_type);
  }

  if (params.source) {
    sql += " AND source_root = ?";
    sqlParams.push(params.source);
  }

  sql += " ORDER BY modified_at DESC LIMIT ?";
  sqlParams.push(limit);

  const rows = db.query<OrphanRow, (string | number)[]>(sql).all(...sqlParams);

  const orphans = rows.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags) as string[],
    source: r.source_root,
  }));

  return { orphans, total: orphans.length };
}
