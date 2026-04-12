# Kronus Brain — Knowledge Graph MCP Server

Your second brain, indexed and queryable. Turns `~/second-brain/` markdown files into a
searchable knowledge graph with 13 tools for Claude Code.

## Quick Start

```bash
cd brain && bun install
BRAIN_ROOT=~/second-brain bun run dev
```

The server:

1. Scans all `.md` files in `BRAIN_ROOT`
2. Builds a SQLite knowledge graph (`~/.kronus/brain.sqlite`)
3. Starts an MCP server (stdio) for Claude Code
4. Starts a graph UI at `http://localhost:4242`
5. Watches for file changes (incremental re-indexing)

## Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `BRAIN_ROOT` | `~/second-brain` | Path to markdown vault |
| `BRAIN_DB` | `~/.kronus/brain.sqlite` | SQLite database path |
| `BRAIN_UI_PORT` | `4242` | Graph visualization port |

## MCP Tools (13)

| Tool | Purpose |
|------|---------|
| `brain_search` | Full-text search with BM25 scoring, rank boosting, and filters |
| `brain_graph` | Node + all connections (one hop) |
| `brain_backlinks` | What links TO a note |
| `brain_outlinks` | What a note links TO |
| `brain_tags` | Tag index or notes filtered by tag |
| `brain_recent` | Recently modified notes |
| `brain_create` | Create note with frontmatter and auto-index |
| `brain_update` | Update note content and re-index |
| `brain_orphans` | Disconnected notes (no inbound or outbound links) |
| `brain_clusters` | Connected components via union-find |
| `brain_map` | Graph overview with health score |
| `brain_path` | Shortest path between two notes (BFS) |
| `brain_suggest` | Related notes by shared tags and links |

## Markdown Format

Notes use Obsidian-compatible frontmatter:

```markdown
---
title: My Note
tags: [ai, production]
status: active
created: 2026-03-30
aliases: [my-note]
---

# My Note

Link to other notes with [[wikilinks]].
Use #inline-tags for additional categorization.
```

## Architecture

```
~/second-brain/*.md
        |
        v
    Parser (frontmatter + wikilinks + inline tags)
        |
        v
  SQLite KG (~/.kronus/brain.sqlite)
    - nodes: one row per note
    - edges: wikilink graph
    - nodes_fts: FTS5 full-text index
    - dangling_links: unresolved [[wikilinks]]
        |
       / \
      v   v
  MCP Tools    D3 Graph UI
  (stdio)    (localhost:4242)
      |
      v
  Claude Code
```

## PARA Structure

Files are auto-categorized by directory prefix:

| Directory | PARA Type | Search Boost |
|-----------|-----------|--------------|
| `Projects/` | project | 1.3x |
| `Areas/` | area | 1.1x |
| `Resources/` | resource | 1.0x |
| `Archive/` | archive | 0.7x |
| Other | inbox | 1.0x |

Notes modified in the last 30 days receive an additional 1.2x recency boost in search results.

## Search Quality

`brain_search` applies a two-pass ranking pipeline:

1. **FTS5 BM25** — SQLite full-text scoring on title and content
2. **Rank boosting** — PARA type multiplier + recency multiplier applied post-query
3. **Natural language normalization** — strips FTS5 special characters before querying so
   plain text like `(AI systems)` never causes a parse error

## Graph UI

Open `http://localhost:4242` while brain-mcp is running:

- Force-directed graph colored by PARA type
- Click nodes for detail panel with backlinks and outlinks
- Search and PARA filter buttons
- Path finding between notes
- Double-click to open in editor

## Development

```bash
# Run MCP server in dev mode (with file watcher)
bun run dev

# Run all tests
bun test

# Run performance tests only (1000-note vault)
bun test tests/perf.test.ts

# Run with custom vault
BRAIN_ROOT=/path/to/vault bun run dev
```

## Performance Targets

| Operation | Target | Basis |
|-----------|--------|-------|
| Initial scan (1000 notes) | < 10s | perf.test.ts |
| `brain_search` p95 | < 100ms | perf.test.ts |
| `brain_clusters` (1000 nodes) | < 2s | perf.test.ts |
| `brain_map` p95 | < 500ms | perf.test.ts |
