export const PROVIDERS = ["gemini", "openai", "anthropic", "glm"] as const;
export const SCAN_SCHEDULES = ["manual", "daily", "weekly"] as const;

export type Provider = (typeof PROVIDERS)[number];
export type ScanSchedule = (typeof SCAN_SCHEDULES)[number];
export type Platform = "google_drive" | "notion";
export type TabId = "overview" | "suggestions" | "rules" | "history" | "settings";

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  action: "archive" | "merge" | "rename" | "review";
  confidence: "high" | "medium" | "low";
  status: "pending" | "confirmed" | "skipped" | "dismissed";
  fileIds: string[];
  platform: Platform;
  reason?: string;
}

export interface Settings {
  llmProvider: Provider;
  timezone: string;
  promptLoggingEnabled: boolean;
  scanSchedule: ScanSchedule;
  staleAfterDays: number;
  notAccessedAfterDays: number;
  similarityThreshold: number;
  suggestionNotifications: {
    dashboard: boolean;
    realtime: boolean;
  };
  preferences: Record<string, unknown>;
}

export interface FolderBlacklistRule {
  type: "folder_blacklist";
  path: string;
  platform: Platform;
}

export interface FiletypeWhitelistRule {
  type: "filetype_whitelist";
  allowedTypes: string[];
}

export interface KeywordGuardRule {
  type: "keyword_guard";
  keywords: string[];
}

export type Rule = FolderBlacklistRule | FiletypeWhitelistRule | KeywordGuardRule;

export interface UndoAction {
  id: string;
  suggestionId: string | null;
  action: string;
  platform: Platform;
  actionDetails: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
  executedAt: string;
  undoStatus: "available" | "expired" | "failed" | "done";
  undoError?: string;
  accountId?: string;
  actionGroupId?: string;
  actionGroupStep?: number;
  expiresAt?: string;
}

export interface ProviderKeys {
  gemini: string;
  openai: string;
  anthropic: string;
  glm: string;
}

export interface UndoHistoryGroup {
  undoRef: string;
  entries: UndoAction[];
  primaryEntry: UndoAction;
}

export interface ConnectionAccount {
  accountId: string;
  isPrimary: boolean;
}

export interface ProviderConnectionStatus {
  connected: boolean;
  accounts: ConnectionAccount[];
}

export interface LinkedAccountsPayload {
  google_drive: string[];
  notion: string[];
}

export interface OAuthAccountSummary {
  provider: Platform;
  accountId: string;
  accountEmail: string | null;
  isPrimary: boolean;
}

export interface SessionData {
  userId: string;
  claims: unknown;
  linkedAccounts: LinkedAccountsPayload;
  oauthAccounts: OAuthAccountSummary[];
}

export interface ProviderOverviewAccount {
  accountId: string;
  accountEmail: string | null;
  isPrimary: boolean;
}

export interface ProviderOverviewState {
  provider: Platform;
  label: string;
  connected: boolean;
  accounts: ProviderOverviewAccount[];
}
