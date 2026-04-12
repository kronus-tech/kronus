---
name: hub-status
description: Quick health check on the Kronus Hub server — API status, connected instances, app registry count, relay health
model: haiku
context: fork
allowed-tools: Read, Bash, Glob
triggers:
  - hub status
  - check hub
  - marketplace status
  - hub health
---

Check the health of the Kronus Hub server.

## Steps

1. Read hub/.env or hub/.env.example to find the HUB_URL (default: http://localhost:3100)
2. Run: `curl -s {HUB_URL}/health` and parse the JSON response
3. Run: `curl -s {HUB_URL}/admin/metrics` (if available) for instance/app counts
4. Report:
   - Hub status (up/down)
   - Version
   - Connected instances count
   - Published apps count
   - Relay status
   - Any errors or warnings

## Output Format

```markdown
## Hub Status

- **Status:** Healthy / Unreachable
- **Version:** 5.3.0
- **Uptime:** ...
- **Instances:** N connected
- **Apps:** N published
- **Relay:** active/inactive
```

If the Hub is not running, suggest: `cd hub && bun run dev`
