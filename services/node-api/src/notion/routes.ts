import { Router, type Request, type Response } from "express";
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
import { maybeRedirectAfterOAuth, parsePageSize, sendErrorResponse } from "../integrations/routesUtils.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

export const notionRouter = Router();
export const notionOAuthRouter = Router();

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
    const userId = await handleNotionOAuthCallback({ code, state });
    const redirect = maybeRedirectAfterOAuth(res, config.notionOauthSuccessRedirect, "notionConnected", {
      ok: true,
    });
    if (redirect) {
      return redirect;
    }

    return res.json({ connected: true, userId });
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

notionOAuthRouter.get("/login/start", async (_req: Request, res: Response) => {
  try {
    const { getNotionLoginUrl } = await import("./service.js");
    const authUrl = await getNotionLoginUrl();
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
    const { generateAccessToken } = await import("../auth/jwt.js");

    const userId = await handleNotionLoginCallback({ code, state });
    const token = await generateAccessToken(userId);

    // Redirect to the success page with the token
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
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      await disconnectNotion(res.locals.auth.userId);
      return res.status(204).send();
    } catch (error) {
      return sendErrorResponse(res, "Failed to disconnect Notion.", error);
    }
  },
);

notionRouter.post(
  "/databases/:databaseId/query",
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
  async (req: Request<{ pageId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const page = await readNotionPage(res.locals.auth.userId, req.params.pageId);
      return res.json(page);
    } catch (error) {
      return sendErrorResponse(res, "Failed to read Notion page.", error);
    }
  },
);

notionRouter.patch(
  "/pages/:pageId",
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
