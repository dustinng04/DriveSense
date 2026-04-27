import { Router, type Request, type Response } from "express";
import type { PlatformAccountLocals } from "../auth/platformAccount.js";
import { requirePlatformAccount } from "../auth/platformAccount.js";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import {
  disconnectGoogleDrive,
  getGoogleDriveConnectionStatus,
  getGoogleDriveOauthUrl,
  handleGoogleDriveOAuthCallback,
  listGoogleDriveFiles,
  moveGoogleDriveFile,
  readGoogleDriveFileContent,
  readGoogleDriveFileMetadata,
  trashGoogleDriveFile,
} from "./service.js";
import { config } from "../config.js";
import { IntegrationError } from "../integrations/errors.js";
import { maybeRedirectAfterOAuth, parsePageSize, sendErrorResponse } from "../integrations/routesUtils.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
  platform?: PlatformAccountLocals;
}

export const googleDriveRouter = Router();
export const googleDriveOAuthRouter = Router();

function appendQueryParam(baseUrl: string, key: string, value: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(key, value);
  return url.toString();
}

googleDriveOAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (error) {
    const redirect = maybeRedirectAfterOAuth(
      res,
      config.googleDriveOauthSuccessRedirect,
      "googleDriveConnected",
      { ok: false, message: error },
    );
    if (redirect) {
      return redirect;
    }

    return res.status(400).json({ error: `Google OAuth denied: ${error}` });
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing required query params: code and state." });
  }

  try {
    try {
      const userId = await handleGoogleDriveOAuthCallback({ code, state });
      const redirect = maybeRedirectAfterOAuth(
        res,
        config.googleDriveOauthSuccessRedirect,
        "googleDriveConnected",
        { ok: true },
      );
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
        const { handleGoogleDriveLoginCallback } = await import("./service.js");
        const { generateAccessTokenWithLinkedAccounts } = await import("../auth/accessTokenWithOAuth.js");

        const { userId, redirectUri } = await handleGoogleDriveLoginCallback({ code, state });
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
    const message =
      callbackError instanceof Error ? callbackError.message : "Google Drive OAuth callback failed.";
    const redirect = maybeRedirectAfterOAuth(
      res,
      config.googleDriveOauthSuccessRedirect,
      "googleDriveConnected",
      { ok: false, message },
    );
    if (redirect) {
      return redirect;
    }
    return sendErrorResponse(
      res,
      "Google Drive OAuth callback failed.",
      callbackError instanceof Error ? callbackError : new Error(message),
    );
  }
});

googleDriveOAuthRouter.get("/login/start", async (req: Request, res: Response) => {
  try {
    const redirectUri = typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined;
    const { getGoogleDriveLoginUrl, getGoogleDriveLoginUrlWithRedirect } = await import("./service.js");
    const authUrl = redirectUri ? await getGoogleDriveLoginUrlWithRedirect(redirectUri) : await getGoogleDriveLoginUrl();
    return res.redirect(authUrl);
  } catch (error) {
    return sendErrorResponse(res, "Failed to create Google Drive Login URL.", error);
  }
});

