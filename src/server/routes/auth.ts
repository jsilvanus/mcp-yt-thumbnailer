/**
 * OAuth2 routes for multi-tenant YouTube authentication.
 *
 * GET /auth/start            – Generate a tenantId, redirect to Google OAuth consent screen.
 * GET /auth/callback         – Receive the authorization code, exchange it for tokens.
 * GET /auth/status?tenantId= – Check whether a tenant has completed authentication.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { generateAuthUrl, exchangeCodeForTokens, hasTokens } from "../../youtube/auth.js";
import { logger } from "../../utils/logger.js";

export const authRouter = Router();

/**
 * In-memory set of tenant IDs whose OAuth flows are currently in progress.
 * Entries are removed after the callback is received or after a 10-minute TTL.
 */
const pendingTenants = new Set<string>();
const PENDING_TTL_MS = 10 * 60 * 1000;

authRouter.get("/start", (_req: Request, res: Response) => {
  const tenantId = crypto.randomUUID();
  pendingTenants.add(tenantId);
  setTimeout(() => pendingTenants.delete(tenantId), PENDING_TTL_MS);

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

  if (!pendingTenants.has(tenantId)) {
    res.status(400).send("Invalid or expired auth session. Please visit /auth/start again.");
    return;
  }

  pendingTenants.delete(tenantId);

  try {
    await exchangeCodeForTokens(tenantId, code);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("OAuth2: token exchange failed", { tenantId, error: message });
    res.status(500).send(`Authentication failed: ${message}`);
    return;
  }

  logger.info("OAuth2: auth flow completed", { tenantId });

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
  <h1>✅ Authentication Successful</h1>
  <p>Your YouTube account has been linked. Use the Tenant ID below when calling the MCP tool:</p>
  <div class="box">
    <strong>Tenant ID:</strong><br>
    <code>${tenantId}</code>
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

  const authenticated = await hasTokens(tenantId);
  res.json({ tenantId, authenticated });
});
