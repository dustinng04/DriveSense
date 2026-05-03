import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import {
  storeSuggestion,
  listSuggestions,
  getSuggestion,
  updateSuggestionStatus,
  markSuggestionForReview,
  applySuggestionEnrichment,
  type ReceiveSuggestionInput,
  type SuggestionStatus,
} from "./repository.js";
import { PLATFORM_ACCOUNT_HEADER } from "../auth/platformAccount.js";
import { CompensationError, executeArchive, executeRename, executeMerge, executeEdit, executeUndo } from "./executor.js";
import { withUserTransaction } from "../db/withUserTransaction.js";
import type { EditPatch } from "../scanner/types.js";
import type { PlatformContext, UndoEntry } from "./executor.types.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

const VALID_ACTIONS = ["archive", "merge", "rename", "review", "edit"] as const;
const VALID_CONFIDENCE = ["high", "medium", "low"] as const;
const VALID_STATUSES: SuggestionStatus[] = [
  "pending_enrichment",
  "pending",
  "confirmed",
  "skipped",
  "dismissed",
];
const VALID_STATUS_UPDATES: Exclude<SuggestionStatus, "pending_enrichment">[] = [
  "pending",
  "confirmed",
  "skipped",
  "dismissed",
];
const VALID_PLATFORMS = ["google_drive", "notion"] as const;

function isValidAction(v: unknown): v is ReceiveSuggestionInput["action"] {
  return VALID_ACTIONS.includes(v as never);
}
function isValidConfidence(v: unknown): v is ReceiveSuggestionInput["confidence"] {
  return VALID_CONFIDENCE.includes(v as never);
}
function isValidPlatform(v: unknown): v is ReceiveSuggestionInput["platform"] {
  return VALID_PLATFORMS.includes(v as never);
}

function isEditPatch(v: unknown): v is EditPatch {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;

  const patch = v as { version?: unknown; content_updates?: unknown };
  if (patch.version !== 1 || !Array.isArray(patch.content_updates)) return false;

  return patch.content_updates.every((op) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) return false;
    const update = op as { old_str?: unknown; new_str?: unknown; replace_all_matches?: unknown };
    return (
      typeof update.old_str === "string" &&
      update.old_str.length > 0 &&
      typeof update.new_str === "string" &&
      (update.replace_all_matches === undefined || typeof update.replace_all_matches === "boolean")
    );
  });
}

function readMergeBlockReason(suggestion: {
  action: string;
  confidence?: string;
  analysis?: Record<string, unknown>;
}): string | null {
  if (suggestion.action !== "merge") return null;

  const analysis = suggestion.analysis ?? {};
  const relationship = analysis.relationship;
  const enrichment = analysis.enrichment as Record<string, unknown> | undefined;
  const enrichmentResult = enrichment?.result as Record<string, unknown> | undefined;
  const isDuplicate = enrichmentResult?.is_duplicate;

  if (relationship === "unrelated") {
    return "merge cannot be executed because enrichment marked the files as unrelated";
  }
  if (isDuplicate === false) {
    return "merge cannot be executed because enrichment concluded the files are not duplicates";
  }
  if (suggestion.confidence === "low") {
    return "merge cannot be executed because the suggestion confidence is low";
  }

  return null;
}

async function compensateExecutedSuggestion(
  platformCtx: PlatformContext,
  undoEntries: UndoEntry[],
): Promise<void> {
  const sortedEntries = [...undoEntries].sort(
    (a, b) => (b.actionGroupStep ?? 0) - (a.actionGroupStep ?? 0),
  );

  for (const entry of sortedEntries) {
    await executeUndo(
      platformCtx,
      entry.action,
      entry.undoPayload,
      entry.actionGroupStep,
    );
  }
}

export const suggestionsRouter = Router();

