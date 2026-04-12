// brain-mcp Phase 2 — Tool: brain_recent

import { type Database } from "bun:sqlite";

export interface RecentParams {
  days?: number;
  para_type?: string;
  source?: string;
  limit?: number;
}

interface RecentRow {
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
  source_root: string;
}

export interface RecentNote {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
  source: string;
}

export interface RecentResponse {
  notes: RecentNote[];
  total: number;
  days: number | null;
}

const VALID_SOURCES = new Set(["personal", "project"]);

export function brainRecent(db: Database, params: RecentParams): RecentResponse {
  // BRAIN-013: Validate source filter
  if (params.source && !VALID_SOURCES.has(params.source)) {
    return { notes: [], total: 0, days: null };
  }
  const limit = Math.min(params.limit ?? 20, 100);
  const days = params.days ?? null;

  let sql =
    "SELECT path, title, para_type, tags, word_count, modified_at, source_root FROM nodes WHERE 1=1";
  const sqlParams: (string | number)[] = [];

  if (days !== null) {
    sql += " AND modified_at >= datetime('now', ?)";
    sqlParams.push(`-${days} days`);
  }

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

  const rows = db.query<RecentRow, (string | number)[]>(sql).all(...sqlParams);

  const notes = rows.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags) as string[],
    source: r.source_root,
  }));

  return { notes, total: notes.length, days };
}
