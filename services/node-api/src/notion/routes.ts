import { Router, type Request, type Response } from "express";
import type { PlatformAccountLocals } from "../auth/platformAccount.js";
import { requirePlatformAccount } from "../auth/platformAccount.js";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import { config } from "../config.js";
import {
  disconnectNotion,
  getNotionConnectionStatus,
  getNotionOauthUrl,
  handleNotionOAuthCallback,
  queryNotionDatabase,
  readNotionPage,
  updateNotionPage,
} from "./service.js";
import { IntegrationError } from "../integrations/errors.js";
import { maybeRedirectAfterOAuth, parsePageSize, sendErrorResponse } from "../integrations/routesUtils.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
  platform?: PlatformAccountLocals;
}

export const notionRouter = Router();
export const notionOAuthRouter = Router();

function appendQueryParam(baseUrl: string, key: string, value: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(key, value);
  return url.toString();
}

notionOAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (error) {
    const redirect = maybeRedirectAfterOAuth(res, config.notionOauthSuccessRedirect, "notionConnected", {
      ok: false,
      message: error,
    });
    if (redirect) {
      return redirect;
    }

    return res.status(400).json({ error: `Notion OAuth denied: ${error}` });
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing required query params: code and state." });
  }

  try {
    try {
      const userId = await handleNotionOAuthCallback({ code, state });
      const redirect = maybeRedirectAfterOAuth(res, config.notionOauthSuccessRedirect, "notionConnected", {
        ok: true,
      });
      if (redirect) {
        return redirect;
      }

      return res.json({ connected: true, userId });
    } catch (oauthError) {
      // If this isn't a "link account" state, fall back to the login flow.
      if (oauthError instanceof IntegrationError && oauthError.statusCode === 400) {
        const { handleNotionLoginCallback } = await import("./service.js");
        const { generateAccessTokenWithLinkedAccounts } = await import("../auth/accessTokenWithOAuth.js");

        const { userId, redirectUri } = await handleNotionLoginCallback({ code, state });
        const token = await generateAccessTokenWithLinkedAccounts(userId);

        if (redirectUri) {
          return res.redirect(appendQueryParam(redirectUri, "token", token));
        }

        const dashboardUrl = config.corsAllowedOrigins[0] || "http://localhost:5173";
        return res.redirect(`${dashboardUrl}/oauth-success?token=${encodeURIComponent(token)}`);
      }

      throw oauthError;
    }
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : "Notion OAuth callback failed.";
    const redirect = maybeRedirectAfterOAuth(res, config.notionOauthSuccessRedirect, "notionConnected", {
      ok: false,
      message,
    });
    if (redirect) {
      return redirect;
    }
    return sendErrorResponse(
      res,
      "Notion OAuth callback failed.",
      callbackError instanceof Error ? callbackError : new Error(message),
    );
  }
});

notionOAuthRouter.get("/login/start", async (req: Request, res: Response) => {
  try {
    const redirectUri = typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined;
    const { getNotionLoginUrl, getNotionLoginUrlWithRedirect } = await import("./service.js");
    const authUrl = redirectUri ? await getNotionLoginUrlWithRedirect(redirectUri) : await getNotionLoginUrl();
    // Redirect directly to the Notion OAuth screen
    return res.redirect(authUrl);
  } catch (error) {
    return sendErrorResponse(res, "Failed to create Notion Login URL.", error);
  }
});

