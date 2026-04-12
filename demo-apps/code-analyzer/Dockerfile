# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine AS deps

WORKDIR /app

COPY package.json ./
RUN bun install --frozen-lockfile --production=false

# ---------------------------------------------------------------------------
# Stage 2: Production image
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine AS production

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

USER appuser

ENV PORT=3201
EXPOSE 3201

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3201/health || exit 1

CMD ["bun", "run", "src/index.ts"]
