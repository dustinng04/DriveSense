/**
 * Shared TypeScript types used across the extension's background worker,
 * content script, and popup. Mirrors the schemas from:
 *  - web/src/components/SuggestionCard.tsx
 *  - services/node-api/src/suggestions, rules, undo-history
 */

export type Platform = 'google_drive' | 'notion';
export type Provider = 'gemini' | 'openai' | 'anthropic' | 'glm';
export type SuggestionAction = 'archive' | 'merge' | 'rename' | 'review';
export type SuggestionStatus = 'pending' | 'confirmed' | 'skipped' | 'dismissed';
export type Confidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  action: SuggestionAction;
  confidence: Confidence;
  status: SuggestionStatus;
  fileIds: string[];
  platform: Platform;
  reason?: string;
}

export interface UserSettings {
  llmProvider: Provider;
  llmModel: string | null;
}

// ---  Rules ---

export interface FolderWhitelistRule {
  type: 'folder_whitelist';
  path: string;
  platform: Platform;
}

export interface FolderBlacklistRule {
  type: 'folder_blacklist';
  path: string;
  platform: Platform;
}

export interface FiletypeWhitelistRule {
  type: 'filetype_whitelist';
  allowed_types: string[];
}

export interface KeywordGuardRule {
  type: 'keyword_guard';
  keywords: string[];
}

export type Rule =
  | FolderWhitelistRule
  | FolderBlacklistRule
  | FiletypeWhitelistRule
  | KeywordGuardRule;

// --- Undo History ---

export interface UndoAction {
  id: string;
  suggestionId: string | null;
  action: string;
  platform: Platform;
  actionDetails: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
  executedAt: string;
  undoneAt: string | null;
}

// --- Extension-specific storage types ---

/** Keys available in chrome.storage.local */
export interface ExtensionStorage {
  /** Per-provider BYOK API keys — never sent to the Node API */
  byokKeys: Partial<Record<Provider, string>>;
  /** Bearer token for the DriveSense Node API */
  authToken: string;
  /** Cached pending suggestions (refreshed by background worker) */
  pendingSuggestions: Suggestion[];
  /** ID of the last suggestion shown in an overlay, to prevent re-showing */
  lastShownSuggestionId: string | null;
  /** Currently active context detected by the content script */
  activeContext: {
    platform: Platform;
    accountEmail?: string;
    url: string;
    fileId?: string;
  } | null;
}

// --- Extension messaging ---

export type BackgroundMessage =
  | { type: 'CONTEXT_DETECTED'; platform: Platform; url: string; fileId?: string; accountEmail?: string }
  | { type: 'GET_BYOK_KEY'; provider: Provider }
  | { type: 'GET_PENDING_COUNT' }
  | { type: 'DISMISS_SUGGESTION'; id: string }
  | { type: 'PING' };

export type BackgroundResponse =
  | { type: 'BYOK_KEY'; key: string }
  | { type: 'PENDING_COUNT'; count: number }
  | { type: 'SUGGESTIONS'; suggestions: Suggestion[] }
  | { type: 'OK' }
  | { type: 'ERROR'; message: string };
