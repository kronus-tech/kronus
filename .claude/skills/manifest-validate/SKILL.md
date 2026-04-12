---
name: manifest-validate
description: Validate a kronus-app.json manifest file against the Kronus marketplace schema — checks required fields, types, MCP tool definitions, and pricing config
model: haiku
context: fork
allowed-tools: Read, Glob, Grep
triggers:
  - validate manifest
  - check app manifest
  - check kronus-app.json
  - manifest validate
---

Validate a kronus-app.json manifest file for marketplace compliance.

## Steps

1. Find the kronus-app.json file:
   - If user specified a path, use that
   - Otherwise, search current directory and demo-apps/*/
2. Read and parse the JSON
3. Validate required fields:
   - name: string, lowercase, no spaces (slug format)
   - display_name: string
   - version: string, semver format (X.Y.Z)
   - description: string, min 20 chars
   - type: one of "developer_mcp", "local_skill", "local_agent", "hybrid"
   - author.name: string
4. Type-specific validation:
   - developer_mcp: requires mcp_url (valid HTTPS URL), mcp.tools array
   - local_skill/local_agent: requires files array with src/dest
   - hybrid: requires both mcp_url and files
5. Optional field validation:
   - pricing.model: one of "free", "one_time", "subscription", "usage"
   - pricing.tiers: each tier needs price (integer cents) and limits
   - categories: array of strings
   - tags: array of strings
   - kronus_min_version: semver format
   - health_check.endpoint: valid HTTPS URL
   - health_check.interval_seconds: positive integer

## Output Format

```markdown
## Manifest Validation: {name}

**Status:** Valid / Invalid

### Errors (must fix)
- [field]: description

### Warnings (should fix)
- [field]: description

### Info
- Type: {type}
- Version: {version}
- Tools: {count} MCP tools defined
- Pricing: {model}
```

Scan $ARGUMENTS path (defaults to current directory or demo-apps/*/).