googleDriveOAuthRouter.get("/login/callback", async (req: Request, res: Response) => {
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  const dashboardUrl = config.corsAllowedOrigins[0] || "http://localhost:5173";

  if (error || !code || !state) {
    return res.redirect(`${dashboardUrl}?error=google_login_failed`);
  }

  try {
    const { handleGoogleDriveLoginCallback } = await import("./service.js");
    const { generateAccessTokenWithLinkedAccounts } = await import("../auth/accessTokenWithOAuth.js");

    const { userId, redirectUri } = await handleGoogleDriveLoginCallback({ code, state });
    const token = await generateAccessTokenWithLinkedAccounts(userId);

    if (redirectUri) {
      return res.redirect(appendQueryParam(redirectUri, "token", token));
    }

    return res.redirect(`${dashboardUrl}/oauth-success?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error("Google Drive login failed", err);
    return res.redirect(`${dashboardUrl}?error=google_login_failed`);
  }
});

googleDriveRouter.get(
  "/oauth/start",
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const authUrl = await getGoogleDriveOauthUrl(res.locals.auth.userId);
      return res.json({ authUrl });
    } catch (error) {
      return sendErrorResponse(res, "Failed to create Google Drive OAuth URL.", error);
    }
  },
);

googleDriveRouter.get(
  "/oauth/status",
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const status = await getGoogleDriveConnectionStatus(res.locals.auth.userId);
      return res.json(status);
    } catch (error) {
      return sendErrorResponse(res, "Failed to load Google Drive connection status.", error);
    }
  },
);

googleDriveRouter.delete(
  "/oauth/connection",
  requirePlatformAccount("google_drive"),
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      await disconnectGoogleDrive(res.locals.auth.userId, res.locals.platform!.accountId);
      return res.status(204).send();
    } catch (error) {
      return sendErrorResponse(res, "Failed to disconnect Google Drive.", error);
    }
  },
);

googleDriveRouter.get("/files", requirePlatformAccount("google_drive"), async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
  let pageSize: number | undefined;
  try {
    pageSize = parsePageSize(req.query.pageSize);
  } catch (error) {
    return sendErrorResponse(res, "Invalid pageSize.", error);
  }

  try {
    const files = await listGoogleDriveFiles({
      userId: res.locals.auth.userId,
      accountId: res.locals.platform!.accountId,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      pageToken: typeof req.query.pageToken === "string" ? req.query.pageToken : undefined,
      pageSize,
    });

    return res.json(files);
  } catch (error) {
    return sendErrorResponse(res, "Failed to list Google Drive files.", error);
  }
});

googleDriveRouter.get(
  "/files/:fileId",
  requirePlatformAccount("google_drive"),
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const file = await readGoogleDriveFileMetadata(
        res.locals.auth.userId,
        res.locals.platform!.accountId,
        req.params.fileId,
      );
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to read Google Drive file metadata.", error);
    }
  },
);

googleDriveRouter.get(
  "/files/:fileId/parent",
  requirePlatformAccount("google_drive"),
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const metadata = await readGoogleDriveFileMetadata(
        res.locals.auth.userId,
        res.locals.platform!.accountId,
        req.params.fileId,
      );
      
      const parents = (metadata as any).parents || [];
      const parentFolderId = parents[0] || 'root';

      return res.json({ parentFolderId });
    } catch (error) {
      return sendErrorResponse(res, "Failed to get parent folder.", error);
    }
  },
);

googleDriveRouter.get(
  "/files/:fileId/content",
  requirePlatformAccount("google_drive"),
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const file = await readGoogleDriveFileContent(
        res.locals.auth.userId,
        res.locals.platform!.accountId,
        req.params.fileId,
      );
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to read Google Drive file content.", error);
    }
  },
);

googleDriveRouter.post(
  "/files/:fileId/move",
  requirePlatformAccount("google_drive"),
  async (
    req: Request<{ fileId: string }, unknown, { folderId?: unknown }>,
    res: Response<unknown, AuthenticatedLocals>,
  ) => {
    if (typeof req.body?.folderId !== "string" || !req.body.folderId.trim()) {
      return res.status(400).json({ error: "folderId is required." });
    }

    try {
      const file = await moveGoogleDriveFile(
        res.locals.auth.userId,
        res.locals.platform!.accountId,
        req.params.fileId,
        req.body.folderId.trim(),
      );
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to move Google Drive file.", error);
    }
  },
);

googleDriveRouter.post(
  "/files/:fileId/trash",
  requirePlatformAccount("google_drive"),
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const file = await trashGoogleDriveFile(
        res.locals.auth.userId,
        res.locals.platform!.accountId,
        req.params.fileId,
      );
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to trash Google Drive file.", error);
    }
  },
);
