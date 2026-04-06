import { Router, type Request, type Response } from "express";
import { createLlmAdapter, getDefaultLlmModel } from "../llm/adapters.js";
import type { LlmMessage } from "../llm/types.js";
import { config } from "../config.js";
import { consumeFreeCall, getFreeCallQuota } from "./repository.js";
import type { AuthenticatedRequestContext } from "../auth/types.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

const VALID_ROLES: LlmMessage["role"][] = ["system", "user", "assistant"];

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessages(value: unknown): LlmMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }

  const parsed: LlmMessage[] = value.map((entry) => {
    if (!isObjectLike(entry)) {
      throw new Error("Each message must be an object.");
    }
    if (!VALID_ROLES.includes(entry.role as LlmMessage["role"])) {
      throw new Error("message.role must be one of: system, user, assistant.");
    }
    if (typeof entry.content !== "string" || !entry.content.trim()) {
      throw new Error("message.content must be a non-empty string.");
    }

    return {
      role: entry.role as LlmMessage["role"],
      content: entry.content.trim(),
    };
  });

  return parsed;
}

export const freeCallsRouter = Router();

freeCallsRouter.get(
  "/quota",
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const quota = await getFreeCallQuota(res.locals.auth.userId);
      return res.json({ quota });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to load free-call quota.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

freeCallsRouter.post(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { byok, messages, model } = req.body ?? {};

    if (byok !== false) {
      return res.status(400).json({
        error: "byok must be false for free-call proxy requests.",
      });
    }

    let parsedMessages: LlmMessage[];
    try {
      parsedMessages = parseMessages(messages);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid messages payload.",
      });
    }

    if (model !== undefined && (typeof model !== "string" || !model.trim())) {
      return res.status(400).json({
        error: "model must be a non-empty string when provided.",
      });
    }

    if (!config.freeCallGeminiApiKey) {
      return res.status(503).json({
        error: "Free-call proxy is not configured.",
      });
    }

    let quotaDecision: Awaited<ReturnType<typeof consumeFreeCall>>;
    try {
      quotaDecision = await consumeFreeCall(res.locals.auth.userId);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to consume free-call quota.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }

    if (!quotaDecision.allowed) {
      return res.status(429).json({
        error: "Trial quota exceeded. Please connect BYOK to continue.",
        quota: quotaDecision.quota,
      });
    }

    try {
      const gemini = createLlmAdapter("gemini");
      const response = await gemini.generateText({
        apiKey: config.freeCallGeminiApiKey,
        messages: parsedMessages,
        model: model?.trim() || getDefaultLlmModel("gemini"),
      });

      return res.json({
        text: response.text,
        usage: response.usage,
      });
    } catch (error) {
      return res.status(502).json({
        error: "Gemini free-call proxy request failed.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
