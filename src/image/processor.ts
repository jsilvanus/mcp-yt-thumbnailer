/**
 * Image processing module.
 * Downloads (if URL) or reads (if path) an image, resizes it to 1280×720 JPEG,
 * and ensures the final buffer is < 2 MB.
 */
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import http from "http";
import sharp from "sharp";
import { validateUrl, validateFilePath } from "../utils/ssrf.js";
import { logger } from "../utils/logger.js";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10 MB download limit
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;    // 2 MB final size limit
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;

export interface ProcessedImage {
  buffer: Buffer;
  tempPath: string;
}

/**
 * Fetch a URL to a Buffer, respecting redirects and size limits.
 * SSRF protection is applied before fetching.
 */
async function fetchUrl(rawUrl: string): Promise<Buffer> {
  const parsed = await validateUrl(rawUrl);
  logger.info("Fetching image from URL", { url: parsed.href });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let downloaded = 0;

    const request = (parsed.protocol === "https:" ? https : http).get(
      parsed.href,
      { timeout: 15000 },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          // Follow single redirect
          fetchUrl(res.headers.location)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} fetching image`));
          return;
        }

        res.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (downloaded > MAX_DOWNLOAD_BYTES) {
            request.destroy();
            reject(new Error(`Image URL exceeds max download size (${MAX_DOWNLOAD_BYTES} bytes)`));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Image download timed out"));
    });
  });
}

/**
 * Process an image buffer: resize to 1280×720, convert to JPEG quality 80.
 * Ensures the output is < 2 MB.
 */
export async function processImageBuffer(input: Buffer): Promise<Buffer> {
  const output = await sharp(input)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: "cover",
      position: "center",
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (output.length > MAX_OUTPUT_BYTES) {
    // Retry with lower quality
    const smaller = await sharp(input)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "center" })
      .jpeg({ quality: 60 })
      .toBuffer();
    if (smaller.length > MAX_OUTPUT_BYTES) {
      throw new Error(`Processed image exceeds 2 MB limit (${smaller.length} bytes)`);
    }
    return smaller;
  }

  return output;
}

/**
 * Main entry: fetch/read → process → write temp file.
 * Caller is responsible for deleting tempPath after use.
 */
export async function prepareImage(opts: {
  imagePath?: string;
  imageUrl?: string;
}): Promise<ProcessedImage> {
  let raw: Buffer;

  if (opts.imagePath) {
    const safePath = validateFilePath(opts.imagePath);
    logger.info("Reading image from disk", { path: safePath });
    raw = await fs.promises.readFile(safePath);
  } else if (opts.imageUrl) {
    raw = await fetchUrl(opts.imageUrl);
  } else {
    throw new Error("Either imagePath or imageUrl must be provided");
  }

  logger.info("Processing image");
  const processed = await processImageBuffer(raw);
  logger.info("Image processed", { bytes: processed.length });

  const tmpDir = os.tmpdir();
  const tempPath = path.join(tmpDir, `yt-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  await fs.promises.writeFile(tempPath, processed);

  return { buffer: processed, tempPath };
}
