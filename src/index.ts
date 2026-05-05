/**
 * MCP Server entry point.
 * Registers the set_youtube_thumbnail tool and starts the server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { setYoutubeThumbnail } from "./mcp/tool.js";
import { logger } from "./utils/logger.js";

async function main() {
  const server = new McpServer({
    name: "mcp-yt-thumbnailer",
    version: "1.0.0",
  });

  server.tool(
    "set_youtube_thumbnail",
    "Set a YouTube video thumbnail from a local file or image URL",
    {
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
