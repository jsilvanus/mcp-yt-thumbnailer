# mcp-yt-thumbnailer

A production-ready **MCP (Model Context Protocol) server** that lets ChatGPT (or any MCP client) set YouTube video thumbnails from either a local file or an image URL.

Supports **multiple tenants**: each user authenticates independently via a web OAuth2 flow and receives a personal `tenantId` that is passed with every tool call.

---

## 1. Overview

`mcp-yt-thumbnailer` exposes a single MCP tool, `set_youtube_thumbnail`, which:

- Accepts a **tenantId** (identifying the authenticated user)
- Accepts a **local file path** or an **image URL**
- Resizes + converts the image to a YouTube-compatible JPEG (1280×720, ≤ 2 MB)
- **Skips re-uploads** if the thumbnail hasn't changed (SHA-256 deduplication, scoped per tenant)
- Authenticates via **Google OAuth2** and auto-refreshes tokens
- Cleans up all temporary files in a `try/finally` block
- Protects against **SSRF** when downloading remote images

Alongside the MCP server, an **Express HTTP server** runs on a configurable port to handle the Google OAuth2 redirect flow.

---

## ChatGPT Compatibility

To use this MCP server from ChatGPT as a **remote MCP endpoint**, you need:

1. A publicly reachable **HTTPS** URL (no self-signed certs)
2. MCP server running in **Streamable HTTP** mode (`MCP_TRANSPORT=http`)
3. Reverse proxy support for `POST/GET/DELETE /mcp` with SSE buffering disabled
4. OAuth callback URL set in Google Cloud to `{SERVER_BASE_URL}/auth/callback`
5. A way for operators to verify reachability (`/healthz`) and metadata (`/.well-known/mcp.json`)

### Implementation Plan (ChatGPT Compatibility)

This is the implementation sequence used to make compatibility robust in production:

1. **Protocol and endpoint readiness**
  - Keep MCP transport on `streamable-http`
  - Ensure `/mcp` supports `POST`, `GET`, `DELETE`, and `OPTIONS`
  - Add CORS/preflight headers for broader client compatibility

2. **Discovery and diagnostics**
  - Add `GET /.well-known/mcp.json` for machine-readable server metadata
  - Add `GET /healthz` for deployment/liveness checks
  - Expose both paths through nginx

3. **Auth UX and tooling**
  - Keep `start_youtube_auth` and `check_youtube_auth_status` as first-class MCP tools
  - Document the tenant bootstrap flow for ChatGPT users
  - Validate that callback pages and tool responses are user-friendly

4. **Operational hardening**
  - Add integration tests for remote MCP HTTP flow in containerized deploys
  - Add structured request correlation IDs for MCP and OAuth requests
  - Add rate limiting and abuse controls around `/mcp` when exposed publicly

5. **Release readiness**
  - Provide copy-paste ChatGPT onboarding instructions
  - Add smoke-check script for `/healthz`, `/.well-known/mcp.json`, and `/mcp`
  - Tag and deploy after verification in a staging domain

### Implemented in this iteration

- Added `GET /healthz`
- Added `GET /.well-known/mcp.json`
- Added `/mcp` preflight (`OPTIONS`) and compatibility response headers
- Updated nginx template to proxy `/.well-known/mcp.json` and `/healthz`

---

## 2. Setup

### Prerequisites

- Node.js 20+
- npm 10+

### Install dependencies

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in your Google credentials:

```bash
cp .env.example .env
```

| Variable              | Required | Description                                                    |
|-----------------------|----------|----------------------------------------------------------------|
| `GOOGLE_CLIENT_ID`    | ✅        | OAuth2 client ID from Google Cloud Console                     |
| `GOOGLE_CLIENT_SECRET`| ✅        | OAuth2 client secret                                           |
| `SERVER_BASE_URL`     | optional | Public base URL of this server (default: `http://localhost:3000`). Used to build the OAuth2 redirect URI. |
| `PORT`                | optional | HTTP port for the OAuth2 redirect server (default: `3000`)     |
| `TOKENS_DIR`          | optional | Directory where per-tenant token files are stored (default: `.tokens`) |
| `DEDUPE_STORE_PATH`   | optional | Path to dedup metadata store (default: `dedupe-store.json`)    |

