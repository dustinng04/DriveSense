# DriveSense

> A silent file hygiene assistant for Google Drive and Notion. Detects duplicates, stale files, and clutter—suggests actions, never acts without permission.

---

## Demo

Suggestion flow: merging duplicate docs in Notion
![My Demo](./assets/merge-demo.gif)
---

## Why DriveSense?

After years of accumulated files across Google Drive and Notion, your workspace becomes cluttered with duplicates, outdated documents, and forgotten drafts. DriveSense watches your context, detects redundancy and staleness, and surfaces gentle, actionable suggestions—**without ever moving, archiving, or deleting anything on its own**.

**Built for power users and small teams** who care about their data and want smarter maintenance without surrendering control to a black box.

---

## Core Principles

- **Suggest, never act unilaterally** — Every action requires your explicit confirmation
- **Explain every suggestion** — You always see *why* a file is flagged before deciding
- **Respect boundaries** — No folder is touched unless you explicitly whitelist it
- **Undo everything** — All actions are logged and reversible with one click
- **Privacy by design** — File content is analyzed ephemerally; only metadata and suggestions are stored
- **Bring your own key (BYOK)** — Optionally use your own LLM API key, stored locally in your browser—never on our servers

---

## Features

### Intelligent File Analysis

- **Duplicate Detection**: Identifies exact and near-duplicate files (≥90% similarity)
- **Staleness Detection**: Flags outdated files based on last modified date, access history, and contextual signals
- **Smart Suggestions**: Recommends archiving, merging, or renaming with plain-language justification

### Contextual Suggestions

- Lightweight popup cards appear when you open files or folders
- Each suggestion includes affected files, proposed action, and reasoning
- Choose: **Confirm**, **Skip**, or **Dismiss forever**

### Rule-Based Control

- Define custom rules DriveSense must always respect
- Examples: never touch `/Legal`, ignore files modified in last 30 days, skip files owned by specific users
- Default: **no folders are watched** until you opt in

### Full Undo History

- Complete audit log of every action taken
- One-click undo per action or bulk rollback
- Never lose control of your data

### Privacy-First Architecture

- File content analyzed locally or ephemerally—never permanently stored
- BYOK API keys stored only in browser local storage
- Server stores only metadata, suggestions, and action history

### Multi-Platform Support

- **Google Drive** (primary)
- **Notion** (secondary)
- Extensible architecture for future platform integrations

---

## Getting Started

**Prerequisites**: Node.js 18+, PostgreSQL (Supabase or local), Google Drive / Notion account.

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/drivesense.git
cd drivesense

cd services/node-api && npm install
cd ../../web && npm install
cd ../extension && npm install
```

### 2. Configure Environment

```bash
cp services/node-api/.env.example services/node-api/.env
```

Fill in your credentials in `services/node-api/.env` — at minimum: `DATABASE_URL`, `SUPABASE_JWT_SECRET`, and your Google Drive / Notion OAuth keys. Everything else has sensible defaults.

### 3. Migrate & Run

```bash
# Run database migrations
cd services/node-api && npm run db:migrate

# Start all three services (separate terminals)
cd services/node-api && npm run dev   # API → http://localhost:3001
cd web && npm run dev                  # Dashboard → http://localhost:5173
cd extension && npm run dev            # Extension (watch mode)
```

### 4. Load the Extension

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/dist` folder.

---

## Quick Start Guide

1. **Connect Your Account**
  - Open the web dashboard at `http://localhost:5173`
  - Connect your Google Drive or Notion account via OAuth
2. **Whitelist Folders**
  - Navigate to Settings → Rules
  - Add folders you want DriveSense to watch (default: none)
3. **Configure Your Preferences**
  - Set staleness thresholds (e.g., "ignore files modified in last 30 days")
  - (Optional) Add your BYOK LLM API key in Settings → Privacy
4. **Get Your First Suggestion**
  - Open a Google Drive folder you've whitelisted
  - DriveSense will scan and surface suggestions via a gentle popup card
  - Review the reason, then choose: Confirm, Skip, or Dismiss
5. **Undo Anytime**
  - Visit the web dashboard → History
  - One-click undo for any action taken

---

## Architecture

```
┌─────────────────────────┐
│  Browser Extension      │  ← Contextual detection, BYOK key storage, suggestion cards
│  (Chrome MV3)           │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Node.js API            │  ← Auth, rules, scanner, suggestions, undo log, free-call quota
│  (TypeScript + Express) │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Supabase PostgreSQL    │  ← Persistence + Realtime suggestion feed
│  (with RLS)             │
└─────────────────────────┘
```

**Tech Stack**:

- **Frontend**: React 19, TypeScript, Vite
- **Extension**: Manifest V3, TypeScript
- **Backend**: Node.js (TypeScript), Express
- **Database**: PostgreSQL (Supabase)
- **Realtime**: Supabase Realtime / SSE

---

## Roadmap

### Current MVP Features ✅

- Duplicate and staleness detection (text-based similarity)
- Contextual suggestion cards
- Rule-based whitelisting
- Full undo history
- BYOK LLM support
- Google Drive + Notion integration

### Next Up 🚀

**Phase 1: Understand file meaning, not just text**
Find duplicates even when they're worded differently. No more missing related documents just because they don't share keywords.

**Phase 2: Auto-organize files by what they're about**
Invoices, contracts, meeting notes—automatically tagged. Let AI suggest categories or define your own. The system learns from your corrections.

**Phase 3: Smarter suggestions that see the big picture**

- "Files A, B, C are all variations of the same document"
- "Found 15 related files—want to organize them together?"
- Learns from your patterns over time

**Phase 4: See how your files connect**
Find everything related to a project, client, or topic in one view. Visual map of document relationships and evolution.

---

## Contributing

We welcome contributions! Whether it's bug reports, feature requests, or pull requests:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/your-feature`)
3. **Commit your changes** (`git commit -m 'Add some feature'`)
4. **Push to the branch** (`git push origin feature/your-feature`)
5. **Open a Pull Request**

Please read [AGENTS.md](./AGENTS.md) for development guidelines and architecture context.

---

## Try It Now

**Status**: Local MVP ready, extension not yet published to Chrome Web Store.

To run DriveSense locally, follow the [Getting Started](#getting-started) guide above.

⭐ **Star this repo** if you're interested in cleaner, smarter file management!

---

## License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE) for details.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/drivesense/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/drivesense/discussions)

---

**Made with care for power users who refuse to surrender control of their data.**