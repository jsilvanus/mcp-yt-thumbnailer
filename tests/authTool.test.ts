/**
 * Tests for the MCP auth tool (start_youtube_auth, check_youtube_auth_status).
 */
import { UUID_V4_RE } from "./testUtils";

jest.mock("../src/youtube/auth", () => ({
  generateAuthUrl: jest.fn(
    (tenantId: string) => `https://accounts.google.com/o/oauth2/auth?state=${tenantId}`
  ),
  hasTokens: jest.fn().mockResolvedValue(false),
  validateTenantId: jest.fn((id: string) => {
    if (!UUID_V4_RE.test(id)) {
      throw new Error("Invalid tenantId: must be a UUID v4 string.");
    }
  }),
}));

import { startYoutubeAuth, checkYoutubeAuthStatus } from "../src/mcp/authTool";
import { clearPendingTenants, hasPendingTenant } from "../src/youtube/pendingAuth";
import { hasTokens } from "../src/youtube/auth";

const mockHasTokens = hasTokens as jest.MockedFunction<typeof hasTokens>;

describe("startYoutubeAuth", () => {
  beforeEach(() => {
    clearPendingTenants();
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  });

  it("returns a tenantId that is a UUID v4", async () => {
    const result = await startYoutubeAuth();
    expect(result.tenantId).toMatch(UUID_V4_RE);
  });

  it("returns an authUrl containing the tenantId", async () => {
    const result = await startYoutubeAuth();
    expect(result.authUrl).toContain(result.tenantId);
  });

  it("returns an authUrl pointing to Google", async () => {
    const result = await startYoutubeAuth();
    expect(result.authUrl).toMatch(/accounts\.google\.com/);
  });

  it("returns a message that includes the tenantId", async () => {
    const result = await startYoutubeAuth();
    expect(result.message).toContain(result.tenantId);
  });

  it("registers the tenantId as pending", async () => {
    const result = await startYoutubeAuth();
    expect(hasPendingTenant(result.tenantId)).toBe(true);
  });

  it("each call generates a unique tenantId", async () => {
    const a = await startYoutubeAuth();
    const b = await startYoutubeAuth();
    expect(a.tenantId).not.toBe(b.tenantId);
  });
});

describe("checkYoutubeAuthStatus", () => {
  const VALID_UUID = "12345678-1234-4234-a234-123456789abc";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws for an invalid tenantId", async () => {
    await expect(checkYoutubeAuthStatus("not-a-uuid")).rejects.toThrow(
      /Invalid tenantId/
    );
  });

  it("returns authenticated: false when tenant has no tokens", async () => {
    mockHasTokens.mockResolvedValueOnce(false);
    const result = await checkYoutubeAuthStatus(VALID_UUID);
    expect(result.authenticated).toBe(false);
    expect(result.tenantId).toBe(VALID_UUID);
    expect(result.message).toMatch(/not completed/i);
  });

  it("returns authenticated: true when tenant has tokens", async () => {
    mockHasTokens.mockResolvedValueOnce(true);
    const result = await checkYoutubeAuthStatus(VALID_UUID);
    expect(result.authenticated).toBe(true);
    expect(result.tenantId).toBe(VALID_UUID);
    expect(result.message).toMatch(/authenticated/i);
  });
});
