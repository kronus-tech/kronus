# Brain MCP Usage Rules

When brain-mcp tools are available (brain_search, brain_graph, etc.):

## Prefer brain-mcp for:
- Searching notes: use brain_search instead of filesystem read + grep
- Finding connections: use brain_graph, brain_backlinks, brain_outlinks
- Getting an overview: use brain_map for health score and stats
- Creating notes: use brain_create (auto-indexes, adds frontmatter)

## Keep using filesystem MCP for:
- Reading raw file contents (when you need the full text)
- Writing to non-markdown files
- Accessing paths outside BRAIN_ROOT

## Keep using memory MCP for:
- Session-scoped entity storage
- Conversation-level context that doesn't need to persist as a file

## Layer priority:
1. brain-mcp for note queries and graph traversal
2. filesystem MCP for raw file I/O
3. memory MCP for session entities
