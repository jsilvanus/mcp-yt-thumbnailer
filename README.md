# mcp-yt-thumbnailer

A production-ready **MCP (Model Context Protocol) server** that lets ChatGPT (or any MCP client) set YouTube video thumbnails from either a local file or an image URL.

---

## 1. Overview

`mcp-yt-thumbnailer` exposes a single MCP tool, `set_youtube_thumbnail`, which:

- Accepts a **local file path** or an **image URL**
- Resizes + converts the image to a YouTube-compatible JPEG (1280×720, ≤ 2 MB)
- **Skips re-uploads** if the thumbnail hasn't changed (SHA-256 deduplication)
- Authenticates via **Google OAuth2** and auto-refreshes tokens
- Cleans up all temporary files in a `try/finally` block
- Protects against **SSRF** when downloading remote images

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

| Variable              | Required | Description                                 |
|-----------------------|----------|---------------------------------------------|
| `GOOGLE_CLIENT_ID`    | ✅        | OAuth2 client ID from Google Cloud Console  |
| `GOOGLE_CLIENT_SECRET`| ✅        | OAuth2 client secret                        |
| `GOOGLE_REDIRECT_URI` | optional | Defaults to `urn:ietf:wg:oauth:2.0:oob`    |
| `TOKENS_PATH`         | optional | Path to store OAuth2 tokens (default: `.tokens.json`) |
| `DEDUPE_STORE_PATH`   | optional | Path to dedup metadata store (default: `dedupe-store.json`) |

---

## 3. Google OAuth2 Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **YouTube Data API v3**: *APIs & Services → Enable APIs → search "YouTube Data API v3"*
4. Go to *APIs & Services → Credentials → Create Credentials → OAuth client ID*
5. Choose **Desktop app** as the application type
6. Note your **Client ID** and **Client Secret** — add them to `.env`
7. Set `GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob` for CLI-based auth

---

## 4. Running Locally

### Development mode

```bash
npm run dev
```

### First-time auth flow

On first run the server will print an authorization URL:

```
=== YouTube OAuth2 Setup ===
Open this URL in your browser and authorize the application:

https://accounts.google.com/o/oauth2/auth?...

Enter the authorization code:
```

1. Open the URL in your browser
2. Authorize the app
3. Copy the code shown and paste it into the terminal
4. Tokens are saved to `.tokens.json` — subsequent runs load them automatically

### Subsequent runs

Tokens are loaded from `.tokens.json` and auto-refreshed when expired. No manual intervention needed.

---

## 5. MCP Usage

### Tool: `set_youtube_thumbnail`

| Parameter   | Type   | Required | Description                       |
|-------------|--------|----------|-----------------------------------|
| `videoId`   | string | ✅        | YouTube video ID                  |
| `imagePath` | string | one of   | Absolute local file path          |
| `imageUrl`  | string | one of   | HTTP/HTTPS URL to an image        |

Exactly **one** of `imagePath` or `imageUrl` must be provided.

### Examples

**Set thumbnail from a local file:**
```json
{
  "tool": "set_youtube_thumbnail",
  "arguments": {
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
  "details": { "videoId": "dQw4w9WgXcQ", "hash": "a1b2c3..." }
}
```

**Set thumbnail from a URL:**
```json
{
  "tool": "set_youtube_thumbnail",
  "arguments": {
    "videoId": "dQw4w9WgXcQ",
    "imageUrl": "https://example.com/thumbnail.jpg"
  }
}
```

**Skipped upload (dedup case – same image sent twice):**
```json
{
  "success": true,
  "message": "Thumbnail unchanged, skipped upload",
  "details": { "videoId": "dQw4w9WgXcQ", "hash": "a1b2c3..." }
}
```

---

## 6. CI/CD

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

## 7. Deployment

### Required GitHub Secrets

| Secret                | Description                              |
|-----------------------|------------------------------------------|
| `SSH_HOST`            | VM hostname or IP                        |
| `SSH_USER`            | SSH username                             |
| `SSH_PRIVATE_KEY`     | Private key for SSH authentication       |
| `GOOGLE_CLIENT_ID`    | Google OAuth2 client ID                  |
| `GOOGLE_CLIENT_SECRET`| Google OAuth2 client secret              |
| `GOOGLE_REDIRECT_URI` | OAuth2 redirect URI                      |

### VM Setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Create data directory for persistent volumes
mkdir -p /srv/mcp-yt-thumbnailer/data
```

### Docker Runtime

The deploy workflow automatically:
1. Builds the image and pushes to `ghcr.io/<owner>/<repo>:<tag>`
2. SSHes into the VM and runs:

```bash
docker pull ghcr.io/<owner>/<repo>:v1.0.0
docker stop mcp-yt-thumbnailer
docker rm mcp-yt-thumbnailer
docker run -d \
  --name mcp-yt-thumbnailer \
  --restart unless-stopped \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_REDIRECT_URI=... \
  -v /srv/mcp-yt-thumbnailer/data:/data \
  ghcr.io/<owner>/<repo>:v1.0.0
```

**Note:** Before first deploy, run the auth flow manually on the VM to populate `/srv/mcp-yt-thumbnailer/data/.tokens.json`.

### Building the image locally

```bash
docker build -t mcp-yt-thumbnailer .
docker run --rm \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -v $(pwd)/data:/data \
  mcp-yt-thumbnailer
```

---

## 8. Storage

| File                           | Purpose                                     |
|--------------------------------|---------------------------------------------|
| `.tokens.json` (or `TOKENS_PATH`) | Google OAuth2 access + refresh tokens   |
| `dedupe-store.json` (or `DEDUPE_STORE_PATH`) | SHA-256 hash per video ID — prevents re-uploading identical thumbnails |

Both files are created automatically on first use and must be persisted between container restarts (mount as a Docker volume).

---

## Project Structure

```
src/
  index.ts          — MCP server entry point
  mcp/
    tool.ts         — set_youtube_thumbnail tool implementation
  youtube/
    auth.ts         — Google OAuth2 authentication
    thumbnails.ts   — YouTube thumbnails.set API call
  image/
    processor.ts    — Image fetch, resize, JPEG conversion
  dedupe/
    store.ts        — SHA-256 hashing + JSON dedup store
  utils/
    ssrf.ts         — SSRF protection for URL downloads
    logger.ts       — Structured JSON logger
tests/
  image.test.ts     — Image processing tests
  dedupe.test.ts    — Hash + dedup store tests
  tool.test.ts      — MCP tool tests (mocked YouTube API)
```
