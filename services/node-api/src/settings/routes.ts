import { Router, type Request, type Response } from "express";
import { getOrCreateUserSettings, patchUserSettings } from "./repository.js";
import { parseSettingsPatch } from "./validation.js";
import type { AuthenticatedRequestContext } from "../auth/types.js";
import type { UserSettingsPatch } from "../settings.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

export const settingsRouter = Router();

settingsRouter.get(
  "/",
  async (_req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const settings = await getOrCreateUserSettings(res.locals.auth.userId);
      return res.json({ settings });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to load settings.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

settingsRouter.patch(
  "/",
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    let patch: UserSettingsPatch;
    try {
      patch = parseSettingsPatch(req.body ?? {});
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid settings patch.",
      });
    }

    try {
      const settings = await patchUserSettings(res.locals.auth.userId, patch);
      return res.json({ settings });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to update settings.",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

