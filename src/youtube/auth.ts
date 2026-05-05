/**
 * Google OAuth2 authentication for YouTube API.
 * Multi-tenant: each tenant has its own token file under TOKENS_DIR.
 * The OAuth2 web redirect flow is handled by the Express server.
 */
import fs from "fs";
import path from "path";
import { google, Auth } from "googleapis";
import { logger } from "../utils/logger.js";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

function getTokensDir(): string {
  return path.resolve(process.env.TOKENS_DIR ?? ".tokens");
}

/** UUID v4 format — the only shape we accept as a tenantId. */
const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates that a tenantId is a UUID v4 string.
 * Throws if the value is not a valid UUID to prevent path-traversal attacks.
 */
export function validateTenantId(tenantId: string): void {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`Invalid tenantId: must be a UUID v4 string.`);
  }
}

export function getTokensPath(tenantId: string): string {
  validateTenantId(tenantId);
  return path.join(getTokensDir(), `${tenantId}.tokens.json`);
}

function getRedirectUri(): string {
  const base = process.env.SERVER_BASE_URL ?? "http://localhost:3000";
  return `${base}/auth/callback`;
}

function createOAuth2Client(): Auth.OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required"
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

async function loadTokens(
  client: Auth.OAuth2Client,
  tenantId: string
): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(getTokensPath(tenantId), "utf-8");
    const tokens = JSON.parse(raw) as Auth.Credentials;
    client.setCredentials(tokens);
    return true;
  } catch {
    return false;
  }
}

async function saveTokens(
  client: Auth.OAuth2Client,
  tenantId: string
): Promise<void> {
  const tokensPath = getTokensPath(tenantId);
  await fs.promises.mkdir(path.dirname(tokensPath), { recursive: true });
  const tmpPath = `${tokensPath}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(client.credentials, null, 2), "utf-8");
  await fs.promises.rename(tmpPath, tokensPath);
  logger.info("Tokens saved", { tenantId });
}

/**
 * Returns true if the tenant has stored tokens (may or may not be valid).
 */
export async function hasTokens(tenantId: string): Promise<boolean> {
  try {
    await fs.promises.access(getTokensPath(tenantId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates the Google OAuth2 authorization URL for a given tenant.
 * The tenantId is embedded in the state parameter so the callback
 * can associate the code with the correct tenant.
 */
export function generateAuthUrl(tenantId: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state: tenantId,
    prompt: "consent",
  });
}

/**
 * Exchanges an OAuth2 authorization code for tokens and persists them
 * under the tenant's token file.
 */
export async function exchangeCodeForTokens(
  tenantId: string,
  code: string
): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await saveTokens(client, tenantId);
  logger.info("OAuth2: tokens obtained and saved", { tenantId });
}

/**
 * Returns an authenticated OAuth2 client for the given tenant.
 * Throws if the tenant has not completed the OAuth2 flow yet.
 */
export async function getAuthClient(tenantId: string): Promise<Auth.OAuth2Client> {
  const client = createOAuth2Client();

  const loaded = await loadTokens(client, tenantId);
  if (!loaded) {
    const base = process.env.SERVER_BASE_URL ?? "http://localhost:3000";
    throw new Error(
      `Tenant "${tenantId}" is not authenticated. ` +
        `Please complete the OAuth2 flow by visiting ${base}/auth/start.`
    );
  }

  // Auto-refresh if access token is expired
  const expiry = client.credentials.expiry_date;
  if (expiry && Date.now() > expiry - 60_000) {
    logger.info("Access token expired, refreshing", { tenantId });
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    await saveTokens(client, tenantId);
  }

  logger.info("OAuth2: loaded existing tokens", { tenantId });
  return client;
}
