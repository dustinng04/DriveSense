/**
 * Shared TypeScript types used across the extension's background worker,
 * content script, and popup. Mirrors the schemas from:
 *  - web/src/components/SuggestionCard.tsx
 *  - services/node-api/src/suggestions, rules, undo-history
 */

export type Platform = 'google_drive' | 'notion';

/** Mirrors node-api `oauth_connections` summary rows (non-secret). */
export interface OAuthAccountSummary {
  provider: Platform;
  accountId: string;
  isPrimary: boolean;
}
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

// --- Local Metadata Index ---

/** Metadata for a file as stored in the browser-local index */
export interface IndexedFile {
  /** Platform-native file ID */
  id: string;
  /** Display name / title */
  name: string;
  /** MIME type */
  mimeType: string;
  /** ISO 8601 last-modified timestamp */
  modifiedAt: string;
  /** ISO 8601 creation timestamp, when available */
  createdAt?: string;
  /** File size in bytes, when available */
  sizeBytes?: number;
  /** Human-readable path or breadcrumb */
  path?: string;
  /** Owner email(s) or display names */
  owners?: string[];
  /** Platform this file came from */
  platform: Platform;
  /** Folder/page IDs this file belongs to (for multi-folder tracking) */
  parentFolderIds: string[];
  /** True if metadata has been pushed to Orchestrator and acknowledged */
  serverSynced: boolean;
}

/** Crawl metadata for a folder/page */
export interface FolderCrawlState {
  /** Unix timestamp (ms) when the folder was last crawled */
  crawledAt: number;
  /** Unix timestamp (ms) when the folder was last accessed */
  lastAccessedAt: number;
}

/** Local metadata index state stored in chrome.storage.local */
export interface MetadataIndex {
  /** Schema version; bump when IndexedFile shape or index structure changes */
  version: number;
  /** Map of "platform:accountId:fileId" -> IndexedFile (accountId matches OAuth `account_id`) */
  entries: Record<string, IndexedFile>;
  /** Map of "platform:accountId:folderId" -> FolderCrawlState */
  folderCrawls: Record<string, FolderCrawlState>;
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
    /** Stable platform OAuth `account_id`; when absent, extension may infer a single linked account for that provider */
    accountId?: string;
    url: string;
    fileId?: string;
  } | null;
  /** Last `/session/me` oauth rows — used to map context email → account id for API headers */
  oauthAccountSummaries: OAuthAccountSummary[];
  /** Local metadata index for cross-folder comparison */
  metadataIndex: MetadataIndex;
}

// --- Extension messaging ---

export type BackgroundMessage =
  | {
      type: 'CONTEXT_DETECTED';
      platform: Platform;
      url: string;
      fileId?: string;
      accountId?: string;
    }
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