---

## 3. Google OAuth2 Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **YouTube Data API v3**: *APIs & Services → Enable APIs → search "YouTube Data API v3"*
4. Go to *APIs & Services → Credentials → Create Credentials → OAuth client ID*
5. Choose **Web application** as the application type
6. Add `{SERVER_BASE_URL}/auth/callback` as an **Authorized redirect URI**  
   (e.g. `http://localhost:3000/auth/callback` for local development)
7. Note your **Client ID** and **Client Secret** — add them to `.env`

---

## 4. Multi-Tenant Authentication Flow

Each user must authenticate once before using the tool. The server manages a separate token file per tenant.

### Step 1 – Start the auth flow

Open the following URL in a browser:

```
http://localhost:3000/auth/start
```

The server generates a unique `tenantId`, stores a pending session, and immediately redirects to the Google consent screen.

### Step 2 – Authorize

Approve the YouTube permissions. Google redirects back to `/auth/callback`.

### Step 3 – Note the Tenant ID

On the callback success page you will see a **Tenant ID**, for example:

```
550e8400-e29b-41d4-a716-446655440000
```

Save this value — it is what the agent must pass in every `set_youtube_thumbnail` call.

### Step 4 – Check authentication status (optional)

```
GET /auth/status?tenantId=550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{ "tenantId": "550e8400-e29b-41d4-a716-446655440000", "authenticated": true }
```

---

## 5. Running Locally

### Development mode

```bash
npm run dev
```

Both the MCP stdio server and the OAuth HTTP server start together.

---

## 6. MCP Usage

### Tool: `set_youtube_thumbnail`

| Parameter   | Type   | Required | Description                                          |
|-------------|--------|----------|------------------------------------------------------|
| `tenantId`  | string | ✅        | Tenant ID obtained from `/auth/start`                |
| `videoId`   | string | ✅        | YouTube video ID                                     |
| `imagePath` | string | one of   | Absolute local file path                             |
| `imageUrl`  | string | one of   | HTTP/HTTPS URL to an image                           |

Exactly **one** of `imagePath` or `imageUrl` must be provided.

### Examples

**Set thumbnail from a local file:**
```json
{
  "tool": "set_youtube_thumbnail",
  "arguments": {
    "tenantId": "550e8400-e29b-41d4-a716-446655440000",
    "videoId": "dQw4w9WgXcQ",
    "imagePath": "/home/user/thumbnails/my-thumb.png"
  }
}
```
Response:
```json
{
  "success": true,
  "message": "Thumbnail uploaded successfully",
  "details": { "tenantId": "550e8400-...", "videoId": "dQw4w9WgXcQ", "hash": "a1b2c3..." }
}
```

**Set thumbnail from a URL:**
```json
{
  "tool": "set_youtube_thumbnail",
  "arguments": {
    "tenantId": "550e8400-e29b-41d4-a716-446655440000",
    "videoId": "dQw4w9WgXcQ",
    "imageUrl": "https://example.com/thumbnail.jpg"
  }
}
```

**Tenant not authenticated:**
```json
{
  "success": false,
  "message": "Failed to set thumbnail",
  "details": "Tenant \"550e8400-...\" is not authenticated. Please complete the OAuth2 flow by visiting /auth/start."
}
```

---

## 7. CI/CD

### CI workflow (`.github/workflows/ci.yml`)

Triggers on every push and pull request. Steps:

1. Checkout code
2. Setup Node.js 20
3. `npm ci` — install dependencies
4. `npm run lint` — ESLint
5. `npm run typecheck` — TypeScript type check
6. `npm test` — Jest tests (image processing, hash, dedupe, mock YouTube API)
7. `npm run build` — TypeScript compilation

### Deployment via tags

Push a semver tag to trigger the deploy workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## 8. Deployment

### Required GitHub Secrets

