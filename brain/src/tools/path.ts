// brain-mcp Phase 2 — Tool: brain_path
// BFS shortest path between two nodes over all edges, max depth 6

import { type Database } from "bun:sqlite";

export interface PathParams {
  source: string;   // relative path of source node
  target: string;   // relative path of target node
}

interface NodeIdRow {
  id: number;
  path: string;
  title: string;
}

interface EdgeNeighborRow {
  neighbor_id: number;
  edge_type: string;
}

export interface PathStep {
  path: string;
  title: string;
}

export type PathResponse =
  | { found: true; path: PathStep[]; length: number }
  | { found: false; source: string; target: string; max_depth: number };

const MAX_DEPTH = 6;

export function brainPath(db: Database, params: PathParams): PathResponse {
  const sourceNode = db
    .query<NodeIdRow, [string]>("SELECT id, path, title FROM nodes WHERE path = ?")
    .get(params.source);

  if (!sourceNode) {
    throw new Error(`Source node not found: ${params.source}`);
  }

  const targetNode = db
    .query<NodeIdRow, [string]>("SELECT id, path, title FROM nodes WHERE path = ?")
    .get(params.target);

  if (!targetNode) {
    throw new Error(`Target node not found: ${params.target}`);
  }

  if (sourceNode.id === targetNode.id) {
    return {
      found: true,
      path: [{ path: sourceNode.path, title: sourceNode.title }],
      length: 0,
    };
  }

  // BFS
  // Queue entries: [current_id, path_of_ids]
  const queue: [number, number[]][] = [[sourceNode.id, [sourceNode.id]]];
  const visited = new Set<number>([sourceNode.id]);

  // Preload node id -> {path, title} map for path reconstruction
  const nodeMap = new Map<number, { path: string; title: string }>();
  nodeMap.set(sourceNode.id, { path: sourceNode.path, title: sourceNode.title });
  nodeMap.set(targetNode.id, { path: targetNode.path, title: targetNode.title });

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const [currentId, currentPath] = entry;

    if (currentPath.length > MAX_DEPTH) break;

    // Get all neighbors (both directions for undirected BFS)
    const neighbors = db
      .query<EdgeNeighborRow, [number, number, number]>(`
        SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS neighbor_id,
               edge_type
        FROM edges
        WHERE source_id = ? OR target_id = ?
      `)
      .all(currentId, currentId, currentId);

    for (const neighbor of neighbors) {
      const nid = neighbor.neighbor_id;

      if (nid === targetNode.id) {
        // Found! Reconstruct path
        const idPath = [...currentPath, nid];
        const steps: PathStep[] = idPath.map((id) => {
          if (nodeMap.has(id)) return nodeMap.get(id)!;
          // Lazy load any intermediate nodes not yet in map
          const row = db
            .query<NodeIdRow, [number]>("SELECT id, path, title FROM nodes WHERE id = ?")
            .get(id);
          if (row) {
            nodeMap.set(id, { path: row.path, title: row.title });
            return { path: row.path, title: row.title };
          }
          return { path: String(id), title: String(id) };
        });

        return {
          found: true,
          path: steps,
          length: steps.length - 1,
        };
      }

      if (!visited.has(nid)) {
        visited.add(nid);
        if (currentPath.length < MAX_DEPTH) {
          queue.push([nid, [...currentPath, nid]]);
        }
      }
    }
  }

  return {
    found: false,
    source: params.source,
    target: params.target,
    max_depth: MAX_DEPTH,
  };
}
