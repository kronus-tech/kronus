// brain-mcp Phase 2 — Tool: brain_suggest
// Suggest related notes scored by: shared_tags*0.4 + shared_outlinks*0.35 + shared_backlinks*0.25

import { type Database } from "bun:sqlite";

export interface SuggestParams {
  path: string;
  limit?: number;
}

interface NodeIdRow {
  id: number;
}

interface TagRow {
  tags: string;
}

interface OutlinkTargetRow {
  target_id: number;
}

interface BacklinkSourceRow {
  source_id: number;
}

interface CandidateRow {
  id: number;
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
}

export interface SuggestedNote {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
  score: number;
  reasons: {
    shared_tags: number;
    shared_outlinks: number;
    shared_backlinks: number;
  };
}

export interface SuggestResponse {
  path: string;
  suggestions: SuggestedNote[];
  total: number;
}

export function brainSuggest(db: Database, params: SuggestParams): SuggestResponse {
  const limit = Math.min(params.limit ?? 10, 50);

  const sourceNode = db
    .query<NodeIdRow, [string]>("SELECT id FROM nodes WHERE path = ?")
    .get(params.path);

  if (!sourceNode) {
    throw new Error(`Node not found: ${params.path}`);
  }

  const sourceId = sourceNode.id;

  // Source tags
  const sourceTagsRow = db
    .query<TagRow, [number]>("SELECT tags FROM nodes WHERE id = ?")
    .get(sourceId);
  const sourceTags = new Set<string>(
    JSON.parse(sourceTagsRow?.tags ?? "[]") as string[]
  );

  // Source outlink targets (wikilink)
  const sourceOutlinks = new Set<number>(
    db
      .query<OutlinkTargetRow, [number]>(
        "SELECT target_id FROM edges WHERE source_id = ? AND edge_type = 'wikilink'"
      )
      .all(sourceId)
      .map((r) => r.target_id)
  );

  // Source backlink sources (who links to source)
  const sourceBacklinks = new Set<number>(
    db
      .query<BacklinkSourceRow, [number]>(
        "SELECT source_id FROM edges WHERE target_id = ? AND edge_type = 'wikilink'"
      )
      .all(sourceId)
      .map((r) => r.source_id)
  );

  // All candidate nodes (exclude self)
  const candidates = db
    .query<CandidateRow, [number]>(
      "SELECT id, path, title, para_type, tags, word_count, modified_at FROM nodes WHERE id != ?"
    )
    .all(sourceId);

  const scored: SuggestedNote[] = [];

  for (const candidate of candidates) {
    const candTags = new Set<string>(JSON.parse(candidate.tags) as string[]);

    // Shared tags count
    let sharedTags = 0;
    for (const tag of candTags) {
      if (sourceTags.has(tag)) sharedTags++;
    }

    // Shared outlink targets: nodes that both this node and candidate link to
    const candOutlinks = new Set<number>(
      db
        .query<OutlinkTargetRow, [number]>(
          "SELECT target_id FROM edges WHERE source_id = ? AND edge_type = 'wikilink'"
        )
        .all(candidate.id)
        .map((r) => r.target_id)
    );
    let sharedOutlinks = 0;
    for (const tid of candOutlinks) {
      if (sourceOutlinks.has(tid)) sharedOutlinks++;
    }

    // Shared backlink sources: nodes that link to both this node and candidate
    const candBacklinks = new Set<number>(
      db
        .query<BacklinkSourceRow, [number]>(
          "SELECT source_id FROM edges WHERE target_id = ? AND edge_type = 'wikilink'"
        )
        .all(candidate.id)
        .map((r) => r.source_id)
    );
    let sharedBacklinks = 0;
    for (const sid of candBacklinks) {
      if (sourceBacklinks.has(sid)) sharedBacklinks++;
    }

    // Normalise each signal to [0,1] using soft cap: signal / (signal + 3)
    const tagScore = sourceTags.size > 0 ? sharedTags / Math.max(sourceTags.size, 1) : 0;
    const outScore =
      sourceOutlinks.size > 0 ? sharedOutlinks / Math.max(sourceOutlinks.size, 1) : 0;
    const backScore =
      sourceBacklinks.size > 0 ? sharedBacklinks / Math.max(sourceBacklinks.size, 1) : 0;

    const score = tagScore * 0.4 + outScore * 0.35 + backScore * 0.25;

    if (score > 0) {
      scored.push({
        path: candidate.path,
        title: candidate.title,
        para_type: candidate.para_type,
        tags: JSON.parse(candidate.tags) as string[],
        word_count: candidate.word_count,
        modified_at: candidate.modified_at,
        score: Math.round(score * 1000) / 1000,
        reasons: {
          shared_tags: sharedTags,
          shared_outlinks: sharedOutlinks,
          shared_backlinks: sharedBacklinks,
        },
      });
    }
  }

  // Sort by score descending, take top limit
  scored.sort((a, b) => b.score - a.score);
  const suggestions = scored.slice(0, limit);

  return {
    path: params.path,
    suggestions,
    total: suggestions.length,
  };
}
