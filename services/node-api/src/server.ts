import express from "express";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { contextDetector } from "./context/detector.js";
import { skillTriggers } from "./skills/triggers.js";
import { skillLoader } from "./skills/loader.js";
import type { ContextMetadata } from "./context/types.js";
import type { SkillOperation } from "./skills/types.js";
import { generateValidationSuggestions } from "./suggestions/devValidation.js";
import { requireAuth } from "./auth/middleware.js";
import { settingsRouter } from "./settings/routes.js";
import { suggestionsRouter } from "./suggestions/routes.js";
import { undoHistoryRouter } from "./undo-history/routes.js";
import { rulesRouter } from "./rules/routes.js";
import { freeCallsRouter } from "./free-calls/routes.js";
import type { AuthenticatedRequestContext } from "./auth/types.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "node-api" });
  });

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "node-api",
      architecture: "extension-first",
      pyEngineEnabled: Boolean(config.pyEngineBaseUrl),
    });
  });

  app.post("/context/detect", (req, res) => {
    const { url, metadata } = req.body as { url?: string; metadata?: ContextMetadata };
    
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }
    
    try {
      const context = contextDetector.detect(url, metadata);
      return res.json(context);
    } catch (error) {
      return res.status(500).json({ 
        error: "Failed to detect context",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/skills", (_req, res) => {
    const skills = skillTriggers.getAllSkills();
    return res.json({ skills });
  });

  app.get("/skills/:name", (req, res) => {
    const { name } = req.params;
    const skill = skillTriggers.getSkillByName(name);
    
    if (!skill) {
      return res.status(404).json({ error: "Skill not found" });
    }
    
    return res.json(skill);
  });

  app.get("/skills/:name/status", async (req, res) => {
    const { name } = req.params;
    const metadata = skillLoader.getSkillMetadata(name);
    
    if (!metadata) {
      return res.status(404).json({ error: "Skill not found" });
    }
    
    const isLoaded = skillLoader.isLoaded(name);
    
    return res.json({
      name,
      isLoaded,
      metadata,
      authenticated: false,
    });
  });

  app.post("/context/match-skills", (req, res) => {
    const { url, metadata, operations } = req.body as { 
      url?: string; 
      metadata?: ContextMetadata;
      operations?: SkillOperation[];
    };
    
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }
    
    try {
      const context = contextDetector.detect(url, metadata);
      const matchingSkills = skillTriggers.findMatchingSkills(context, operations);
      
      return res.json({
        context,
        matchingSkills,
        count: matchingSkills.length,
      });
    } catch (error) {
      return res.status(500).json({ 
        error: "Failed to match skills",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/dev/suggestions/validate", async (req, res) => {
    try {
      const payload = await generateValidationSuggestions(req.body ?? {});
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to generate validation suggestions",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get(
    "/session/me",
    requireAuth,
    (_req, res: express.Response<unknown, AuthenticatedLocals>) => {
      return res.json({
        userId: res.locals.auth.userId,
        claims: res.locals.auth.claims,
      });
    },
  );

  app.use("/settings", requireAuth, settingsRouter);
  app.use("/suggestions", requireAuth, suggestionsRouter);
  app.use("/undo-history", requireAuth, undoHistoryRouter);
  app.use("/rules", requireAuth, rulesRouter);
  app.use("/llm/free-call", requireAuth, freeCallsRouter);

  return app;
}

const app = createApp();

const shouldStartServer =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (shouldStartServer) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`node-api listening on :${config.port} (${config.nodeEnv})`);
  });
}

