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

# OCI image label arguments – populated from GitHub Actions environment variables.
# Pass them at build time with --build-arg (see deploy.yml).
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION
ARG IMAGE_SOURCE

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

# OCI image specification labels for container registry / tooling compatibility.
# Values are injected at build time from GitHub Actions.
LABEL org.opencontainers.image.title="mcp-yt-thumbnailer" \
      org.opencontainers.image.description="MCP server for setting YouTube video thumbnails" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.licenses="MIT"

# MCP servers communicate via stdio
CMD ["node", "dist/index.js"]
