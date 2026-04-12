// brain-mcp Phase 2 — Tool: brain_tags

import { type Database } from "bun:sqlite";

export interface TagsParams {
  tag?: string;
  limit?: number;
}

interface TagCountRow {
  tag: string;
  count: number;
}

interface TaggedNodeRow {
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
}

export interface TagEntry {
  tag: string;
  count: number;
}

export interface TaggedNode {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
}

export type TagsResponse =
  | { mode: "index"; tags: TagEntry[]; total_unique: number }
  | { mode: "filter"; tag: string; notes: TaggedNode[]; total: number };

export function brainTags(db: Database, params: TagsParams): TagsResponse {
  const limit = Math.min(params.limit ?? 100, 500);

  if (!params.tag) {
    // Full tag index with counts via json_each
    const rows = db
      .query<TagCountRow, [number]>(`
        SELECT t.value AS tag, COUNT(*) AS count
        FROM nodes, json_each(nodes.tags) AS t
        GROUP BY t.value
        ORDER BY count DESC, t.value ASC
        LIMIT ?
      `)
      .all(limit);

    return {
      mode: "index",
      tags: rows,
      total_unique: rows.length,
    };
  }

  // Notes containing a specific tag
  const rows = db
    .query<TaggedNodeRow, [string, number]>(`
      SELECT n.path, n.title, n.para_type, n.tags, n.word_count, n.modified_at
      FROM nodes n, json_each(n.tags) AS t
      WHERE t.value = ?
      ORDER BY n.modified_at DESC
      LIMIT ?
    `)
    .all(params.tag, limit);

  const notes = rows.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags) as string[],
  }));

  return {
    mode: "filter",
    tag: params.tag,
    notes,
    total: notes.length,
  };
}
