# MCP Integration

## Overview

Kronus can integrate with MCP (Model Context Protocol) servers to extend agent capabilities with external tools and data sources.

## Configuration

MCP servers are configured in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "env": {
        "API_KEY": "${ENV_VARIABLE}"
      }
    }
  }
}
```

## Included Template

The project includes a `.mcp.json` template with GitHub and filesystem server configurations. Update the environment variables before use.

## Example Configurations

### GitHub
Access GitHub repos, issues, PRs, and actions:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Setup:** Create a GitHub personal access token with `repo` scope and set it as `GITHUB_TOKEN` environment variable.

### Sentry
Access error tracking and monitoring data:

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_AUTH_TOKEN": "${SENTRY_AUTH_TOKEN}",
        "SENTRY_ORG": "${SENTRY_ORG}"
      }
    }
  }
}
```

### PostgreSQL
Direct database access for agents:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
    }
  }
}
```

### Playwright
Browser automation for testing:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-playwright"]
    }
  }
}
```

### Filesystem
Extended file access beyond the working directory:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}/projects"]
    }
  }
}
```

## Using MCP with Agents

Once configured, MCP tools are automatically available to agents. Agents with the appropriate tools in their frontmatter can use MCP-provided capabilities.

For example, with the GitHub MCP server configured, the **code-reviewer** agent can directly access PR data, and the **ci-commenter** can post comments to GitHub.

## Example Config Files

See `examples/mcp-configs/` for ready-to-use configurations:
- `github.json` — GitHub integration
- `sentry.json` — Sentry error tracking
- `postgres.json` — PostgreSQL database
- `playwright.json` — Browser automation

## Combining MCP Servers

You can configure multiple MCP servers in a single `.mcp.json`:

```json
{
  "mcpServers": {
    "github": { ... },
    "sentry": { ... },
    "postgres": { ... }
  }
}
```
