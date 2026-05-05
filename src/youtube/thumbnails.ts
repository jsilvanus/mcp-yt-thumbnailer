/**
 * YouTube API integration – thumbnails.set
 */
import fs from "fs";
import { google, Auth } from "googleapis";
import { logger } from "../utils/logger.js";

export async function uploadThumbnail(
  authClient: Auth.OAuth2Client,
  videoId: string,
  tempPath: string
): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth: authClient });

  logger.info("Uploading thumbnail to YouTube", { videoId });

  await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType: "image/jpeg",
      body: fs.createReadStream(tempPath),
    },
  });

  logger.info("Thumbnail uploaded successfully", { videoId });
}
