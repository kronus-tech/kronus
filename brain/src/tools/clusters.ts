// brain-mcp Phase 2 — Tool: brain_clusters
// Union-Find over all edges to find connected components

import { type Database } from "bun:sqlite";

export interface ClustersParams {
  min_size?: number;
  limit?: number;
}

interface EdgePairRow {
  source_id: number;
  target_id: number;
}

interface NodeBasicRow {
  id: number;
  path: string;
  title: string;
  para_type: string;
}

export interface ClusterMember {
  path: string;
  title: string;
  para_type: string;
}

export interface Cluster {
  id: number;
  size: number;
  members: ClusterMember[];
}

export interface ClustersResponse {
  clusters: Cluster[];
  total_clusters: number;
  total_nodes_clustered: number;
  singleton_count: number;
}

// ─── Union-Find ───────────────────────────────────────────────────────────────

class UnionFind {
  private readonly parent: Map<number, number> = new Map();
  private readonly rank: Map<number, number> = new Map();

  find(x: number): number {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    const p = this.parent.get(x)!;
    if (p !== x) {
      const root = this.find(p);
      this.parent.set(x, root);
      return root;
    }
    return x;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;

    const rankX = this.rank.get(rx) ?? 0;
    const rankY = this.rank.get(ry) ?? 0;

    if (rankX < rankY) {
      this.parent.set(rx, ry);
    } else if (rankX > rankY) {
      this.parent.set(ry, rx);
    } else {
      this.parent.set(ry, rx);
      this.rank.set(rx, rankX + 1);
    }
  }

  roots(): Set<number> {
    const roots = new Set<number>();
    for (const [id] of this.parent) {
      roots.add(this.find(id));
    }
    return roots;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function brainClusters(db: Database, params: ClustersParams): ClustersResponse {
  const minSize = params.min_size ?? 2;
  const limit = Math.min(params.limit ?? 20, 100);

  // Load all edges
  const edges = db
    .query<EdgePairRow, []>("SELECT source_id, target_id FROM edges")
    .all();

  // Load all nodes
  const nodes = db
    .query<NodeBasicRow, []>("SELECT id, path, title, para_type FROM nodes")
    .all();

  const uf = new UnionFind();

  // Seed all node IDs so singletons are tracked
  for (const node of nodes) {
    uf.find(node.id);
  }

  // Union connected nodes
  for (const edge of edges) {
    uf.union(edge.source_id, edge.target_id);
  }

  // Group nodes by their root
  const groups = new Map<number, NodeBasicRow[]>();
  for (const node of nodes) {
    const root = uf.find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }

  // Build cluster list sorted by size descending
  const allClusters: Cluster[] = [];
  let singletonCount = 0;
  let clusterId = 0;

  for (const [, members] of groups) {
    if (members.length === 1) {
      singletonCount++;
      continue;
    }
    if (members.length < minSize) continue;

    allClusters.push({
      id: clusterId++,
      size: members.length,
      members: members
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((m) => ({ path: m.path, title: m.title, para_type: m.para_type })),
    });
  }

  allClusters.sort((a, b) => b.size - a.size);

  const clusters = allClusters.slice(0, limit);
  const totalNodesClustered = clusters.reduce((sum, c) => sum + c.size, 0);

  return {
    clusters,
    total_clusters: allClusters.length,
    total_nodes_clustered: totalNodesClustered,
    singleton_count: singletonCount,
  };
}
