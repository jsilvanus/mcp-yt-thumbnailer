/**
 * Express application for the OAuth2 redirect server.
 * This server runs alongside the MCP stdio server and handles
 * the Google OAuth2 web redirect flow for multi-tenant authentication.
 */
import express, { Application } from "express";
import { authRouter } from "./routes/auth.js";
import { logger } from "../utils/logger.js";

export function createExpressApp(): Application {
  const app = express();
  app.use("/auth", authRouter);
  return app;
}

export function startExpressServer(port: number): void {
  const app = createExpressApp();
  app.listen(port, () => {
    logger.info(`OAuth redirect server listening`, { port });
  });
}
