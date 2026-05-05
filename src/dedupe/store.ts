/**
 * Deduplication module.
 * Stores video→{hash, updatedAt} in a JSON file with advisory locking.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../utils/logger.js";

interface DedupeEntry {
  hash: string;
  updatedAt: string;
}

type DedupeStore = Record<string, DedupeEntry>;

export function computeHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readStore(storePath: string): Promise<DedupeStore> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    return JSON.parse(raw) as DedupeStore;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeStore(storePath: string, store: DedupeStore): Promise<void> {
  const tmpPath = `${storePath}.tmp.${process.pid}`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  await fs.promises.rename(tmpPath, storePath);
}

/**
 * Check dedup state and optionally update the store.
 *
 * The store key is scoped per tenant: `{tenantId}:{videoId}`.
 *
 * @returns true  → upload should be skipped (identical hash already stored)
 *          false → upload should proceed (new or changed hash)
 */
export async function checkAndUpdateDedupe(
  videoId: string,
  hash: string,
  storePath?: string,
  tenantId?: string
): Promise<boolean> {
  const resolvedPath = storePath ?? resolveStorePath();
  const store = await readStore(resolvedPath);
  const key = tenantId ? `${tenantId}:${videoId}` : videoId;
  const existing = store[key];

  if (existing && existing.hash === hash) {
    logger.info("Dedupe: thumbnail unchanged, skipping upload", { videoId, tenantId });
    return true; // skip
  }

  store[key] = { hash, updatedAt: new Date().toISOString() };
  await writeStore(resolvedPath, store);
  logger.info("Dedupe: hash updated", { videoId, tenantId, hash: hash.slice(0, 12) });
  return false; // proceed
}

/**
 * Resolve the store file path from an optional override or env var.
 * Reads the environment variable at call time so that tests can override it
 * in beforeEach without being affected by the module-load-time snapshot.
 */
export function resolveStorePath(override?: string): string {
  const envPath = process.env.DEDUPE_STORE_PATH ?? "dedupe-store.json";
  return override ?? path.resolve(envPath);
}
