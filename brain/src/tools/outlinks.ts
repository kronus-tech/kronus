// brain-mcp Phase 2 — Tool: brain_outlinks

import { type Database } from "bun:sqlite";

export interface OutlinksParams {
  path: string;
}

interface NodeIdRow {
  id: number;
}

interface OutlinkRow {
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
  context: string | null;
}

export interface OutlinkResult {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
  context: string | null;
}

export interface OutlinksResponse {
  path: string;
  outlinks: OutlinkResult[];
  dangling: { target_text: string; context: string | null }[];
  total: number;
}

interface DanglingRow {
  target_text: string;
  context: string | null;
}

export function brainOutlinks(db: Database, params: OutlinksParams): OutlinksResponse {
  const node = db
    .query<NodeIdRow, [string]>("SELECT id FROM nodes WHERE path = ?")
    .get(params.path);

  if (!node) {
    throw new Error(`Node not found: ${params.path}`);
  }

  const rows = db
    .query<OutlinkRow, [number]>(`
      SELECT n.path, n.title, n.para_type, n.tags, n.word_count, n.modified_at,
             e.context
      FROM edges e
      JOIN nodes n ON n.id = e.target_id
      WHERE e.source_id = ? AND e.edge_type = 'wikilink'
      ORDER BY n.title
    `)
    .all(node.id);

  const dangling = db
    .query<DanglingRow, [number]>(
      "SELECT target_text, context FROM dangling_links WHERE source_id = ?"
    )
    .all(node.id);

  const outlinks = rows.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags) as string[],
  }));

  return {
    path: params.path,
    outlinks,
    dangling,
    total: outlinks.length,
  };
}
