/**
 * Tests for Express OAuth2 auth routes.
 */
import request from "supertest";
import { createExpressApp } from "../src/server/express";
import { clearPendingTenants, addPendingTenant } from "../src/youtube/pendingAuth";
import { UUID_V4_RE } from "./testUtils";

// Mock the youtube/auth module
jest.mock("../src/youtube/auth", () => ({
  generateAuthUrl: jest.fn(
    (tenantId: string) => `https://accounts.google.com/o/oauth2/auth?state=${tenantId}`
  ),
  exchangeCodeForTokens: jest.fn().mockResolvedValue(undefined),
  hasTokens: jest.fn().mockResolvedValue(false),
  validateTenantId: jest.fn((id: string) => {
    if (!UUID_V4_RE.test(id)) {
      throw new Error("Invalid tenantId: must be a UUID v4 string.");
    }
  }),
}));

import { generateAuthUrl, exchangeCodeForTokens, hasTokens } from "../src/youtube/auth";

const mockGenerateAuthUrl = generateAuthUrl as jest.MockedFunction<typeof generateAuthUrl>;
const mockExchange = exchangeCodeForTokens as jest.MockedFunction<typeof exchangeCodeForTokens>;
const mockHasTokens = hasTokens as jest.MockedFunction<typeof hasTokens>;

const VALID_UUID = "12345678-1234-4234-a234-123456789abc";

describe("GET /auth/start", () => {
  beforeEach(() => {
    clearPendingTenants();
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  });

  it("redirects to the Google OAuth URL", async () => {
    const app = createExpressApp();
    const res = await request(app).get("/auth/start");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toMatch(/accounts\.google\.com/);
  });

  it("calls generateAuthUrl with a UUID v4", async () => {
    const app = createExpressApp();
    await request(app).get("/auth/start");
    expect(mockGenerateAuthUrl).toHaveBeenCalledTimes(1);
    const calledWith = mockGenerateAuthUrl.mock.calls[0][0];
    expect(calledWith).toMatch(UUID_V4_RE);
  });
});

describe("GET /auth/callback", () => {
  beforeEach(() => {
    clearPendingTenants();
    jest.clearAllMocks();
  });

  it("returns 400 when code is missing", async () => {
    const app = createExpressApp();
    const res = await request(app).get(`/auth/callback?state=${VALID_UUID}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Missing code or state/);
  });

  it("returns 400 when state (tenantId) is missing", async () => {
    const app = createExpressApp();
    const res = await request(app).get("/auth/callback?code=abc");
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Missing code or state/);
  });

  it("returns 400 for invalid tenantId (state) format", async () => {
    const app = createExpressApp();
    const res = await request(app).get("/auth/callback?code=abc&state=not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Invalid state/);
  });

  it("returns 400 when tenantId is not in pending set", async () => {
    const app = createExpressApp();
    const res = await request(app).get(
      `/auth/callback?code=abc&state=${VALID_UUID}`
    );
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Invalid or expired/);
  });

  it("exchanges code and returns success HTML when tenantId is pending", async () => {
    addPendingTenant(VALID_UUID);
    const app = createExpressApp();
    const res = await request(app).get(
      `/auth/callback?code=mycode&state=${VALID_UUID}`
    );
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Authentication Successful/);
    expect(res.text).toMatch(VALID_UUID);
    expect(mockExchange).toHaveBeenCalledWith(VALID_UUID, "mycode");
  });

  it("removes tenantId from pending after successful callback", async () => {
    addPendingTenant(VALID_UUID);
    const app = createExpressApp();
    await request(app).get(`/auth/callback?code=mycode&state=${VALID_UUID}`);

    // Second callback with the same tenantId should fail
    const res2 = await request(app).get(
      `/auth/callback?code=mycode2&state=${VALID_UUID}`
    );
    expect(res2.status).toBe(400);
    expect(res2.text).toMatch(/Invalid or expired/);
  });

  it("returns 500 when token exchange fails", async () => {
    addPendingTenant(VALID_UUID);
    mockExchange.mockRejectedValueOnce(new Error("Exchange error"));
    const app = createExpressApp();
    const res = await request(app).get(
      `/auth/callback?code=badcode&state=${VALID_UUID}`
    );
    expect(res.status).toBe(500);
    expect(res.text).toMatch(/Authentication failed/);
  });

  it("includes the tenantId verbatim in the success page", async () => {
    // The route uses escapeHtml on the tenantId before embedding it in HTML.
    // UUIDs contain no HTML-special characters, so the value appears as-is.
    addPendingTenant(VALID_UUID);
    const app = createExpressApp();
    const res = await request(app).get(
      `/auth/callback?code=code&state=${VALID_UUID}`
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain(VALID_UUID);
  });
});

describe("GET /auth/status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when tenantId is missing", async () => {
    const app = createExpressApp();
    const res = await request(app).get("/auth/status");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("tenantId") });
  });

  it("returns 400 for invalid tenantId format", async () => {
    const app = createExpressApp();
    const res = await request(app).get("/auth/status?tenantId=not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("UUID") });
  });

  it("returns authenticated: false when tenant has no tokens", async () => {
    mockHasTokens.mockResolvedValueOnce(false);
    const app = createExpressApp();
    const res = await request(app).get(`/auth/status?tenantId=${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenantId: VALID_UUID, authenticated: false });
  });

  it("returns authenticated: true when tenant has tokens", async () => {
    mockHasTokens.mockResolvedValueOnce(true);
    const app = createExpressApp();
    const res = await request(app).get(`/auth/status?tenantId=${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenantId: VALID_UUID, authenticated: true });
  });
});
