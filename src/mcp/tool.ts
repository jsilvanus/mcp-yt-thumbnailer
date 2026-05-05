/**
 * MCP tool: set_youtube_thumbnail
 */
import fs from "fs";
import { z } from "zod";
import { prepareImage } from "../image/processor.js";
import { computeHash, checkAndUpdateDedupe, resolveStorePath } from "../dedupe/store.js";
import { getAuthClient } from "../youtube/auth.js";
import { uploadThumbnail } from "../youtube/thumbnails.js";
import { logger } from "../utils/logger.js";

export const SetYoutubeThumbnailInput = z.object({
  videoId: z.string().min(1, "videoId is required"),
  imagePath: z.string().optional(),
  imageUrl: z.string().optional(),
});

export type SetYoutubeThumbnailInput = z.infer<typeof SetYoutubeThumbnailInput>;

export interface ToolResult {
  success: boolean;
  message: string;
  details?: unknown;
}

export async function setYoutubeThumbnail(
  input: SetYoutubeThumbnailInput
): Promise<ToolResult> {
  // Validate input
  const parsed = SetYoutubeThumbnailInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      details: parsed.error.format(),
    };
  }

  const { videoId, imagePath, imageUrl } = parsed.data;

  if (!imagePath && !imageUrl) {
    return {
      success: false,
      message: "Exactly one of imagePath or imageUrl must be provided",
    };
  }

  if (imagePath && imageUrl) {
    return {
      success: false,
      message: "Provide either imagePath or imageUrl, not both",
    };
  }

  logger.info("set_youtube_thumbnail called", {
    videoId,
    inputType: imagePath ? "file" : "url",
  });

  let tempPath: string | undefined;

  try {
    // Step 1: Prepare (download/read + process) image
    const processed = await prepareImage({ imagePath, imageUrl });
    tempPath = processed.tempPath;

    // Step 2: Compute hash for deduplication
    const hash = computeHash(processed.buffer);

    // Step 3: Check dedupe store
    const storePath = resolveStorePath();
    const skip = await checkAndUpdateDedupe(videoId, hash, storePath);

    if (skip) {
      return {
        success: true,
        message: "Thumbnail unchanged, skipped upload",
        details: { videoId, hash },
      };
    }

    // Step 4: Authenticate + upload
    const authClient = await getAuthClient();
    await uploadThumbnail(authClient, videoId, tempPath);

    return {
      success: true,
      message: "Thumbnail uploaded successfully",
      details: { videoId, hash },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("set_youtube_thumbnail failed", { videoId, error: message });
    return {
      success: false,
      message: "Failed to set thumbnail",
      details: message,
    };
  } finally {
    // Always clean up temp file
    if (tempPath) {
      try {
        await fs.promises.unlink(tempPath);
        logger.info("Temp file deleted", { tempPath });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
