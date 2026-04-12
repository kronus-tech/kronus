// brain-mcp Phase 2 — Tool: brain_graph

import { type Database } from "bun:sqlite";

export interface GraphParams {
  path: string;
}

interface NodeRow {
  id: number;
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
}

interface EdgeRow {
  path: string;
  title: string;
  edge_type: string;
  weight: number;
  context: string | null;
}

interface DanglingRow {
  target_text: string;
  context: string | null;
}

export interface NodeSummary {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
}

export interface EdgeSummary {
  path: string;
  title: string;
  edge_type: string;
  weight: number;
  context: string | null;
}

export interface GraphResponse {
  node: NodeSummary;
  outlinks: EdgeSummary[];
  backlinks: EdgeSummary[];
  tag_neighbors: NodeSummary[];
  dangling: { target_text: string; context: string | null }[];
}

export function brainGraph(db: Database, params: GraphParams): GraphResponse {
  const node = db
    .query<NodeRow, [string]>(
      "SELECT id, path, title, para_type, tags, word_count, modified_at FROM nodes WHERE path = ?"
    )
    .get(params.path);

  if (!node) {
    throw new Error(`Node not found: ${params.path}`);
  }

  // Outlinks: edges where this node is source
  const outlinks = db
    .query<EdgeRow, [number]>(`
      SELECT n.path, n.title, e.edge_type, e.weight, e.context
      FROM edges e
      JOIN nodes n ON n.id = e.target_id
      WHERE e.source_id = ? AND e.edge_type = 'wikilink'
      ORDER BY n.title
    `)
    .all(node.id);

  // Backlinks: edges where this node is target
  const backlinks = db
    .query<EdgeRow, [number]>(`
      SELECT n.path, n.title, e.edge_type, e.weight, e.context
      FROM edges e
      JOIN nodes n ON n.id = e.source_id
      WHERE e.target_id = ? AND e.edge_type = 'wikilink'
      ORDER BY n.title
    `)
    .all(node.id);

  // Tag neighbors: other nodes sharing any tag via tag_co edges
  const tagNeighborRows = db
    .query<NodeRow, [number, number, number]>(`
      SELECT DISTINCT n.id, n.path, n.title, n.para_type, n.tags, n.word_count, n.modified_at
      FROM edges e
      JOIN nodes n ON (n.id = e.target_id OR n.id = e.source_id)
      WHERE (e.source_id = ? OR e.target_id = ?)
        AND e.edge_type = 'tag_co'
        AND n.id != ?
      ORDER BY n.title
      LIMIT 20
    `)
    .all(node.id, node.id, node.id);

  // Dangling links originating from this node
  const dangling = db
    .query<DanglingRow, [number]>(
      "SELECT target_text, context FROM dangling_links WHERE source_id = ?"
    )
    .all(node.id);

  return {
    node: {
      path: node.path,
      title: node.title,
      para_type: node.para_type,
      tags: JSON.parse(node.tags) as string[],
      word_count: node.word_count,
      modified_at: node.modified_at,
    },
    outlinks,
    backlinks,
    tag_neighbors: tagNeighborRows.map((r) => ({
      path: r.path,
      title: r.title,
      para_type: r.para_type,
      tags: JSON.parse(r.tags) as string[],
      word_count: r.word_count,
      modified_at: r.modified_at,
    })),
    dangling,
  };
}
