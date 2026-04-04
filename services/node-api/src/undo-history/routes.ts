import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import {
  storeUndoAction,
  listUndoHistory,
  getUndoAction,
  markUndone,
  type StoreUndoActionInput,
} from "./repository.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

const VALID_PLATFORMS = ["google_drive", "notion"] as const;

function isValidPlatform(v: unknown): v is StoreUndoActionInput["platform"] {
  return VALID_PLATFORMS.includes(v as never);
}

export const undoHistoryRouter = Router();

/** POST /undo-history — store a new action in undo history */
undoHistoryRouter.post(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { suggestionId, action, platform, actionDetails, undoPayload } =
      req.body ?? {};

    if (typeof action !== "string" || !action.trim()) {
      return res.status(400).json({ error: "action is required" });
    }
    if (!isValidPlatform(platform)) {
      return res
        .status(400)
        .json({ error: "platform must be 'google_drive' or 'notion'" });
    }
    if (
      typeof actionDetails !== "object" ||
      actionDetails === null ||
      Array.isArray(actionDetails)
    ) {
      return res.status(400).json({ error: "actionDetails must be an object" });
    }
    if (
      typeof undoPayload !== "object" ||
      undoPayload === null ||
      Array.isArray(undoPayload)
    ) {
      return res.status(400).json({ error: "undoPayload must be an object" });
    }

    try {
      const undoAction = await storeUndoAction(res.locals.auth.userId, {
        suggestionId:
          typeof suggestionId === "string" ? suggestionId : undefined,
        action: action.trim(),
        platform,
        actionDetails: actionDetails as Record<string, unknown>,
        undoPayload: undoPayload as Record<string, unknown>,
      });
      return res.status(201).json({ action: undoAction });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to store undo action.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** GET /undo-history — list undo history with optional filters */
undoHistoryRouter.get(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { limit, offset, includeUndone } = req.query;

    const parsedLimit =
      limit !== undefined ? parseInt(String(limit), 10) : 50;
    const parsedOffset =
      offset !== undefined ? parseInt(String(offset), 10) : 0;
    const parsedIncludeUndone =
      includeUndone !== undefined ? includeUndone === "true" : false;

    if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return res.status(400).json({ error: "limit must be between 1 and 200" });
    }
    if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: "offset must be >= 0" });
    }

    try {
      const result = await listUndoHistory(res.locals.auth.userId, {
        limit: parsedLimit,
        offset: parsedOffset,
        includeUndone: parsedIncludeUndone,
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to fetch undo history.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** GET /undo-history/:id — get a single undo action */
undoHistoryRouter.get(
  "/:id",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const action = await getUndoAction(res.locals.auth.userId, req.params.id);
      if (!action) {
        return res.status(404).json({ error: "Undo action not found." });
      }
      return res.json({ action });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to fetch undo action.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** POST /undo-history/:id/undo — mark an action as undone */
undoHistoryRouter.post(
  "/:id/undo",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const action = await markUndone(res.locals.auth.userId, req.params.id);
      if (!action) {
        return res.status(404).json({ error: "Undo action not found." });
      }
      return res.json({ action });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to mark undo action as undone.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
