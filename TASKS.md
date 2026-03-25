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
- [ ] Create mock dataset (3–4 messy Drive/Notion workspace snapshots)
- [ ] Seed script to load mock data into dev environment
- [ ] Local file fixture loader for offline dev (no real API needed)

## Core Intelligence (TypeScript / Extension)
- [ ] Context detector — identify current Drive file/folder or Notion page
- [ ] Browser-local BYOK key storage and provider selection
- [ ] Lightweight file scanner — inspect whitelisted current context
- [ ] Exact duplicate detection (content hash)
- [ ] Near-duplicate detection (text similarity scoring)
- [ ] Staleness detector (metadata + LLM reasoning)
- [ ] Rule engine — declarative rule evaluation shared by extension and Node API
- [ ] Unified LLM interface — adapter pattern (Gemini default, OpenAI, Claude, GLM)
- [ ] Prompt templates (see PROMPTS.md)
- [ ] Prompt logging for debugging without secrets or raw full content
- [ ] Contextual suggestion card builder

## Early Validation (do this before full UI)
- [ ] End-to-end flow: open mock file/folder context → generate suggestion → display popup/card JSON
- [ ] Confirm suggestion schema works for all action types (archive, merge, rename)
- [ ] Validate rule engine correctly blocks suggestions on whitelisted folders

## Node API & Persistence
- [ ] Session and user management
- [ ] Suggestion queue — receive, store, serve suggestions
- [ ] Undo history — log actions, rollback support
- [ ] Rules CRUD
- [ ] Settings persistence
- [ ] Free-call quota tracking for users without BYOK
- [ ] Server-owned LLM proxy for limited free calls

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
