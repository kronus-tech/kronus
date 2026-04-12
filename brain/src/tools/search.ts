// brain-mcp Phase 2 — Tool: brain_search
// Phase 5 — Search quality improvements: normalizeQuery + rank boosting

import { type Database } from "bun:sqlite";

export interface SearchFilters {
  para_type?: string;
  tags?: string[];
  status?: string;
  source?: string;
}

export interface SearchParams {
  query: string;
  filters?: SearchFilters;
  limit?: number;
}

interface SearchRow {
  path: string;
  title: string;
  para_type: string;
  tags: string;
  word_count: number;
  modified_at: string;
  source_root: string;
  snippet?: string;
  score?: number;
}

export interface SearchResult {
  path: string;
  title: string;
  para_type: string;
  tags: string[];
  word_count: number;
  modified_at: string;
  source: string;
  snippet?: string;
  score?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  error?: string;
}

// ─── PARA recency boost multipliers ──────────────────────────────────────────

const PARA_BOOST: Record<string, number> = {
  project: 1.3,
  area: 1.1,
  resource: 1.0,
  archive: 0.7,
};

const RECENCY_BOOST = 1.2; // applied if modified within last 30 days
const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

// ─── Natural language → FTS5 query normalization ─────────────────────────────

/**
 * Convert a raw user query into a safe FTS5 MATCH expression.
 *
 * Rules:
 * - Strip FTS5 special chars that cause parse errors: ( ) { } * : ^ ~
 * - If the user wrapped the whole query in quotes, treat it as a phrase search
 * - Otherwise split on whitespace and join words with implicit AND (FTS5 default)
 * - Empty input returns empty string (caller skips FTS path)
 */
export function normalizeQuery(raw: string): string {
  // Strip characters that confuse FTS5's query parser
  const cleaned = raw.replace(/[(){}*:^~]/g, "");
  const trimmed = cleaned.trim();

  if (!trimmed) return "";

  // Preserve explicit phrase search: user typed "foo bar"
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
    // Strip stray interior quotes to prevent unterminated phrase
    const inner = trimmed.slice(1, -1).replace(/"/g, "");
    return inner ? `"${inner}"` : "";
  }

  // Split into words; join without operator (FTS5 uses implicit AND by default)
  const words = trimmed
    .replace(/"/g, "") // remove any remaining stray quotes
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";

  return words.join(" ");
}

// ─── Rank boosting ────────────────────────────────────────────────────────────

/**
 * Apply recency and PARA-type multipliers to BM25 scores.
 *
 * BM25 returns negative values in SQLite FTS5 (lower = better match), so we
 * negate before multiplying, then re-negate to keep the convention consistent.
 * After boosting we sort ascending (most-negative = highest boosted score).
 */
function applyBoosts(rows: SearchRow[]): SearchRow[] {
  const now = Date.now();

  const boosted = rows.map((r) => {
    const rawScore = r.score ?? 0;
    // BM25 is negative: convert to positive, apply multipliers, convert back
    let magnitude = Math.abs(rawScore);

    const paraMultiplier = PARA_BOOST[r.para_type] ?? 1.0;
    magnitude *= paraMultiplier;

    const modifiedMs = new Date(r.modified_at).getTime();
    if (!isNaN(modifiedMs) && now - modifiedMs <= MS_30_DAYS) {
      magnitude *= RECENCY_BOOST;
    }

    return { ...r, score: -magnitude };
  });

  // Sort ascending: most-negative (highest boosted magnitude) first
  boosted.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return boosted;
}

// ─── brainSearch ─────────────────────────────────────────────────────────────

const VALID_SOURCES = new Set(["personal", "project"]);

export function brainSearch(db: Database, params: SearchParams): SearchResponse {
  const limit = Math.min(params.limit ?? 10, 50);
  // BRAIN-013: Validate source filter against allowlist
  if (params.filters?.source && !VALID_SOURCES.has(params.filters.source)) {
    return { results: [], total: 0, query: params.query, error: `Invalid source filter: ${params.filters.source}` };
  }

  if (!params.query.trim()) {
    // Empty query = recent notes, with optional filters
    let sql = "SELECT path, title, para_type, tags, word_count, modified_at, source_root FROM nodes";
    const conditions: string[] = [];
    const sqlParams: (string | number)[] = [];

    if (params.filters?.para_type) {
      conditions.push("para_type = ?");
      sqlParams.push(params.filters.para_type);
    }
    if (params.filters?.status) {
      conditions.push("status = ?");
      sqlParams.push(params.filters.status);
    }
    if (params.filters?.source) {
      conditions.push("source_root = ?");
      sqlParams.push(params.filters.source);
    }
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY modified_at DESC LIMIT ?";
    sqlParams.push(limit);

    const rows = db.query<SearchRow, (string | number)[]>(sql).all(...sqlParams);

    let filtered: SearchRow[] = rows;
    if (params.filters?.tags?.length) {
      const required = params.filters.tags;
      filtered = rows.filter((r) => {
        const tags = JSON.parse(r.tags) as string[];
        return required.every((t) => tags.includes(t));
      });
    }

    const results = filtered.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags) as string[],
      source: r.source_root,
    }));

    return { results, total: results.length, query: "" };
  }

  // Normalize raw query before passing to FTS5
  const normalizedQuery = normalizeQuery(params.query);
  if (!normalizedQuery) {
    return { results: [], total: 0, query: params.query };
  }

  // FTS5 search with BM25 scoring
  let sql = `
    SELECT n.path, n.title, n.para_type, n.tags, n.word_count, n.modified_at, n.source_root,
           snippet(nodes_fts, 1, '<b>', '</b>', '...', 20) as snippet,
           bm25(nodes_fts) as score
    FROM nodes_fts
    JOIN nodes n ON n.id = nodes_fts.rowid
    WHERE nodes_fts MATCH ?
  `;
  const sqlParams: (string | number)[] = [normalizedQuery];

  if (params.filters?.para_type) {
    sql += " AND n.para_type = ?";
    sqlParams.push(params.filters.para_type);
  }
  if (params.filters?.status) {
    sql += " AND n.status = ?";
    sqlParams.push(params.filters.status);
  }
  if (params.filters?.source) {
    sql += " AND n.source_root = ?";
    sqlParams.push(params.filters.source);
  }

  // Fetch more than limit so boosting can re-rank before slicing
  sql += " ORDER BY score LIMIT ?";
  sqlParams.push(limit * 3);

  // BRAIN-001: Catch FTS5 syntax errors — return sanitized message, not raw SQLite error
  let rows: SearchRow[];
  try {
    rows = db.query<SearchRow, (string | number)[]>(sql).all(...sqlParams);
  } catch {
    return { results: [], total: 0, query: params.query, error: "Invalid search query syntax" };
  }

  // Apply rank boosting and re-sort
  const boostedRows = applyBoosts(rows);

  // Tag filter applied post-query since tags are JSON
  let filtered: SearchRow[] = boostedRows;
  if (params.filters?.tags?.length) {
    const required = params.filters.tags;
    filtered = boostedRows.filter((r) => {
      const tags = JSON.parse(r.tags) as string[];
      return required.every((t) => tags.includes(t));
    });
  }

  const results = filtered.slice(0, limit).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags) as string[],
    source: r.source_root,
  }));

  return { results, total: results.length, query: params.query };
}
