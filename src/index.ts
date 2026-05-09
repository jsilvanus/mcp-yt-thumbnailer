/**
 * MCP Server entry point.
 * Registers the set_youtube_thumbnail tool and starts the server.
 * Also starts the Express OAuth2 redirect server for multi-tenant auth.
 *
 * Transport selection (via MCP_TRANSPORT env var):
 *   stdio (default) – stdio transport for local Claude Desktop usage.
 *   http            – Streamable-HTTP transport at /mcp, behind nginx/HTTPS.
 *                     Both /mcp (MCP) and /auth (OAuth2) share the same port.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { setYoutubeThumbnail } from "./mcp/tool.js";
import { startYoutubeAuth, checkYoutubeAuthStatus } from "./mcp/authTool.js";
import { startExpressServer, createExpressApp } from "./server/express.js";
import { logger } from "./utils/logger.js";

const OAUTH_PORT = parseInt(process.env.PORT ?? "3000", 10);
const MCP_TRANSPORT = process.env.MCP_TRANSPORT ?? "stdio";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-yt-thumbnailer",
    version: "1.0.0",
  });

  server.tool(
    "start_youtube_auth",
    "Start the YouTube OAuth2 authentication flow. Returns an authorization URL to open in a browser and a tenantId to use in subsequent tool calls.",
    {},
    async () => {
      try {
        const result = await startYoutubeAuth();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("start_youtube_auth failed", { error: message });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, message }, null, 2),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "check_youtube_auth_status",
    "Check whether a tenant has completed the YouTube OAuth2 authentication flow.",
    {
      tenantId: z
        .string()
        .describe("The tenantId returned by start_youtube_auth"),
    },
    async (args) => {
      try {
        const result = await checkYoutubeAuthStatus(args.tenantId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, message }, null, 2),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "set_youtube_thumbnail",
    "Set a YouTube video thumbnail from a local file or image URL",
    {
      tenantId: z
        .string()
        .describe(
          "Tenant ID obtained after completing the OAuth2 flow at /auth/start"
        ),
      videoId: z.string().describe("The YouTube video ID"),
      imagePath: z
        .string()
        .optional()
        .describe("Absolute path to a local image file"),
      imageUrl: z
        .string()
        .optional()
        .describe("URL of the image to use as thumbnail"),
    },
    async (args) => {
      const result = await setYoutubeThumbnail(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

async function main() {
  if (MCP_TRANSPORT === "http") {
    // HTTP Streaming transport – deployed behind nginx/HTTPS.
    // The /mcp (MCP) and /auth (OAuth2) endpoints share the same Express server
    // on OAUTH_PORT so a single port binding is needed in production.
    const app = createExpressApp();
    const sessionTransports = new Map<string, StreamableHTTPServerTransport>();

    app.use("/mcp", (_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,mcp-session-id");
      next();
    });
    app.options("/mcp", (_req, res) => {
      res.status(204).end();
    });

    app.post("/mcp", express.json(), async (req, res) => {
      try {
        const headerValue = req.headers["mcp-session-id"];
        const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

        if (sessionId) {
          const existingTransport = sessionTransports.get(sessionId);
          if (!existingTransport) {
            res.status(404).json({
              jsonrpc: "2.0",
              error: { code: -32001, message: "Session not found" },
              id: null,
            });
            return;
          }
          await existingTransport.handleRequest(req, res, req.body);
          return;
        }

        let newTransport: StreamableHTTPServerTransport | undefined;
        const server = createMcpServer();

        newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId: string) => {
            if (newTransport) {
              sessionTransports.set(newSessionId, newTransport);
              logger.info("MCP session initialized", { sessionId: newSessionId });
            }
          },
        });

        newTransport.onclose = () => {
          if (newTransport?.sessionId) {
            sessionTransports.delete(newTransport.sessionId);
            logger.info("MCP session closed", { sessionId: newTransport.sessionId });
          }
        };

        await server.connect(newTransport);
        await newTransport.handleRequest(req, res, req.body);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("MCP HTTP POST failed", { error: message });
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    app.get("/mcp", async (req, res) => {
      const headerValue = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

      if (!sessionId) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Missing mcp-session-id header" },
          id: null,
        });
        return;
      }

      const transport = sessionTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res);
    });

    app.delete("/mcp", async (req, res) => {
      const headerValue = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

      if (!sessionId) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Missing mcp-session-id header" },
          id: null,
        });
        return;
      }

      const transport = sessionTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res);
      sessionTransports.delete(sessionId);
    });

    app.listen(OAUTH_PORT, () => {
      logger.info("Server listening", {
        port: OAUTH_PORT,
        endpoints: ["/mcp (MCP streaming)", "/auth (OAuth2)"],
      });
    });

    logger.info("MCP server started (http)");
  } else {
    // Default: stdio transport for local usage.
    startExpressServer(OAUTH_PORT);
    const transport = new StdioServerTransport();
    const server = createMcpServer();
    await server.connect(transport);
    logger.info("MCP server started (stdio)");
  }
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
