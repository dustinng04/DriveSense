# DriveSense Frontend (Web & Extension)

This `AGENTS.md` provides context, commands, and architectural rules for the frontend layer of DriveSense.

## 🎨 Design System: Refined Utilitarian

The frontend follows the **Refined Utilitarian** aesthetic. It prioritizes clarity, calm, and trustworthiness over high-contrast or neon patterns.

### 🏛 Layout & Anatomy
- **Web Dashboard**: Uses a centered, **single-column settings layout** (max 640px) to reduce cognitive load. Sidebars are avoided; navigation is handled via a minimal top-level bar.
- **Extension Popup**: Fixed 360px width. Features a **Wordmark** (top-left) and a **Status Strip** (below header) indicating the current watch state.
- **Suggestion Cards**:
  - **Icon-first**: Uses meaningful icons (e.g., 📦 for Archive, 📑 for Merge).
  - **Invitational Actions**: Action buttons use question-style microcopy (e.g., "Move to archive?" instead of "Archive Now").
  - **Secondary Actions**: Non-critical actions (Skip, Not now) use subtle ghost styling.

### 🔡 Typography
- **Headings**: `Fraunces` for a soft, calm feel.
- **Body & Logic**: `Plus Jakarta Sans` (Body) and `IBM Plex Mono` (Metadata/Code) for high readability at small sizes.

### 🎨 Color Palette (Warm Neutrals)
- **Base**: Warm whites and soft greys (`#F7F5F2`, `#EFECE8`).
- **Accent (Sage)**: `#5C7A6E` used for primary interactions and "Watching" states.
- **Signal (Amber)**: `#C47B3A` reserved exclusively for critical status (e.g., "Pending Review").
- **Dark Mode**: High-contrast blacks are avoided; use deep charcoals and warm dark tones (`#181613`).

### 🕊 Microcopy Principles
- **Calm & Non-Imperative**: Avoid aggressive verbs. Use "Still looking..." instead of "Searching", and "Watching items" instead of "Active".
- **Invitational**: Prompt the user with questions rather than commands.

## 🛠 Commands

### Web Dashboard (`/web`)
- `npm run dev`: Starts the Vite dev server.
- `npm run build`: Typechecks and builds the React app for production.
- `npm run lint`: Runs ESLint over the source files.

### Browser Extension (`/extension`)
- `npm run dev`: Builds the extension in watch mode for development.
- `npm run build`: Typechecks and builds the extension for production.

## 🏗 Architecture

1. **Web Dashboard (`/web`)**: 
   - React 19, TypeScript, Vite.
   - Responsible for deep configuration, rule management, and undo history.
   - **Centered layout** is enforced in `App.css` via the `.single-column` utility.

2. **Browser Extension (`/extension`)**: 
   - Manifest V3, TypeScript, Vite.
   - **Background**: Syncs state and handles context.
   - **Content**: Injects the **Suggestion Overlay** using fully isolated inline styles. Overlays must match the Suggestion Card anatomy.
   - **Popup**: Provides a quick view of the "Watching" status and pending count. Status strip dot pulses sage when clear, static amber when items are pending.

## 📝 Code Style & Conventions

- **Design Tokens**: Always use the CSS variables defined in `web/src/App.css` or the popup's `<style>` block. Never hardcode hex values.
- **Isolated Styling (Content Script)**: Content scripts must use `style.cssText` or a shadow DOM (if implemented) to prevent style leakage.
- **BYOK Security**: API keys MUST stay in local browser storage. NEVER send keys to the backend.
- **Error Handling**: Use the `StatusBar` (Web) or `FooterStatus` (Extension) for human-readable feedback.

## 🔍 Development Workflow

1. **Extension**: Run `npm run dev` in `/extension`. Load `dist` in `chrome://extensions`.
2. **Web**: Run `npm run dev` in `/web`. Requires `node-api` to be running for full functionality.
