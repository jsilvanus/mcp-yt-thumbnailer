/**
 * Google OAuth2 authentication for YouTube API.
 * - First run: prints auth URL, reads code from stdin, stores tokens.
 * - Subsequent runs: loads tokens, auto-refreshes if needed.
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import { google, Auth } from "googleapis";
import { logger } from "../utils/logger.js";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

const TOKENS_PATH = process.env.TOKENS_PATH ?? path.resolve(".tokens.json");

function createOAuth2Client(): Auth.OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "urn:ietf:wg:oauth:2.0:oob";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required"
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function loadTokens(client: Auth.OAuth2Client): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(TOKENS_PATH, "utf-8");
    const tokens = JSON.parse(raw) as Auth.Credentials;
    client.setCredentials(tokens);
    return true;
  } catch {
    return false;
  }
}

async function saveTokens(client: Auth.OAuth2Client): Promise<void> {
  const tokens = client.credentials;
  const tmpPath = `${TOKENS_PATH}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(tokens, null, 2), "utf-8");
  await fs.promises.rename(tmpPath, TOKENS_PATH);
  logger.info("Tokens saved");
}

async function promptForCode(authUrl: string): Promise<string> {
  console.log("\n=== YouTube OAuth2 Setup ===");
  console.log("Open this URL in your browser and authorize the application:");
  console.log("\n" + authUrl + "\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Enter the authorization code: ", (code) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

/**
 * Returns an authenticated OAuth2 client.
 * If no tokens are stored, initiates the auth flow.
 */
export async function getAuthClient(): Promise<Auth.OAuth2Client> {
  const client = createOAuth2Client();

  const loaded = await loadTokens(client);
  if (loaded) {
    // Auto-refresh if access token is expired
    const expiry = client.credentials.expiry_date;
    if (expiry && Date.now() > expiry - 60_000) {
      logger.info("Access token expired, refreshing");
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      await saveTokens(client);
    }
    logger.info("OAuth2: loaded existing tokens");
    return client;
  }

  // First-time auth flow
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  const code = await promptForCode(authUrl);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await saveTokens(client);
  logger.info("OAuth2: tokens obtained and saved");

  return client;
}
