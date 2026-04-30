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
- [x] Lightweight file scanner — metadata only, no content fetch (content fetch is Orchestrator responsibility)
- [x] Local metadata index — storage, TTL, staleness flags, serverSynced field
- [x] Index lifecycle — initial crawl on whitelist, incremental update on trigger, 24h expiry
- [ ] Cross-folder comparison using local index
- [x] Exact duplicate detection (content hash)
- [x] Near-duplicate detection (text similarity scoring)
- [x] Subset/containment detection (one-sided similarity for summary vs full doc)
- [x] Relationship classifier — exact / near-duplicate / subset / unrelated
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
- [ ] Analysis Orchestrator — metadata filter → rejection check → selective content fetch → analysis → LLM enrichment (need check again)
- [ ] Rejection history — persist dismissed suggestions, check before generating new ones (need test)
- [x] Supabase Realtime subscription — progressive suggestion delivery to extension

## Platform Integrations
- [x] Google Drive API — list, read, move, trash files
- [x] Notion API — query databases, read/update pages
- [x] Google Drive OAuth flow
- [x] Notion OAuth flow

## Frontend & UX
- [x] Settings panel (LLM selection, API key input, folder whitelist)
- [x] Contextual suggestion popup/card with reason + confirm/skip/dismiss
  - Phase 7 update: wired extension confirm -> background -> API flow and added inline undo toast for confirmed suggestions
- [x] Suggestion queue list view for later review
- [x] Rule editor interface
- [x] Undo history viewer
  - Phase 7 update: refreshed dashboard history from server after undo and grouped multi-step undo actions by `action_group_id` with current `undo_status`
- [x] Browser extension scaffolding
- [x] Web dashboard scaffolding (secondary)

## Testing & Polish
- [ ] Unit tests — TypeScript core intelligence
- [ ] Unit tests — Browser extension flows
- [ ] Unit tests — Node API layer
- [ ] Integration tests — end-to-end suggestion flow
- [ ] API documentation
- [ ] User guide

## Deferred / Optional
- [ ] Classification tool — semantic file categorization (requires embedding pipeline, pgvector in Supabase, serverSynced index field)
- [ ] Embedding pipeline — vector storage for semantic similarity (Python FastAPI or serverside)
