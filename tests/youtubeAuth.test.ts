/**
 * Tests for src/youtube/auth.ts (validateTenantId, getTokensPath, generateAuthUrl, hasTokens).
 */
import fs from "fs";
import os from "os";
import path from "path";

// Mock googleapis before importing auth
jest.mock("googleapis", () => {
  const mockGetToken = jest.fn().mockResolvedValue({ tokens: { access_token: "tok" } });
  const mockGenerateAuthUrl = jest.fn(
    () => "https://accounts.google.com/o/oauth2/auth?mock=1"
  );
  const OAuth2 = jest.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    setCredentials: jest.fn(),
    credentials: {},
  }));

  return {
    google: {
      auth: { OAuth2 },
    },
    Auth: {},
  };
});

import {
  validateTenantId,
  getTokensPath,
  generateAuthUrl,
  hasTokens,
} from "../src/youtube/auth";

const VALID_UUID = "12345678-1234-4234-a234-123456789abc";
const ANOTHER_UUID = "87654321-4321-4321-b321-abcdef012345";

describe("validateTenantId", () => {
  it("accepts a valid UUID v4", () => {
    expect(() => validateTenantId(VALID_UUID)).not.toThrow();
  });

  it("accepts uppercase UUID v4", () => {
    expect(() => validateTenantId(VALID_UUID.toUpperCase())).not.toThrow();
  });

  it("throws for an empty string", () => {
    expect(() => validateTenantId("")).toThrow(/Invalid tenantId/);
  });

  it("throws for a non-UUID string", () => {
    expect(() => validateTenantId("not-a-uuid")).toThrow(/Invalid tenantId/);
  });

  it("throws for a UUID v1 (version digit is 1)", () => {
    expect(() =>
      validateTenantId("12345678-1234-1234-a234-123456789abc")
    ).toThrow(/Invalid tenantId/);
  });

  it("throws when variant bits are wrong (must be 8, 9, a, or b)", () => {
    // variant digit is 'c' — invalid for UUID v4
    expect(() =>
      validateTenantId("12345678-1234-4234-c234-123456789abc")
    ).toThrow(/Invalid tenantId/);
  });

  it("throws for path traversal attempt", () => {
    expect(() => validateTenantId("../../etc/passwd")).toThrow(/Invalid tenantId/);
  });
});

describe("getTokensPath", () => {
  it("returns a path ending with <tenantId>.tokens.json", () => {
    const p = getTokensPath(VALID_UUID);
    expect(p).toMatch(/12345678-1234-4234-a234-123456789abc\.tokens\.json$/);
  });

  it("uses TOKENS_DIR env var when set", () => {
    process.env.TOKENS_DIR = "/custom/tokens";
    const p = getTokensPath(VALID_UUID);
    expect(p.startsWith("/custom/tokens")).toBe(true);
    delete process.env.TOKENS_DIR;
  });

  it("throws for an invalid tenantId", () => {
    expect(() => getTokensPath("bad-id")).toThrow(/Invalid tenantId/);
  });
});

describe("generateAuthUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  });

  it("returns a URL string", () => {
    const url = generateAuthUrl(VALID_UUID);
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });

  it("throws when GOOGLE_CLIENT_ID is missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => generateAuthUrl(VALID_UUID)).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("throws when GOOGLE_CLIENT_SECRET is missing", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => generateAuthUrl(VALID_UUID)).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});

describe("hasTokens", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
    process.env.TOKENS_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.TOKENS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when no token file exists", async () => {
    const result = await hasTokens(VALID_UUID);
    expect(result).toBe(false);
  });

  it("returns true when a token file exists", async () => {
    const tokenFile = path.join(tmpDir, `${VALID_UUID}.tokens.json`);
    fs.writeFileSync(tokenFile, JSON.stringify({ access_token: "t" }));
    const result = await hasTokens(VALID_UUID);
    expect(result).toBe(true);
  });

  it("returns false for a different tenantId even if one file exists", async () => {
    const tokenFile = path.join(tmpDir, `${VALID_UUID}.tokens.json`);
    fs.writeFileSync(tokenFile, JSON.stringify({ access_token: "t" }));
    const result = await hasTokens(ANOTHER_UUID);
    expect(result).toBe(false);
  });
});
