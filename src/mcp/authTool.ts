/**
 * MCP tool: start_youtube_auth
 *
 * Initiates the Google OAuth2 authentication flow for a new tenant.
 * Returns the authorization URL (for the user to visit in a browser) and
 * the tenantId the user must provide in subsequent tool calls.
 */
import crypto from "crypto";
import { generateAuthUrl, hasTokens, validateTenantId } from "../youtube/auth.js";
import { addPendingTenant } from "../youtube/pendingAuth.js";
import { logger } from "../utils/logger.js";

export interface StartAuthResult {
  tenantId: string;
  authUrl: string;
  message: string;
}

export interface CheckAuthResult {
  tenantId: string;
  authenticated: boolean;
  message: string;
}

/**
 * Generates a fresh tenantId, registers it as pending, and returns
 * the Google OAuth2 consent-screen URL the user must open in a browser.
 */
export async function startYoutubeAuth(): Promise<StartAuthResult> {
  const tenantId = crypto.randomUUID();
  addPendingTenant(tenantId);
  const authUrl = generateAuthUrl(tenantId);

  logger.info("MCP: auth flow initiated", { tenantId });

  return {
    tenantId,
    authUrl,
    message:
      `Open the URL below in a browser to grant YouTube access. ` +
      `After completing the flow, save your Tenant ID: ${tenantId}`,
  };
}

/**
 * Checks whether a tenant has completed the OAuth2 flow.
 * Returns authenticated: true once the token file exists.
 */
export async function checkYoutubeAuthStatus(
  tenantId: string
): Promise<CheckAuthResult> {
  validateTenantId(tenantId);
  const authenticated = await hasTokens(tenantId);
  return {
    tenantId,
    authenticated,
    message: authenticated
      ? `Tenant ${tenantId} is authenticated and ready to use set_youtube_thumbnail.`
      : `Tenant ${tenantId} has not completed authentication yet. Please complete the OAuth2 flow.`,
  };
}
