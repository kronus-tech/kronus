// brain-mcp Phase 2 — Tool: brain_backlinks

import { type Database } from "bun:sqlite";

export interface BacklinksParams {
  path: string;
}

interface NodeIdRow {
  id: number;
}

interface BacklinkRow {
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
  context: string | null;
}

export interface BacklinkResult {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
  context: string | null;
}

export interface BacklinksResponse {
  path: string;
  backlinks: BacklinkResult[];
  total: number;
}

export function brainBacklinks(db: Database, params: BacklinksParams): BacklinksResponse {
  const node = db
    .query<NodeIdRow, [string]>("SELECT id FROM nodes WHERE path = ?")
    .get(params.path);

  if (!node) {
    throw new Error(`Node not found: ${params.path}`);
  }

  const rows = db
    .query<BacklinkRow, [number]>(`
      SELECT n.path, n.title, n.para_type, n.tags, n.word_count, n.modified_at,
             e.context
      FROM edges e
      JOIN nodes n ON n.id = e.source_id
      WHERE e.target_id = ? AND e.edge_type = 'wikilink'
      ORDER BY n.modified_at DESC
    `)
    .all(node.id);

  const backlinks = rows.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags) as string[],
  }));

  return {
    path: params.path,
    backlinks,
    total: backlinks.length,
  };
}
