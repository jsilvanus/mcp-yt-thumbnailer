/**
 * Tests for the MCP tool – with mocked YouTube API and auth.
 */
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

// We need to mock before importing the module under test
jest.mock("../src/youtube/auth", () => ({
  getAuthClient: jest.fn().mockResolvedValue({ mocked: true }),
}));

jest.mock("../src/youtube/thumbnails", () => ({
  uploadThumbnail: jest.fn().mockResolvedValue(undefined),
}));

import { setYoutubeThumbnail } from "../src/mcp/tool";
import { uploadThumbnail } from "../src/youtube/thumbnails";
import { getAuthClient } from "../src/youtube/auth";

const mockUpload = uploadThumbnail as jest.MockedFunction<typeof uploadThumbnail>;
const mockAuth = getAuthClient as jest.MockedFunction<typeof getAuthClient>;

const TEST_TENANT = "tenant-test-001";

async function writeTestImage(p: string): Promise<void> {
  const buf = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
  fs.writeFileSync(p, buf);
}

describe("setYoutubeThumbnail (mocked YouTube API)", () => {
  let testImagePath: string;
  let dedupeStorePath: string;

  beforeEach(async () => {
    const tmpDir = os.tmpdir();
    testImagePath = path.join(tmpDir, `test-img-${Date.now()}.jpg`);
    dedupeStorePath = path.join(tmpDir, `test-dedupe-${Date.now()}.json`);
    await writeTestImage(testImagePath);
    process.env.DEDUPE_STORE_PATH = dedupeStorePath;
    mockUpload.mockClear();
    mockAuth.mockClear();
  });

  afterEach(async () => {
    try { fs.unlinkSync(testImagePath); } catch { /* ignore */ }
    try { fs.unlinkSync(dedupeStorePath); } catch { /* ignore */ }
    delete process.env.DEDUPE_STORE_PATH;
  });

  it("returns error when neither imagePath nor imageUrl is provided", async () => {
    const result = await setYoutubeThumbnail({ tenantId: TEST_TENANT, videoId: "abc123" });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/imagePath or imageUrl/);
  });

  it("returns error when both imagePath and imageUrl are provided", async () => {
    const result = await setYoutubeThumbnail({
      tenantId: TEST_TENANT,
      videoId: "abc123",
      imagePath: testImagePath,
      imageUrl: "https://example.com/img.jpg",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/either/i);
  });

  it("returns error for empty videoId", async () => {
    const result = await setYoutubeThumbnail({
      tenantId: TEST_TENANT,
      videoId: "",
      imagePath: testImagePath,
    });
    expect(result.success).toBe(false);
  });

  it("returns error for empty tenantId", async () => {
    const result = await setYoutubeThumbnail({
      tenantId: "",
      videoId: "abc123",
      imagePath: testImagePath,
    });
    expect(result.success).toBe(false);
  });

  it("uploads thumbnail from local file and returns success", async () => {
    const result = await setYoutubeThumbnail({
      tenantId: TEST_TENANT,
      videoId: "vid_upload_test",
      imagePath: testImagePath,
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe("Thumbnail uploaded successfully");
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockAuth).toHaveBeenCalledWith(TEST_TENANT);
  });

  it("skips upload when same thumbnail is sent twice (dedupe)", async () => {
    await setYoutubeThumbnail({ tenantId: TEST_TENANT, videoId: "vid_dedup", imagePath: testImagePath });
    mockUpload.mockClear();

    const result = await setYoutubeThumbnail({
      tenantId: TEST_TENANT,
      videoId: "vid_dedup",
      imagePath: testImagePath,
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe("Thumbnail unchanged, skipped upload");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("does not deduplicate across different tenants for the same video", async () => {
    await setYoutubeThumbnail({ tenantId: "tenant-a", videoId: "vid_cross_tenant", imagePath: testImagePath });
    mockUpload.mockClear();

    const result = await setYoutubeThumbnail({
      tenantId: "tenant-b",
      videoId: "vid_cross_tenant",
      imagePath: testImagePath,
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe("Thumbnail uploaded successfully");
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("re-uploads when image content changes", async () => {
    await setYoutubeThumbnail({ tenantId: TEST_TENANT, videoId: "vid_change", imagePath: testImagePath });

    // Write a different image
    const buf2 = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    fs.writeFileSync(testImagePath, buf2);
    mockUpload.mockClear();

    const result = await setYoutubeThumbnail({
      tenantId: TEST_TENANT,
      videoId: "vid_change",
      imagePath: testImagePath,
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe("Thumbnail uploaded successfully");
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("cleans up temp file even when upload fails", async () => {
    mockUpload.mockRejectedValueOnce(new Error("API error"));
    const tempFiles: string[] = [];

    // Track temp files created in os.tmpdir
    const origWriteFile = fs.promises.writeFile;
    jest.spyOn(fs.promises, "writeFile").mockImplementation(async (p, ...args) => {
      if (typeof p === "string" && p.includes("yt-thumb-")) {
        tempFiles.push(p);
      }
      return origWriteFile(p as string, ...args);
    });

    await setYoutubeThumbnail({ tenantId: TEST_TENANT, videoId: "vid_fail", imagePath: testImagePath });

    jest.restoreAllMocks();

    // All temp files should have been deleted
    for (const f of tempFiles) {
      expect(fs.existsSync(f)).toBe(false);
    }
  });
});
