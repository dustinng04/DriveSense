# DriveSense Python Engine

This service is deferred from the active MVP path.

DriveSense is now extension-first and TypeScript-first for the MVP. The browser extension handles contextual Drive/Notion detection, browser-local BYOK key storage, lightweight analysis, and suggestion popups. The Node API handles persistence, settings, rules, undo history, and future free-call quota/proxying.

Keep this FastAPI skeleton only as an optional future engine for workloads that genuinely need Python, such as heavy batch processing, embeddings, advanced document parsing, or ML-specific jobs.

To run it explicitly:

```sh
docker compose -f infrastructure/docker-compose.yml --profile deferred up py-engine
```
