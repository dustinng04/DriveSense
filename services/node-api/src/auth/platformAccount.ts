import type { NextFunction, Request, Response } from "express";
import { getOAuthConnection, type OAuthConnection, type OAuthProvider } from "../integrations/oauthConnectionsRepository.js";
import type { AuthenticatedRequestContext } from "./types.js";

export const PLATFORM_ACCOUNT_HEADER = "x-platform-account";

export interface PlatformAccountLocals {
  accountId: string;
  platformConnection: OAuthConnection;
}

interface AuthLocals {
  auth: AuthenticatedRequestContext;
  platform?: PlatformAccountLocals;
}

/**
 * Strict: requires `X-Platform-Account` and a matching `oauth_connections` row.
 */
export function requirePlatformAccount(provider: OAuthProvider) {
  return async (req: Request, res: Response<unknown, AuthLocals>, next: NextFunction) => {
    const raw = req.header(PLATFORM_ACCOUNT_HEADER) ?? req.header("X-Platform-Account");
    const accountId = typeof raw === "string" ? raw.trim() : "";
    if (!accountId) {
      return res.status(400).json({
        error: "Missing X-Platform-Account header.",
      });
    }

    const userId = res.locals.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    try {
      const platformConnection = await getOAuthConnection(userId, provider, accountId);
      if (!platformConnection) {
        return res.status(403).json({
          error: "Platform account is not linked for this user.",
        });
      }

      res.locals.platform = { accountId, platformConnection };
      next();
    } catch (err) {
      next(err);
    }
  };
}
