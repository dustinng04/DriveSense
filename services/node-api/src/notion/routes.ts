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
  readNotionPage,
  updateNotionPage,
} from "./service.js";
import { maybeRedirectAfterOAuth, sendErrorResponse } from "../integrations/routesUtils.js";

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
      // Use name and statusCode instead of instanceof for robustness across module boundaries.
      const isIntegrationError = oauthError instanceof Error && 
        (oauthError.name === "IntegrationError" || (oauthError as any).statusCode === 400);

      if (isIntegrationError && (oauthError as any).statusCode === 400) {
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
    // Extract userId from state if available for Google connection check
    const stateParam = typeof req.query.state === "string" ? req.query.state : undefined;
    
    // For now, we cannot check Google connection without userId from auth context.
    // This endpoint is public (no auth), so we return a note to the caller.
    // The real check happens in /login/callback after we decode the state.
    
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
    const { verifyLoginState } = await import("../integrations/oauthState.js");
    const { listOAuthAccountSummaries } = await import("../integrations/oauthConnectionsRepository.js");

    // Verify state and extract userId before processing
    const { redirectUri: stateRedirectUri } = await verifyLoginState(state, "notion-login");

    // Decode JWT from state to get userId for Google connection check
    // For now, we'll check after getting userId from handleNotionLoginCallback
    // This is slightly less efficient but maintains the existing flow
    
    const { userId, redirectUri } = await handleNotionLoginCallback({ code, state });
    
    // Check if user has Google Drive connection
    const googleAccounts = await listOAuthAccountSummaries(userId, "google_drive");
    if (googleAccounts.length === 0) {
      return res.redirect(
        `${dashboardUrl}?error=notion_login_failed&code=GOOGLE_REQUIRED&message=${encodeURIComponent(
          "Please connect Google Drive first"
        )}`
      );
    }

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
