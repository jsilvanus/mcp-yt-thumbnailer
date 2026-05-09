/**
 * Express application for the OAuth2 redirect server.
 * This server runs alongside the MCP stdio server and handles
 * the Google OAuth2 web redirect flow for multi-tenant authentication.
 */
import express, { Application } from "express";
import { authRouter } from "./routes/auth.js";
import { logger } from "../utils/logger.js";

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
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "mcp-yt-thumbnailer" });
  });
  app.get("/.well-known/mcp.json", (_req, res) => {
    res.json(buildMcpDiscoveryDocument());
  });
  app.use("/auth", authRouter);
  return app;
}

export function startExpressServer(port: number): void {
  const app = createExpressApp();
  app.listen(port, () => {
    logger.info(`OAuth redirect server listening`, { port });
  });
}
