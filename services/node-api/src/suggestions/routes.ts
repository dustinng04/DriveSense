import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import {
  storeSuggestion,
  listSuggestions,
  getSuggestion,
  updateSuggestionStatus,
  applySuggestionEnrichment,
  type ReceiveSuggestionInput,
  type SuggestionStatus,
} from "./repository.js";
import { PLATFORM_ACCOUNT_HEADER } from "../auth/platformAccount.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

const VALID_ACTIONS = ["archive", "merge", "rename", "review"] as const;
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
      return res.status(400).json({ error: "action must be one of: archive, merge, rename, review" });
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
      const result = await listSuggestions(res.locals.auth.userId, {
        status: status as SuggestionStatus | undefined,
        platform: platform as ReceiveSuggestionInput["platform"] | undefined,
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
      const suggestion = await updateSuggestionStatus(res.locals.auth.userId, req.params.id, {
        status,
      });
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
    const { title, description, reason, confidence, analysis } = req.body ?? {};

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
