/**
 * Tests for image processing module.
 */
import sharp from "sharp";
import { processImageBuffer } from "../src/image/processor";

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("processImageBuffer", () => {
  it("resizes a landscape image to 1280×720", async () => {
    const input = await makeTestImage(2000, 1000);
    const output = await processImageBuffer(input);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
  });

  it("resizes a portrait image to 1280×720 via cover crop", async () => {
    const input = await makeTestImage(400, 800);
    const output = await processImageBuffer(input);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
  });

  it("outputs JPEG format", async () => {
    const input = await makeTestImage(640, 480);
    const output = await processImageBuffer(input);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("output is under 2 MB", async () => {
    const input = await makeTestImage(3840, 2160);
    const output = await processImageBuffer(input);
    expect(output.length).toBeLessThan(2 * 1024 * 1024);
  });
});
