/**
 * MCP Server entry point.
 * Registers the set_youtube_thumbnail tool and starts the server.
 * Also starts the Express OAuth2 redirect server for multi-tenant auth.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { setYoutubeThumbnail } from "./mcp/tool.js";
import { startYoutubeAuth, checkYoutubeAuthStatus } from "./mcp/authTool.js";
import { startExpressServer } from "./server/express.js";
import { logger } from "./utils/logger.js";

const OAUTH_PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  // Start the OAuth2 redirect server
  startExpressServer(OAUTH_PORT);

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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server started");
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