/** POST /suggestions — receive and store a new suggestion */
suggestionsRouter.post(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { platform, action, title, description, confidence, fileIds, reason } = req.body ?? {};

    if (!isValidPlatform(platform)) {
      return res.status(400).json({ error: "platform must be 'google_drive' or 'notion'" });
    }
    if (!isValidAction(action)) {
      return res.status(400).json({ error: "action must be one of: archive, merge, rename, review, edit" });
    }
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (typeof description !== "string" || !description.trim()) {
      return res.status(400).json({ error: "description is required" });
    }
    if (!isValidConfidence(confidence)) {
      return res.status(400).json({ error: "confidence must be 'high', 'medium', or 'low'" });
    }
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: "fileIds must be a non-empty array" });
    }

    const raw = req.header(PLATFORM_ACCOUNT_HEADER) ?? req.header("X-Platform-Account");
    const accountId = typeof raw === "string" ? raw.trim() : "";

    try {
      const suggestion = await storeSuggestion(res.locals.auth.userId, accountId, {
        platform,
        action,
        title: title.trim(),
        description: description.trim(),
        confidence,
        fileIds,
        reason: typeof reason === "string" ? reason.trim() || undefined : undefined,
      });
      return res.status(201).json({ suggestion });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to store suggestion.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** GET /suggestions — list suggestions with optional filters */
suggestionsRouter.get(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { status, platform, limit, offset } = req.query;

    const parsedLimit = limit !== undefined ? parseInt(String(limit), 10) : 50;
    const parsedOffset = offset !== undefined ? parseInt(String(offset), 10) : 0;

    if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return res.status(400).json({ error: "limit must be between 1 and 200" });
    }
    if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: "offset must be >= 0" });
    }
    if (status !== undefined && !VALID_STATUSES.includes(status as SuggestionStatus)) {
      return res.status(400).json({ error: "status must be one of: pending, confirmed, skipped, dismissed" });
    }
    if (platform !== undefined && !isValidPlatform(platform)) {
      return res.status(400).json({ error: "platform must be 'google_drive' or 'notion'" });
    }

    try {
      const raw = req.header(PLATFORM_ACCOUNT_HEADER) ?? req.header("X-Platform-Account");
      const accountId = typeof raw === "string" ? raw.trim() : "";
      const result = await listSuggestions(res.locals.auth.userId, {
        status: status as SuggestionStatus | undefined,
        platform: platform as ReceiveSuggestionInput["platform"] | undefined,
        accountId: accountId || undefined,
        limit: parsedLimit,
        offset: parsedOffset,
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to fetch suggestions.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** GET /suggestions/:id — get a single suggestion */
suggestionsRouter.get(
  "/:id",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const suggestion = await getSuggestion(res.locals.auth.userId, req.params.id);
      if (!suggestion) {
        return res.status(404).json({ error: "Suggestion not found." });
      }
      return res.json({ suggestion });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to fetch suggestion.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** PATCH /suggestions/:id/status — update suggestion status (confirm / skip / dismiss) */
suggestionsRouter.patch(
  "/:id/status",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { status } = req.body ?? {};

    if (!VALID_STATUS_UPDATES.includes(status)) {
      return res
        .status(400)
        .json({ error: "status must be one of: pending, confirmed, skipped, dismissed" });
    }

    try {
      const userId = res.locals.auth.userId;
      const suggestionId = req.params.id;

      // For confirmed status, execute the action on the platform
      if (status === "confirmed") {
        const suggestion = await getSuggestion(userId, suggestionId);
        if (!suggestion) {
          return res.status(404).json({ error: "Suggestion not found." });
        }

        // Guard: only process pending suggestions
        if (suggestion.status !== "pending") {
          return res.status(409).json({
            error: "Suggestion has already been processed.",
            currentStatus: suggestion.status,
          });
        }

        const accountId = suggestion.accountId;
        if (!accountId) {
          return res.status(409).json({
            error: "Suggestion cannot be executed because it has no platform account.",
          });
        }

        // Execute the action and store undo entries in a transaction
        try {
          const platformCtx: PlatformContext = {
            userId,
            accountId,
            platform: suggestion.platform as "google_drive" | "notion",
          };

          // Extract action-specific parameters from request body
          const { newName } = req.body ?? {};

          // Execute appropriate action
          let undoEntries;
          if (suggestion.action === "archive") {
            undoEntries = await executeArchive(platformCtx, suggestion.fileIds[0]);
          } else if (suggestion.action === "rename") {
            if (typeof newName !== "string" || !newName.trim()) {
              return res.status(400).json({
                error: "rename action requires 'newName' in request body",
              });
            }
            undoEntries = await executeRename(platformCtx, suggestion.fileIds[0], newName.trim());
          } else if (suggestion.action === "merge") {
            const mergeBlockReason = readMergeBlockReason(suggestion);
            if (mergeBlockReason) {
              return res.status(409).json({ error: mergeBlockReason });
            }
            undoEntries = await executeMerge(platformCtx, suggestion.fileIds[0], suggestion.fileIds[1]);
          } else if (suggestion.action === "edit") {
            const editPatch = (suggestion.analysis as Record<string, unknown> | null | undefined)?.editPatch;
            if (!isEditPatch(editPatch)) {
              return res.status(409).json({
                error: "edit action requires a valid stored editPatch in suggestion analysis",
              });
            }
            undoEntries = await executeEdit(platformCtx, suggestion.fileIds[0], editPatch);
          } else if (suggestion.action === "review") {
            return res.status(400).json({
              error: "review action is not executable (user must act manually)",
            });
          } else {
            return res.status(400).json({ error: `Action '${suggestion.action}' not supported for execution` });
          }

          // Store undo entries and update suggestion status in a transaction
          try {
            await withUserTransaction(userId, async (client) => {
              // Store each undo entry
              for (const entry of undoEntries) {
                await client.query(
                  `insert into public.undo_history
                    (user_id, suggestion_id, action, platform, action_details, undo_payload,
                     account_id, action_group_id, action_group_step, expires_at)
                   values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
                  [
                    userId,
                    suggestionId,
                    entry.action,
                    entry.platform,
                    JSON.stringify(entry.actionDetails),
                    JSON.stringify(entry.undoPayload),
                    accountId,
                    entry.actionGroupId ?? null,
                    entry.actionGroupStep ?? null,
                    entry.expiresAt ?? null,
                  ],
                );
              }

              // Update suggestion status
              await client.query(
                `update public.suggestions
                 set status = $2, confirmed_at = now()
                 where user_id = $1 and id = $3`,
                [userId, "confirmed", suggestionId],
              );
            });
          } catch (persistError) {
            try {
              await compensateExecutedSuggestion(platformCtx, undoEntries);
            } catch (compensationError) {
              throw new CompensationError(
                "Failed to persist executed suggestion and failed to compensate platform changes",
                persistError instanceof Error ? persistError : new Error("Unknown persistence error"),
                compensationError instanceof Error ? compensationError : new Error("Unknown compensation error"),
              );
            }
            throw persistError;
          }

          // Return updated suggestion
          const updated = await getSuggestion(userId, suggestionId);
          return res.json({
            suggestion: updated,
            undoRef: undoEntries.length === 1
              ? undoEntries[0].actionGroupId || suggestionId  // Single entry or use group ID if present
              : undoEntries[0].actionGroupId, // For grouped entries, use action_group_id
          });
        } catch (executorError) {
          const errorMessage = executorError instanceof Error ? executorError.message : "Unknown error";
          const reviewSuggestion = suggestion.action === "review"
            ? suggestion
            : await markSuggestionForReview(userId, suggestionId, {
                originalAction: suggestion.action,
                errorMessage,
              });

          if (executorError instanceof Error) {
            if (executorError instanceof CompensationError) {
              return res.status(502).json({
                error: "Platform action failed and automatic rollback also failed. Suggestion was moved to review.",
                message: executorError.originalError.message,
                compensationError: executorError.compensationError.message,
                suggestion: reviewSuggestion,
              });
            }
            if (executorError.message.includes("not yet implemented")) {
              return res.status(501).json({
                error: "This action executor is not yet implemented",
                message: executorError.message,
                suggestion: reviewSuggestion,
              });
            }
            return res.status(502).json({
              error: "Platform API call failed. Suggestion was moved to review.",
              message: executorError.message,
              suggestion: reviewSuggestion,
            });
          }
          return res.status(502).json({
            error: "Platform API call failed. Suggestion was moved to review.",
            suggestion: reviewSuggestion,
          });
        }
      }

      // For non-confirmed statuses (skip, dismiss), just update DB
      const suggestion = await updateSuggestionStatus(userId, suggestionId, { status });
      if (!suggestion) {
        return res.status(404).json({ error: "Suggestion not found." });
      }
      return res.json({ suggestion });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to update suggestion status.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** PATCH /suggestions/:id/enrichment — apply extension BYOK enrichment */
suggestionsRouter.patch(
  "/:id/enrichment",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { action, title, description, reason, confidence, analysis } = req.body ?? {};

    if (action !== undefined && !isValidAction(action)) {
      return res.status(400).json({ error: "action must be one of: archive, merge, rename, review, edit when provided" });
    }

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return res.status(400).json({ error: "title must be a non-empty string when provided" });
    }
    if (description !== undefined && (typeof description !== "string" || !description.trim())) {
      return res.status(400).json({ error: "description must be a non-empty string when provided" });
    }
    if (reason !== undefined && reason !== null && typeof reason !== "string") {
      return res.status(400).json({ error: "reason must be a string or null when provided" });
    }
    if (confidence !== undefined && !VALID_CONFIDENCE.includes(confidence)) {
      return res.status(400).json({ error: "confidence must be 'high', 'medium', or 'low' when provided" });
    }
    if (analysis !== undefined && (typeof analysis !== "object" || analysis === null || Array.isArray(analysis))) {
      return res.status(400).json({ error: "analysis must be an object when provided" });
    }

    try {
      const suggestion = await applySuggestionEnrichment(res.locals.auth.userId, req.params.id, {
        action,
        title: typeof title === "string" ? title.trim() : undefined,
        description: typeof description === "string" ? description.trim() : undefined,
        reason: typeof reason === "string" ? reason.trim() : reason ?? undefined,
        confidence,
        analysis: analysis as Record<string, unknown> | undefined,
      });
      if (!suggestion) {
        return res.status(404).json({ error: "Suggestion not found or not eligible for enrichment." });
      }
      return res.json({ suggestion });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to apply suggestion enrichment.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
