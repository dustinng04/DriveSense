import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import {
  getRules,
  getOrCreateRules,
  addRule,
  removeRuleAt,
  replaceAllRules,
  type Rule,
} from "./repository.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

const VALID_RULE_TYPES = [
  "folder_whitelist",
  "folder_blacklist",
  "filetype_whitelist",
  "keyword_guard",
] as const;
const VALID_PLATFORMS = ["google_drive", "notion"] as const;

function isValidRuleType(v: unknown): v is Rule["type"] {
  return VALID_RULE_TYPES.includes(v as never);
}

function isValidPlatform(v: unknown): v is "google_drive" | "notion" {
  return VALID_PLATFORMS.includes(v as never);
}

function validateRule(rule: unknown): rule is Rule {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    return false;
  }

  const r = rule as Record<string, unknown>;
  if (!isValidRuleType(r.type)) {
    return false;
  }

  switch (r.type) {
    case "folder_whitelist":
    case "folder_blacklist":
      return (
        typeof r.path === "string" &&
        r.path.trim().length > 0 &&
        isValidPlatform(r.platform)
      );
    case "filetype_whitelist":
      return (
        Array.isArray(r.allowedTypes) &&
        r.allowedTypes.every((t) => typeof t === "string" && t.length > 0)
      );
    case "keyword_guard":
      return (
        Array.isArray(r.keywords) &&
        r.keywords.every((k) => typeof k === "string" && k.length > 0)
      );
    default:
      return false;
  }
}

export const rulesRouter = Router();

/** GET /rules — get current rules */
rulesRouter.get(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const stored =
        (await getRules(res.locals.auth.userId)) ||
        (await getOrCreateRules(res.locals.auth.userId));
      return res.json(stored);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to fetch rules.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** POST /rules — add a new rule */
rulesRouter.post(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const rule = req.body;

    if (!validateRule(rule)) {
      return res.status(400).json({
        error: "Invalid rule format",
        details:
          "Rule must be one of: folder_whitelist, folder_blacklist, filetype_whitelist, keyword_guard",
      });
    }

    try {
      const updated = await addRule(res.locals.auth.userId, rule);
      return res.status(201).json(updated);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to add rule.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/** DELETE /rules/:index — remove a rule by index */
rulesRouter.delete(
  "/:index",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const index = parseInt(req.params.index, 10);

    if (Number.isNaN(index) || index < 0) {
      return res.status(400).json({ error: "index must be a non-negative integer" });
    }

    try {
      const updated = await removeRuleAt(res.locals.auth.userId, index);
      return res.json(updated);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to remove rule.",
      });
    }
  },
);

/** PUT /rules — replace all rules */
rulesRouter.put(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { rules } = req.body ?? {};

    if (!Array.isArray(rules)) {
      return res
        .status(400)
        .json({ error: "rules must be an array" });
    }

    for (const rule of rules) {
      if (!validateRule(rule)) {
        return res.status(400).json({
          error: "Invalid rule format in array",
          details:
            "Each rule must be one of: folder_whitelist, folder_blacklist, filetype_whitelist, keyword_guard",
        });
      }
    }

    try {
      const updated = await replaceAllRules(res.locals.auth.userId, rules);
      return res.json(updated);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to update rules.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);
