# DriveSense — Tasks

## Infrastructure
- [x] Initialize Node.js backend with TypeScript
- [x] Defer Python backend from active MVP path
- [x] Set up Docker configuration for active Node API service
- [x] Create `.env.example` and basic configuration files
- [x] Initialize database schema (undo history, rules, settings, suggestions) — using Supabase PostgreSQL
- [x] BYOK key management direction — browser-local storage, no backend persistence
- [x] User settings schema

## Mock Data & Dev Setup
- [x] SQL-first local dev seed (`infrastructure/supabase/seeds/dev_seed.sql`)
- [x] Keep seeded suggestion payloads deterministic and easy to reset

## Core Intelligence (TypeScript / Extension)
- [x] Context detector — identify current Drive file/folder or Notion page
- [x] Browser-local BYOK key storage and provider selection
- [x] Lightweight file scanner — inspect whitelisted current context
- [x] Exact duplicate detection (content hash)
- [x] Near-duplicate detection (text similarity scoring)
- [x] Staleness detector (metadata + LLM reasoning)
- [x] Rule engine — declarative rule evaluation shared by extension and Node API
- [x] Unified LLM interface — adapter pattern (Gemini default, OpenAI, Claude, GLM)
- [x] Prompt templates (see PROMPTS.md)
- [x] Prompt logging for debugging without secrets or raw full content
- [x] Contextual suggestion card builder

## Early Validation (do this before full UI)
- [x] End-to-end flow: open mock file/folder context → generate suggestion → display popup/card JSON
- [x] Confirm suggestion schema works for all action types (archive, merge, rename)
- [x] Validate rule engine correctly blocks suggestions on whitelisted folders

## Node API & Persistence
- [x] Session and user management
- [x] Suggestion queue — receive, store, serve suggestions
- [x] Undo history — log actions, rollback support
- [x] Rules CRUD
- [x] Settings persistence
- [x] Free-call quota tracking for users without BYOK
- [x] Server-owned LLM proxy for limited free calls

## Platform Integrations
- [ ] Google Drive API — list, read, move, trash files
- [ ] Notion API — query databases, read/update pages
- [ ] Google Drive OAuth flow
- [ ] Notion OAuth flow

## Frontend & UX
- [ ] Settings panel (LLM selection, API key input, folder whitelist)
- [ ] Contextual suggestion popup/card with reason + confirm/skip/dismiss
- [ ] Suggestion queue list view for later review
- [ ] Rule editor interface
- [ ] Undo history viewer
- [ ] Browser extension scaffolding
- [ ] Web dashboard scaffolding (secondary)

## Testing & Polish
- [ ] Unit tests — TypeScript core intelligence
- [ ] Unit tests — Browser extension flows
- [ ] Unit tests — Node API layer
- [ ] Integration tests — end-to-end suggestion flow
- [ ] API documentation
- [ ] User guide

## Deferred / Optional
- [ ] Python FastAPI engine for future heavy batch processing, embeddings, or document parsing
