import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import sharp from "sharp";

// Mock youtube auth and upload so tests are offline
jest.mock("../src/youtube/auth", () => ({
  getAuthClient: jest.fn().mockResolvedValue({ mocked: true }),
  validateTenantId: jest.requireActual("../src/youtube/auth").validateTenantId,
  getTokensPath: jest.requireActual("../src/youtube/auth").getTokensPath,
  generateAuthUrl: jest.fn().mockImplementation((tenantId: string) => `https://example.com/auth?state=${tenantId}`),
}));

jest.mock("../src/youtube/thumbnails", () => ({
  uploadThumbnail: jest.fn().mockResolvedValue(undefined),
}));

import { createExpressApp } from "../src/server/express";
import { startYoutubeAuth } from "../src/mcp/authTool";
import { getTokensPath } from "../src/youtube/auth";
import { uploadThumbnail } from "../src/youtube/thumbnails";

const mockUpload = uploadThumbnail as jest.MockedFunction<typeof uploadThumbnail>;

async function writeTestImage(p: string): Promise<void> {
  const buf = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
  fs.writeFileSync(p, buf);
}

describe("/upload endpoint (integration)", () => {
  let app: any;
  let tmpImage: string;
  let tenantId: string;
  let tokensPath: string;

  beforeEach(async () => {
    app = createExpressApp();
    const tmpDir = os.tmpdir();
    tmpImage = path.join(tmpDir, `upload-test-img-${Date.now()}.jpg`);
    await writeTestImage(tmpImage);

    // Start auth flow to get a tenantId and then create a token file to mark authenticated
    const start = await startYoutubeAuth();
    tenantId = start.tenantId;
    tokensPath = getTokensPath(tenantId);
    await fs.promises.mkdir(path.dirname(tokensPath), { recursive: true });
    await fs.promises.writeFile(tokensPath, JSON.stringify({ access_token: "x" }), "utf-8");

    process.env.DEDUPE_STORE_PATH = path.join(tmpDir, `test-dedupe-${Date.now()}.json`);
  });

  afterEach(async () => {
    try { fs.unlinkSync(tmpImage); } catch { }
    try { fs.unlinkSync(tokensPath); } catch { }
    try { fs.unlinkSync(process.env.DEDUPE_STORE_PATH || ""); } catch { }
    delete process.env.DEDUPE_STORE_PATH;
  });

  it("accepts file, tenantId, videoId and sets thumbnail", async () => {
    const videoId = "video-upload-123";

    const res = await request(app)
      .post("/upload")
      .field("tenantId", tenantId)
      .field("videoId", videoId)
      .attach("file", tmpImage);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("uploadPath");
    expect(res.body).toHaveProperty("result");
    expect(res.body.result).toHaveProperty("success", true);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
});
