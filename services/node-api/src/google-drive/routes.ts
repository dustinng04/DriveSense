import { Router, type Request, type Response } from "express";
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
import { maybeRedirectAfterOAuth, parsePageSize, sendErrorResponse } from "../integrations/routesUtils.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

export const googleDriveRouter = Router();
export const googleDriveOAuthRouter = Router();

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
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      await disconnectGoogleDrive(res.locals.auth.userId);
      return res.status(204).send();
    } catch (error) {
      return sendErrorResponse(res, "Failed to disconnect Google Drive.", error);
    }
  },
);

googleDriveRouter.get("/files", async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
  let pageSize: number | undefined;
  try {
    pageSize = parsePageSize(req.query.pageSize);
  } catch (error) {
    return sendErrorResponse(res, "Invalid pageSize.", error);
  }

  try {
    const files = await listGoogleDriveFiles({
      userId: res.locals.auth.userId,
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
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const file = await readGoogleDriveFileMetadata(res.locals.auth.userId, req.params.fileId);
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to read Google Drive file metadata.", error);
    }
  },
);

googleDriveRouter.get(
  "/files/:fileId/content",
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const file = await readGoogleDriveFileContent(res.locals.auth.userId, req.params.fileId);
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to read Google Drive file content.", error);
    }
  },
);

googleDriveRouter.post(
  "/files/:fileId/move",
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
  async (req: Request<{ fileId: string }>, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const file = await trashGoogleDriveFile(res.locals.auth.userId, req.params.fileId);
      return res.json(file);
    } catch (error) {
      return sendErrorResponse(res, "Failed to trash Google Drive file.", error);
    }
  },
);