| Secret                | Description                              |
|-----------------------|------------------------------------------|
| `SSH_HOST`            | VM hostname or IP                        |
| `SSH_USER`            | SSH username                             |
| `SSH_PRIVATE_KEY`     | Private key for SSH authentication       |
| `GHCR_TOKEN`          | PAT with `read:packages` for the deploy host |
| `GOOGLE_CLIENT_ID`    | Google OAuth2 client ID                  |
| `GOOGLE_CLIENT_SECRET`| Google OAuth2 client secret              |
| `SERVER_BASE_URL`     | Public base URL (e.g. `https://your-server.example.com`) |

### Optional GitHub Variables

| Variable              | Default                         | Description |
|-----------------------|---------------------------------|-------------|
| `APP_PORT`            | `3000`                          | Host port bound by Docker Compose |
| `PORT`                | `3000`                          | Container port exposed by the app |
| `DEPLOY_PATH`         | `/srv/mcp-yt-thumbnailer`       | Remote directory that receives the deploy bundle |
| `MCP_TRANSPORT`       | `http`                          | Transport used in the deployed container |
| `TOKENS_DIR`          | `/data/tokens`                  | Persistent token directory inside the container |
| `DEDUPE_STORE_PATH`   | `/data/dedupe-store.json`       | Persistent dedupe store inside the container |
| `SSH_PORT`            | `22`                            | SSH port for the deploy host |
| `GHCR_USERNAME`       | repository owner                | Username paired with `GHCR_TOKEN` for `docker login` |

### VM Setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Create data directory for persistent volumes
mkdir -p /srv/mcp-yt-thumbnailer/data/tokens
```

The deploy workflows copy `deploy/docker-compose.yml` plus a generated app env file to the target host, then run `docker compose pull && docker compose up -d --remove-orphans`.

### Docker Runtime

```bash
docker run -d \
  --name mcp-yt-thumbnailer \
  --restart unless-stopped \
  -p 3000:3000 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e SERVER_BASE_URL=https://your-server.example.com \
  -e TOKENS_DIR=/data/tokens \
  -e DEDUPE_STORE_PATH=/data/dedupe-store.json \
  -v /srv/mcp-yt-thumbnailer/data:/data \
  ghcr.io/<owner>/<repo>:v1.0.0
```

**Note:** Each tenant authenticates by visiting `https://your-server.example.com/auth/start` and saving the displayed Tenant ID.

### Building the image locally

```bash
docker build -t mcp-yt-thumbnailer .
docker run --rm \
  -p 3000:3000 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -v $(pwd)/data:/data \
  mcp-yt-thumbnailer
```

---

## 9. Storage

| Path                                    | Purpose                                                        |
|-----------------------------------------|----------------------------------------------------------------|
| `{TOKENS_DIR}/{tenantId}.tokens.json`   | Per-tenant Google OAuth2 access + refresh tokens              |
| `{DEDUPE_STORE_PATH}`                   | SHA-256 hash per `{tenantId}:{videoId}` — prevents re-uploading identical thumbnails |

Both are created automatically and must be persisted between container restarts (mount as a Docker volume).

---

## Project Structure

```
src/
  index.ts              — MCP server + Express server entry point
  mcp/
    tool.ts             — set_youtube_thumbnail tool implementation
  server/
    express.ts          — Express app factory + OAuth server startup
    routes/
      auth.ts           — /auth/start, /auth/callback, /auth/status routes
  youtube/
    auth.ts             — Multi-tenant Google OAuth2 authentication
    thumbnails.ts       — YouTube thumbnails.set API call
  image/
    processor.ts        — Image fetch, resize, JPEG conversion
  dedupe/
    store.ts            — SHA-256 hashing + JSON dedup store (keyed by tenantId:videoId)
  utils/
    ssrf.ts             — SSRF protection for URL downloads
    logger.ts           — Structured JSON logger
tests/
  image.test.ts         — Image processing tests
  dedupe.test.ts        — Hash + dedup store tests
  tool.test.ts          — MCP tool tests (mocked YouTube API)
```
