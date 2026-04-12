// brain-mcp Phase 2 — Tool: brain_map
// Aggregate overview of the entire knowledge graph

import { type Database } from "bun:sqlite";

export interface MapParams {
  // no params — returns full graph overview
}

interface CountRow {
  count: number;
}

interface ParaBreakdownRow {
  para_type: string;
  count: number;
}

interface TagCountRow {
  tag: string;
  count: number;
}

interface HubRow {
  path: string;
  title: string;
  degree: number;
}

interface RecentActivityRow {
  date: string;
  count: number;
}

interface MetaRow {
  value: string;
}

interface SourceBreakdownRow {
  source_root: string;
  count: number;
}

export interface MapResponse {
  totals: {
    nodes: number;
    edges: number;
    orphans: number;
    dangling_links: number;
  };
  source_breakdown: { source: string; count: number }[];
  para_breakdown: { type: string; count: number }[];
  top_tags: { tag: string; count: number }[];
  top_hubs: { path: string; title: string; degree: number }[];
  recent_activity: { date: string; count: number }[];
  health_score: number;
  last_full_scan: string;
}

export function brainMap(db: Database, _params: MapParams): MapResponse {
  // Total counts
  const nodeCount =
    db.query<CountRow, []>("SELECT COUNT(*) as count FROM nodes").get()?.count ?? 0;
  const edgeCount =
    db.query<CountRow, []>("SELECT COUNT(*) as count FROM edges").get()?.count ?? 0;
  const danglingCount =
    db.query<CountRow, []>("SELECT COUNT(*) as count FROM dangling_links").get()?.count ?? 0;

  // Orphan count: nodes not in any edge
  const orphanCount =
    db
      .query<CountRow, []>(`
        SELECT COUNT(*) as count FROM nodes
        WHERE id NOT IN (SELECT DISTINCT source_id FROM edges)
          AND id NOT IN (SELECT DISTINCT target_id FROM edges)
      `)
      .get()?.count ?? 0;

  // Source breakdown (personal vs project)
  const sourceBreakdown = db
    .query<SourceBreakdownRow, []>(
      "SELECT source_root, COUNT(*) as count FROM nodes GROUP BY source_root ORDER BY count DESC"
    )
    .all();

  // PARA breakdown
  const paraBreakdown = db
    .query<ParaBreakdownRow, []>(
      "SELECT para_type, COUNT(*) as count FROM nodes GROUP BY para_type ORDER BY count DESC"
    )
    .all();

  // Top 10 tags
  const topTags = db
    .query<TagCountRow, []>(`
      SELECT t.value AS tag, COUNT(*) AS count
      FROM nodes, json_each(nodes.tags) AS t
      GROUP BY t.value
      ORDER BY count DESC
      LIMIT 10
    `)
    .all();

  // Top 10 hub nodes by total degree (in + out wikilink edges)
  const topHubs = db
    .query<HubRow, []>(`
      SELECT n.path, n.title,
             COUNT(*) as degree
      FROM nodes n
      JOIN edges e ON (e.source_id = n.id OR e.target_id = n.id)
      WHERE e.edge_type = 'wikilink'
      GROUP BY n.id
      ORDER BY degree DESC
      LIMIT 10
    `)
    .all();

  // Recent activity: notes modified per day (last 7 days)
  const recentActivity = db
    .query<RecentActivityRow, []>(`
      SELECT date(modified_at) as date, COUNT(*) as count
      FROM nodes
      WHERE modified_at >= datetime('now', '-7 days')
      GROUP BY date(modified_at)
      ORDER BY date DESC
    `)
    .all();

  // Last full scan timestamp from metadata
  const lastScanRow = db
    .query<MetaRow, [string]>("SELECT value FROM metadata WHERE key = ?")
    .get("last_full_scan");
  const lastFullScan = lastScanRow?.value ?? "";

  // Health score (0-100):
  // - 30 pts: no orphans (scaled by orphan %)
  // - 30 pts: no dangling links (scaled by dangling %)
  // - 40 pts: graph connectivity (edges/nodes ratio, capped at 4.0 = full 40pts)
  let healthScore = 100;

  if (nodeCount > 0) {
    const orphanPct = orphanCount / nodeCount;
    const orphanPenalty = Math.round(orphanPct * 30);

    const danglingPct = Math.min(danglingCount / Math.max(nodeCount, 1), 1);
    const danglingPenalty = Math.round(danglingPct * 30);

    const edgeRatio = edgeCount / Math.max(nodeCount, 1);
    const connectivityBonus = Math.min(edgeRatio / 4.0, 1.0) * 40;

    healthScore = Math.round(
      100 - orphanPenalty - danglingPenalty - (40 - connectivityBonus)
    );
    healthScore = Math.max(0, Math.min(100, healthScore));
  }

  return {
    totals: {
      nodes: nodeCount,
      edges: edgeCount,
      orphans: orphanCount,
      dangling_links: danglingCount,
    },
    source_breakdown: sourceBreakdown.map((r) => ({ source: r.source_root, count: r.count })),
    para_breakdown: paraBreakdown.map((r) => ({ type: r.para_type, count: r.count })),
    top_tags: topTags,
    top_hubs: topHubs,
    recent_activity: recentActivity,
    health_score: healthScore,
    last_full_scan: lastFullScan,
  };
}
