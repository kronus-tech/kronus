-- ─────────────────────────────────────────────────────────────
-- Migration 001: Initial schema
-- brain-mcp SQLite knowledge graph
-- ─────────────────────────────────────────────────────────────

-- nodes: one row per markdown file
CREATE TABLE IF NOT EXISTS nodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT    NOT NULL UNIQUE,   -- relative to brain root, e.g. "Projects/ai-rag.md"
  title        TEXT    NOT NULL,          -- from YAML frontmatter `title:` or H1, or basename
  para_type    TEXT    NOT NULL           -- 'project' | 'area' | 'resource' | 'archive' | 'inbox'
               CHECK(para_type IN ('project','area','resource','archive','inbox')),
  tags         TEXT    NOT NULL DEFAULT '[]',   -- JSON array: ["ai","rag","production"]
  aliases      TEXT    NOT NULL DEFAULT '[]',   -- JSON array: alternate names for wikilink resolution
  status       TEXT,                            -- from frontmatter: 'active' | 'done' | 'someday' | NULL
  frontmatter  TEXT    NOT NULL DEFAULT '{}',   -- JSON blob of full YAML frontmatter
  content      TEXT    NOT NULL DEFAULT '',     -- raw markdown body (stripped of frontmatter)
  content_hash TEXT    NOT NULL DEFAULT '',     -- MD5(raw file bytes) for change detection
  word_count   INTEGER NOT NULL DEFAULT 0,
  heading_tree TEXT    NOT NULL DEFAULT '[]',   -- JSON: [{level:1,text:"Intro"},{level:2,...}]
  embedding    BLOB    DEFAULT NULL,            -- RESERVED: float32[] for future vector search
  created_at   TEXT    NOT NULL,                -- ISO8601, from frontmatter `created:` or file ctime
  modified_at  TEXT    NOT NULL,                -- ISO8601, from file mtime (authoritative)
  indexed_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_para     ON nodes(para_type);
CREATE INDEX IF NOT EXISTS idx_nodes_status   ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_modified ON nodes(modified_at DESC);

-- ─────────────────────────────────────────────────────────────
-- edges: directed relationships between nodes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  edge_type   TEXT    NOT NULL
              CHECK(edge_type IN ('wikilink','tag_co','heading_ref','semantic','manual')),
  -- wikilink:    [[explicit link]] in source → target file
  -- tag_co:      both source and target share a tag (auto-computed on index)
  -- heading_ref: source mentions target title in a heading (fuzzy)
  -- semantic:    future: vector similarity above threshold
  -- manual:      user-created via brain_link tool (future)
  weight      REAL    NOT NULL DEFAULT 1.0,  -- semantic: cosine sim; others: 1.0
  context     TEXT,                           -- snippet of text around the link
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
  ON edges(source_id, target_id, edge_type);  -- prevent duplicate edges
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type   ON edges(edge_type);

-- ─────────────────────────────────────────────────────────────
-- nodes_fts: FTS5 full-text search over title + content + tags
-- external-content table pointing to nodes — no data duplication
-- ─────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  title,
  content,
  tags,           -- tags JSON string is included; FTS tokenizes it
  content='nodes',
  content_rowid='id',
  tokenize='porter unicode61'   -- stemming for better recall
);

-- triggers to keep FTS in sync with nodes table
CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, title, content, tags)
  VALUES (new.id, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, content, tags)
  VALUES ('delete', old.id, old.title, old.content, old.tags);
  INSERT INTO nodes_fts(rowid, title, content, tags)
  VALUES (new.id, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, title, content, tags)
  VALUES ('delete', old.id, old.title, old.content, old.tags);
END;

-- ─────────────────────────────────────────────────────────────
-- metadata: singleton rows tracking index state
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- dangling_links: unresolved wikilinks (wanted pages)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dangling_links (
  source_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_text TEXT    NOT NULL,   -- the raw unresolved target
  context     TEXT,
  PRIMARY KEY (source_id, target_text)
);

-- Seed metadata on first run (idempotent)
INSERT OR IGNORE INTO metadata VALUES ('schema_version', '1');
INSERT OR IGNORE INTO metadata VALUES ('last_full_scan', '');
INSERT OR IGNORE INTO metadata VALUES ('total_nodes', '0');
INSERT OR IGNORE INTO metadata VALUES ('total_edges', '0');
