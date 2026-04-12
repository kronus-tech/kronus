#!/usr/bin/env bash
# Kronus v5.3 — Local Testing Script
#
# This script tests the Hub + demo apps WITHOUT touching your running daemon
# or the live ~/.claude/mcp.json.
#
# Prerequisites:
#   - Docker Desktop running
#   - Bun installed
#
# Usage:
#   ./scripts/test-local.sh setup    # Start Postgres + Redis + install deps
#   ./scripts/test-local.sh hub      # Start Hub server (foreground)
#   ./scripts/test-local.sh apps     # Start demo apps (foreground)
#   ./scripts/test-local.sh test     # Run curl tests against running Hub
#   ./scripts/test-local.sh down     # Stop Postgres + Redis

set -euo pipefail
cd "$(dirname "$0")/.."

# Safe test paths — NEVER touches ~/.claude/mcp.json
export KRONUS_MCP_JSON_PATH="/tmp/kronus-test-mcp.json"
export KRONUS_HUB_URL="http://localhost:3100"

case "${1:-help}" in
  setup)
    echo "Starting PostgreSQL + Redis via Docker Compose..."
    docker compose up -d
    echo ""
    echo "Waiting for services to be healthy..."
    sleep 3
    docker compose ps
    echo ""
    echo "Installing Hub dependencies..."
    cd hub && bun install
    echo ""
    echo "Pushing DB schema..."
    DATABASE_URL=postgresql://kronus:kronus_dev@localhost:5433/kronus_hub bunx drizzle-kit push
    echo ""
    echo "Seeding dev data..."
    bun run src/db/seed.ts
    echo ""
    echo "Installing demo app dependencies..."
    cd ../demo-apps/smart-scraper && bun install
    cd ../code-analyzer && bun install
    echo ""
    echo "Setup complete! Run:"
    echo "  ./scripts/test-local.sh hub     # Start Hub (port 3100)"
    echo "  ./scripts/test-local.sh apps    # Start demo apps (3200, 3201)"
    echo "  ./scripts/test-local.sh test    # Run smoke tests"
    ;;

  hub)
    echo "Starting Kronus Hub on port 3100..."
    cd hub && bun run dev
    ;;

  apps)
    echo "Starting demo apps..."
    cd demo-apps/smart-scraper && PORT=3200 bun run dev &
    cd demo-apps/code-analyzer && PORT=3201 bun run dev &
    echo "Smart Scraper: http://localhost:3200/health"
    echo "Code Analyzer: http://localhost:3201/health"
    wait
    ;;

  test)
    echo "=== Hub Health ==="
    curl -s http://localhost:3100/health | python3 -m json.tool
    echo ""

    echo "=== Register Test User ==="
    REGISTER=$(curl -s -X POST http://localhost:3100/auth/register \
      -H "Content-Type: application/json" \
      -d '{"email":"test@example.com","name":"Test User","password":"password123"}')
    echo "$REGISTER" | python3 -m json.tool 2>/dev/null || echo "$REGISTER"
    TOKEN=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
    echo ""

    if [ -n "$TOKEN" ]; then
      echo "=== List Apps ==="
      curl -s http://localhost:3100/apps -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null
      echo ""

      echo "=== Register Instance ==="
      curl -s -X POST http://localhost:3100/instances/register \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"public_key":"test-key-placeholder","os":"darwin","kronus_version":"5.3.0"}' | python3 -m json.tool 2>/dev/null
      echo ""

      echo "=== JWKS ==="
      curl -s http://localhost:3100/.well-known/jwks.json | python3 -m json.tool 2>/dev/null
      echo ""

      echo "=== Admin Metrics ==="
      curl -s http://localhost:3100/admin/metrics \
        -H "X-Admin-Key: dev_admin_key_for_testing_only" | python3 -m json.tool 2>/dev/null
      echo ""
    fi

    echo "=== Smart Scraper Health ==="
    curl -s http://localhost:3200/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Not running"
    echo ""

    echo "=== Code Analyzer Health ==="
    curl -s http://localhost:3201/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Not running"
    echo ""

    echo "All smoke tests complete."
    ;;

  down)
    echo "Stopping PostgreSQL + Redis..."
    docker compose down
    echo "Cleaning test files..."
    rm -f /tmp/kronus-test-mcp.json
    echo "Done."
    ;;

  *)
    echo "Kronus v5.3 Local Test Script"
    echo ""
    echo "Usage: $0 {setup|hub|apps|test|down}"
    echo ""
    echo "  setup  — Start Postgres/Redis, install deps, push schema, seed"
    echo "  hub    — Start Hub server on port 3100"
    echo "  apps   — Start demo apps on ports 3200/3201"
    echo "  test   — Run smoke tests against running services"
    echo "  down   — Stop Postgres/Redis, clean up"
    echo ""
    echo "SAFE: Uses KRONUS_MCP_JSON_PATH=/tmp/kronus-test-mcp.json"
    echo "      Never touches ~/.claude/mcp.json or the running daemon"
    ;;
esac
