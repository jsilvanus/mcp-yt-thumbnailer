/**
 * Express application for the OAuth2 redirect server.
 * This server runs alongside the MCP stdio server and handles
 * the Google OAuth2 web redirect flow for multi-tenant authentication.
 */
import express, { Application } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { authRouter } from "./routes/auth.js";
import { logger } from "../utils/logger.js";
import { setYoutubeThumbnail } from "../mcp/tool.js";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildMcpDiscoveryDocument() {
  const configuredBaseUrl = process.env.SERVER_BASE_URL;
  const baseUrl =
    typeof configuredBaseUrl === "string" && configuredBaseUrl.length > 0
      ? trimTrailingSlash(configuredBaseUrl)
      : undefined;

  return {
    name: "mcp-yt-thumbnailer",
    version: "1.0.0",
    protocol: "MCP",
    transport: "streamable-http",
    endpoints: {
      mcp: baseUrl ? `${baseUrl}/mcp` : "/mcp",
      authStart: baseUrl ? `${baseUrl}/auth/start` : "/auth/start",
      authStatus: baseUrl ? `${baseUrl}/auth/status` : "/auth/status",
      health: baseUrl ? `${baseUrl}/healthz` : "/healthz",
    },
    tools: [
      "start_youtube_auth",
      "check_youtube_auth_status",
      "set_youtube_thumbnail",
    ],
  };
}

export function createExpressApp(): Application {
  const app = express();
  // Uploads directory for files sent to the server (e.g., by ChatGPT or other clients)
  const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (err) {
    logger.error("Failed to create uploads dir", { uploadsDir, error: String(err) });
  }

  // Multer setup: store uploaded files in the uploads directory with original name
  const storage = multer.diskStorage({
    destination: (req: express.Request, _file: any, cb: (err: Error | null, destination: string) => void) => cb(null, uploadsDir),
    filename: (req: express.Request, file: any, cb: (err: Error | null, filename: string) => void) => cb(null, `${Date.now()}-${file.originalname}`),
  });
  const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB limit
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "mcp-yt-thumbnailer" });
  });
  app.get("/.well-known/mcp.json", (_req, res) => {
    res.json(buildMcpDiscoveryDocument());
  });
  app.use("/auth", authRouter);

  // File upload endpoint: accepts `multipart/form-data` with field `file`.
  // Returns JSON: { success: true, path: "/absolute/path/to/file" }
  app.post("/upload", upload.single("file"), async (req, res) => {
    const r: any = req;
    if (!r.file) {
      res.status(400).json({ success: false, message: "Missing 'file' field" });
      return;
    }

    const fullPath = path.resolve(r.file.path);
    logger.info("File uploaded", { originalName: r.file.originalname, storedPath: fullPath });

    // If tenantId and videoId are provided, attempt to directly set the thumbnail
    const tenantId = typeof r.body?.tenantId === "string" ? r.body.tenantId : undefined;
    const videoId = typeof r.body?.videoId === "string" ? r.body.videoId : undefined;

    if (tenantId && videoId) {
      try {
        const result = await setYoutubeThumbnail({ tenantId, videoId, imagePath: fullPath });
        res.json({ success: result.success, uploadPath: fullPath, result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Upload+set thumbnail failed", { error: message });
        res.status(500).json({ success: false, message: "Failed to set thumbnail", details: message });
      }
      return;
    }

    res.json({ success: true, path: fullPath });
  });
  return app;
}

export function startExpressServer(port: number): void {
  const app = createExpressApp();
  app.listen(port, () => {
    logger.info(`OAuth redirect server listening`, { port });
  });
}
