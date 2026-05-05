# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp

WORKDIR /app

# Copy built output and production node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create volume mount points
RUN mkdir -p /data && chown mcp:mcp /data

USER mcp

ENV TOKENS_PATH=/data/.tokens.json
ENV DEDUPE_STORE_PATH=/data/dedupe-store.json
ENV NODE_ENV=production

# MCP servers communicate via stdio
CMD ["node", "dist/index.js"]
