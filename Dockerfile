# Kronus v5.0 — Telegram Control Plane for Claude Code
#
# Multi-stage build:
#   1. Build dashboard (React + Tailwind)
#   2. Runtime with Bun + Claude Code
#
# Prerequisites:
#   Ensure daemon source is at ./daemon/ (either embedded or cloned):
#   git clone https://github.com/kronus-tech/daemon.git daemon
#
# Usage:
#   docker build -t kronus .
#   docker run -e TELEGRAM_BOT_TOKEN=xxx -e ANTHROPIC_API_KEY=xxx kronus

# ─── Stage 1: Build Dashboard ────────────────────────────────────────────

FROM oven/bun:1 AS dashboard-builder

WORKDIR /build
COPY daemon/dashboard/package.json daemon/dashboard/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY daemon/dashboard/ ./
RUN bun run build

# ─── Stage 2: Runtime ────────────────────────────────────────────────────

FROM oven/bun:1

# Install Node.js (needed for Claude Code CLI) and utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git ca-certificates python3 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create directory structure
RUN mkdir -p /root/.claude/channels/telegram/logs \
    /root/.claude/channels/telegram/transcripts \
    /root/.claude/channels/telegram/scope-approvals \
    /root/.claude/agents \
    /root/.claude/skills \
    /root/.claude/rules \
    /root/.claude/teams \
    /root/.claude/daemon/scripts \
    /root/second-brain/kronus/memory \
    /root/second-brain/kronus/journal \
    /root/second-brain/kronus/usage \
    /root/second-brain/kronus/.claude/rules \
    /root/second-brain/Projects \
    /root/second-brain/Areas \
    /root/second-brain/Resources \
    /root/second-brain/Archive

# Copy agents, skills, rules, teams
COPY .claude/agents/ /root/.claude/agents/
COPY .claude/skills/ /root/.claude/skills/
COPY .claude/rules/ /root/.claude/rules/
COPY .claude/teams/ /root/.claude/teams/

# Copy daemon source
WORKDIR /root/.claude/daemon
COPY daemon/package.json daemon/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY daemon/src/ ./src/
COPY daemon/scripts/ ./scripts/
RUN chmod +x ./scripts/*.sh 2>/dev/null || true

# Copy built dashboard
COPY --from=dashboard-builder /build/dist/ ./dashboard/dist/

# Copy config templates (only if not already mounted via volume)
COPY config/projects.example.json /root/.defaults/projects.json
COPY config/access.example.json /root/.defaults/access.json

# Entrypoint script — copies defaults if configs don't exist
RUN echo '#!/bin/bash\n\
TGDIR=/root/.claude/channels/telegram\n\
[ ! -f "$TGDIR/projects.json" ] && cp /root/.defaults/projects.json "$TGDIR/projects.json"\n\
[ ! -f "$TGDIR/access.json" ] && cp /root/.defaults/access.json "$TGDIR/access.json"\n\
[ -n "$TELEGRAM_BOT_TOKEN" ] && echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN" > "$TGDIR/.env"\n\
exec bun run /root/.claude/daemon/src/index.ts\n' > /entrypoint.sh && chmod +x /entrypoint.sh

# Default personal persona
RUN printf '# Kronus\n\n> Your personal AI assistant.\n\n## Who You Are\n\nYou are **Kronus** — a personal AI assistant. Professional, proactive, cross-project aware.\n\n## Privacy\n\n1. Fully isolated memory\n2. What happens here stays here\n' > /root/second-brain/kronus/.claude/rules/persona.md

# Environment
ENV NODE_ENV=production
ENV HOME=/root

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD curl -sf http://localhost:8420/api/status || exit 1

# Expose dashboard port
EXPOSE 8420

ENTRYPOINT ["/entrypoint.sh"]
