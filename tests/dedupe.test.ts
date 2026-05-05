/**
 * Tests for dedupe module.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { computeHash, checkAndUpdateDedupe } from "../src/dedupe/store";

function makeTempStore(): string {
  return path.join(os.tmpdir(), `dedupe-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe("computeHash", () => {
  it("returns a 64-character hex string", () => {
    const buf = Buffer.from("hello world");
    const hash = computeHash(buf);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for identical buffers", () => {
    const buf = Buffer.from("same content");
    expect(computeHash(buf)).toBe(computeHash(buf));
  });

  it("returns different hashes for different buffers", () => {
    expect(computeHash(Buffer.from("a"))).not.toBe(computeHash(Buffer.from("b")));
  });
});

describe("checkAndUpdateDedupe", () => {
  it("returns false (proceed) for a new videoId", async () => {
    const store = makeTempStore();
    const skip = await checkAndUpdateDedupe("vid1", "hash1", store);
    expect(skip).toBe(false);
    fs.unlinkSync(store);
  });

  it("returns true (skip) when same hash uploaded again", async () => {
    const store = makeTempStore();
    await checkAndUpdateDedupe("vid2", "hash2", store);
    const skip = await checkAndUpdateDedupe("vid2", "hash2", store);
    expect(skip).toBe(true);
    fs.unlinkSync(store);
  });

  it("returns false (proceed) when hash changes for same videoId", async () => {
    const store = makeTempStore();
    await checkAndUpdateDedupe("vid3", "hash_old", store);
    const skip = await checkAndUpdateDedupe("vid3", "hash_new", store);
    expect(skip).toBe(false);
    fs.unlinkSync(store);
  });

  it("persists state across instances", async () => {
    const store = makeTempStore();
    await checkAndUpdateDedupe("vid4", "persistedHash", store);

    // Simulate a second run by reading the store fresh
    const raw = fs.readFileSync(store, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed["vid4"].hash).toBe("persistedHash");
    fs.unlinkSync(store);
  });

  it("updates stored hash when hash differs", async () => {
    const store = makeTempStore();
    await checkAndUpdateDedupe("vid5", "hash_a", store);
    await checkAndUpdateDedupe("vid5", "hash_b", store);

    const raw = fs.readFileSync(store, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed["vid5"].hash).toBe("hash_b");
    fs.unlinkSync(store);
  });
});
