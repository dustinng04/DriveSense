import express from "express";
import { config } from "./config.js";

const app = express();

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

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`node-api listening on :${config.port} (${config.nodeEnv})`);
});