notionOAuthRouter.get("/login/callback", async (req: Request, res: Response) => {
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  const dashboardUrl = config.corsAllowedOrigins[0] || "http://localhost:5173";

  if (error || !code || !state) {
    return res.redirect(`${dashboardUrl}?error=notion_login_failed`);
  }

  try {
    const { handleNotionLoginCallback } = await import("./service.js");
    const { generateAccessTokenWithLinkedAccounts } = await import("../auth/accessTokenWithOAuth.js");

    const { userId, redirectUri } = await handleNotionLoginCallback({ code, state });
    const token = await generateAccessTokenWithLinkedAccounts(userId);

    if (redirectUri) {
      return res.redirect(appendQueryParam(redirectUri, "token", token));
    }

    return res.redirect(`${dashboardUrl}/oauth-success?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("Notion login failed", err);
    return res.redirect(`${dashboardUrl}?error=notion_login_failed`);
  }
});

notionRouter.get("/oauth/start", async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
  try {
    const authUrl = await getNotionOauthUrl(res.locals.auth.userId);
    return res.json({ authUrl });
  } catch (error) {
    return sendErrorResponse(res, "Failed to create Notion OAuth URL.", error);
  }
});

notionRouter.get("/oauth/status", async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
  try {
    const status = await getNotionConnectionStatus(res.locals.auth.userId);
    return res.json(status);
  } catch (error) {
    return sendErrorResponse(res, "Failed to load Notion connection status.", error);
  }
});

notionRouter.delete(
  "/oauth/connection",
  requirePlatformAccount("notion"),
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      await disconnectNotion(res.locals.auth.userId, res.locals.platform!.accountId);
      return res.status(204).send();
    } catch (error) {
      return sendErrorResponse(res, "Failed to disconnect Notion.", error);
    }
  },
);

notionRouter.post(
  "/databases/:databaseId/query",
  requirePlatformAccount("notion"),
  async (
    req: Request<{ databaseId: string }, unknown, { filter?: unknown; sorts?: unknown; startCursor?: unknown }>,
    res: Response<unknown, AuthenticatedLocals>,
  ) => {
    let pageSize: number | undefined;
    try {
      pageSize = parsePageSize(req.query.pageSize);
    } catch (error) {
      return sendErrorResponse(res, "Invalid pageSize.", error);
    }

    const startCursor = req.body?.startCursor;
    if (startCursor !== undefined && typeof startCursor !== "string") {
      return res.status(400).json({ error: "startCursor must be a string when provided." });
    }

    try {
      const payload = await queryNotionDatabase({
        userId: res.locals.auth.userId,
        accountId: res.locals.platform!.accountId,
        databaseId: req.params.databaseId,
        filter: req.body?.filter,
        sorts: req.body?.sorts,
        startCursor,
        pageSize,
      });
      return res.json(payload);
    } catch (error) {
      return sendErrorResponse(res, "Failed to query Notion database.", error);
    }
  },
);

notionRouter.get(
  "/pages/:pageId",
  requirePlatformAccount("notion"),
  async (req: Request<{ pageId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const page = await readNotionPage(
        res.locals.auth.userId,
        res.locals.platform!.accountId,
        req.params.pageId,
      );
      return res.json(page);
    } catch (error) {
      return sendErrorResponse(res, "Failed to read Notion page.", error);
    }
  },
);

notionRouter.patch(
  "/pages/:pageId",
  requirePlatformAccount("notion"),
  async (
    req: Request<
      { pageId: string },
      unknown,
      { properties?: unknown; icon?: unknown; cover?: unknown; archived?: unknown; inTrash?: unknown }
    >,
    res: Response<unknown, AuthenticatedLocals>,
  ) => {
    const archived = req.body?.archived;
    if (archived !== undefined && typeof archived !== "boolean") {
      return res.status(400).json({ error: "archived must be a boolean when provided." });
    }

    const inTrash = req.body?.inTrash;
    if (inTrash !== undefined && typeof inTrash !== "boolean") {
      return res.status(400).json({ error: "inTrash must be a boolean when provided." });
    }

    try {
      const page = await updateNotionPage({
        userId: res.locals.auth.userId,
        accountId: res.locals.platform!.accountId,
        pageId: req.params.pageId,
        properties: req.body?.properties,
        icon: req.body?.icon,
        cover: req.body?.cover,
        archived,
        inTrash,
      });
      return res.json(page);
    } catch (error) {
      return sendErrorResponse(res, "Failed to update Notion page.", error);
    }
  },
);
