/**
 * OAuth2 routes for multi-tenant YouTube authentication.
 *
 * GET /auth/start            – Generate a tenantId, redirect to Google OAuth consent screen.
 * GET /auth/callback         – Receive the authorization code, exchange it for tokens.
 * GET /auth/status?tenantId= – Check whether a tenant has completed authentication.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { generateAuthUrl, exchangeCodeForTokens, hasTokens, validateTenantId } from "../../youtube/auth.js";
import { addPendingTenant, hasPendingTenant, removePendingTenant } from "../../youtube/pendingAuth.js";
import { logger } from "../../utils/logger.js";

export const authRouter = Router();

/** Escape special HTML characters to prevent XSS. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Rate-limit /auth/start to prevent abuse (10 requests per minute per IP). */
const startLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many auth requests, please try again later.",
});

authRouter.get("/start", startLimiter, (_req: Request, res: Response) => {
  const tenantId = crypto.randomUUID();
  addPendingTenant(tenantId);

  const authUrl = generateAuthUrl(tenantId);
  logger.info("OAuth2: auth flow started", { tenantId });
  res.redirect(authUrl);
});

authRouter.get("/callback", async (req: Request, res: Response) => {
  const code = req.query["code"];
  const tenantId = req.query["state"];

  if (typeof code !== "string" || typeof tenantId !== "string") {
    res.status(400).send("Missing code or state parameter.");
    return;
  }

  try {
    validateTenantId(tenantId);
  } catch {
    res.status(400).send("Invalid state parameter.");
    return;
  }

  if (!hasPendingTenant(tenantId)) {
    res.status(400).send("Invalid or expired auth session. Please visit /auth/start again.");
    return;
  }

  removePendingTenant(tenantId);

  try {
    await exchangeCodeForTokens(tenantId, code);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("OAuth2: token exchange failed", { tenantId, error: message });
    res.status(500).send(`Authentication failed. Please try again.`);
    return;
  }

  logger.info("OAuth2: auth flow completed", { tenantId });

  const safeTenantId = escapeHtml(tenantId);
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 60px auto; padding: 0 16px; }
    code { background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 1.1em; }
    .box { border: 1px solid #ccc; border-radius: 8px; padding: 16px 24px; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>&#x2705; Authentication Successful</h1>
  <p>Your YouTube account has been linked. Use the Tenant ID below when calling the MCP tool:</p>
  <div class="box">
    <strong>Tenant ID:</strong><br>
    <code>${safeTenantId}</code>
  </div>
  <p>Pass this value as the <strong>tenantId</strong> parameter in every <code>set_youtube_thumbnail</code> call.</p>
</body>
</html>
`);
});

authRouter.get("/status", async (req: Request, res: Response) => {
  const tenantId = req.query["tenantId"];

  if (typeof tenantId !== "string" || !tenantId) {
    res.status(400).json({ error: "tenantId query parameter is required." });
    return;
  }

  try {
    validateTenantId(tenantId);
  } catch {
    res.status(400).json({ error: "Invalid tenantId: must be a UUID v4 string." });
    return;
  }

  const authenticated = await hasTokens(tenantId);
  res.json({ tenantId, authenticated });
});
