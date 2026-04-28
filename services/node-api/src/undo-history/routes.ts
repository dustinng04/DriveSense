import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import {
  storeUndoAction,
  listUndoHistory,
  getUndoAction,
  markUndone,
  getUndoGroupByIdOrGroupId,
  type StoreUndoActionInput,
} from "./repository.js";
import { withUserTransaction } from "../db/withUserTransaction.js";

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

/** POST /undo-history/:id/undo — execute undo operation (supports grouped actions) */
undoHistoryRouter.post(
  "/:id/undo",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const userId = res.locals.auth.userId;
      const undoRef = req.params.id;

      // Resolve the undo entries: single or grouped
      const entries = await getUndoGroupByIdOrGroupId(userId, undoRef);
      if (entries.length === 0) {
        return res.status(404).json({ error: "Undo action not found." });
      }

      // Verify all entries are in a valid state for undo
      const invalidStates = entries.filter(
        (e) => e.undoStatus === "done" || e.undoStatus === "expired"
      );
      if (invalidStates.length > 0) {
        const state = invalidStates[0].undoStatus;
        if (state === "done") {
          return res.status(409).json({
            error: "Action has already been undone.",
            undoStatus: "done",
          });
        }
        return res.status(409).json({
          error: "Undo window has closed.",
          undoStatus: "expired",
        });
      }

      // Check lazy expiry
      const now = new Date();
      const expiredEntries = entries.filter((e) => e.expiresAt && new Date(e.expiresAt) < now);
      if (expiredEntries.length > 0) {
        // Mark as expired in DB
        await withUserTransaction(userId, async (client) => {
          for (const entry of expiredEntries) {
            await client.query(
              `update public.undo_history
               set undo_status = 'expired'
               where user_id = $1 and id = $2`,
              [userId, entry.id],
            );
          }
        });
        return res.status(409).json({
          error: "Undo window has closed.",
          undoStatus: "expired",
        });
      }

      // Execute undo for each entry (in descending step order for grouped actions)
      const sortedEntries = [...entries].sort(
        (a, b) => (b.actionGroupStep ?? 0) - (a.actionGroupStep ?? 0)
      );

      const results: Array<{ entryId: string; success: boolean; error?: string }> = [];

      for (const entry of sortedEntries) {
        // Skip entries that are already done or failed (for retry scenarios)
        if (entry.undoStatus === "done") {
          results.push({ entryId: entry.id, success: true });
          continue;
        }

        try {
          // TODO: Implement actual platform undo calls based on action/platform
          // For now, just mark as done
          await markUndone(userId, entry.id, { undoStatus: "done" });
          results.push({ entryId: entry.id, success: true });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          await markUndone(userId, entry.id, {
            undoStatus: "failed",
            undoError: errorMsg,
          });
          results.push({ entryId: entry.id, success: false, error: errorMsg });
          // Stop processing on first failure for grouped actions
          if (sortedEntries.length > 1) {
            break;
          }
        }
      }

      // Determine response status based on results
      const anyFailed = results.some((r) => !r.success);
      const statusCode = anyFailed ? 502 : 200;

      // Reload entries to return current state
      const updated = await getUndoGroupByIdOrGroupId(userId, undoRef);
      return res.status(statusCode).json({
        actions: updated,
        results,
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to execute undo operation.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
