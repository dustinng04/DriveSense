/**
 * Fetch wrapper for the DriveSense Node API.
 *
 * API base URL is fixed at extension build time; auth token lives in chrome.storage.local.
 * BYOK keys are NOT sent here — they go directly to LLM providers from the popup / scripts.
 *
 * Provider routes require `X-Platform-Account`; see resolvePlatformAccountHeaders().
 */
import { API_URL } from './buildConfig.js';
import { getAuthToken, storageGet, storageSet } from './storage.js';
import type { OAuthAccountSummary, Platform, Suggestion, UserSettings, Rule } from './types.js';

export const PLATFORM_ACCOUNT_HEADER = 'X-Platform-Account';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Explicit `accountId` from context, or the only linked account for that provider (when unambiguous). */
export function resolveAccountIdForPlatform(
  platform: Platform,
  summaries: OAuthAccountSummary[],
  explicit?: string | undefined,
): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const rows = summaries.filter((s) => s.provider === platform);
  return rows.length === 1 ? rows[0]!.accountId : undefined;
}

async function resolvePlatformAccountHeaders(): Promise<Record<string, string>> {
  const { activeContext, oauthAccountSummaries } = await storageGet('activeContext', 'oauthAccountSummaries');
  if (!activeContext?.platform) {
    return {};
  }

  const accountId = resolveAccountIdForPlatform(
    activeContext.platform,
    oauthAccountSummaries,
    activeContext.accountId,
  );

  if (!accountId) {
    return {};
  }

  return { [PLATFORM_ACCOUNT_HEADER]: accountId };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();

  if (!token) {
    throw new ApiError(401, 'No auth token. Sign in from the DriveSense dashboard and sync the extension.');
  }

  const platformHeaders = await resolvePlatformAccountHeaders();

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...platformHeaders,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, body || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

// --- Typed API helpers ---

export async function fetchPendingSuggestions(): Promise<Suggestion[]> {
  const data = await request<{ suggestions: Suggestion[] }>('/suggestions?status=pending');
  return data.suggestions ?? [];
}

export async function updateSuggestionStatus(
  id: string,
  status: 'confirmed' | 'skipped' | 'dismissed',
  dismissedForever = false,
): Promise<void> {
  await request(`/suggestions/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, dismissedForever }),
  });
}

export async function patchSuggestionEnrichment(
  id: string,
  input: {
    title?: string;
    description?: string;
    reason?: string | null;
    confidence?: 'high' | 'medium' | 'low';
    analysis?: Record<string, unknown>;
  },
): Promise<Suggestion> {
  const data = await request<{ suggestion: Suggestion }>(`/suggestions/${id}/enrichment`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.suggestion;
}

export async function fetchSettings(): Promise<UserSettings> {
  const data = await request<{ settings: UserSettings }>('/settings');
  return data.settings;
}

export async function patchSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const data = await request<{ settings: UserSettings }>('/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
  return data.settings;
}

/** Loads session + caches oauth account rows for platform header resolution and linkage UI. */
export async function fetchSessionMe(): Promise<{
  userId: string;
  linkedAccounts: { google_drive: string[]; notion: string[] };
  oauthAccounts: OAuthAccountSummary[];
}> {
  const data = await request<{
    userId: string;
    linkedAccounts: { google_drive: string[]; notion: string[] };
    oauthAccounts: OAuthAccountSummary[];
  }>('/session/me');

  await storageSet({ 
    oauthAccountSummaries: data.oauthAccounts ?? [],
    userId: data.userId 
  });

  return {
    userId: data.userId,
    linkedAccounts: data.linkedAccounts ?? { google_drive: [], notion: [] },
    oauthAccounts: data.oauthAccounts ?? [],
  };
}

export async function startGoogleOauth(): Promise<string> {
  const data = await request<{ authUrl: string }>('/google-drive/oauth/start');
  return data.authUrl;
}

export async function startNotionOauth(): Promise<string> {
  const data = await request<{ authUrl: string }>('/notion/oauth/start');
  return data.authUrl;
}

export async function fetchRules(): Promise<Rule[]> {
  const data = await request<{ rules: Rule[] }>('/rules');
  return data.rules ?? [];
}

export async function ping(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** True when the resolved account id for this context is linked for the platform. */
export function isContextLinked(
  platform: Platform,
  oauthAccounts: OAuthAccountSummary[],
  opts: { accountId?: string },
): boolean {
  const resolved = resolveAccountIdForPlatform(platform, oauthAccounts, opts.accountId);
  if (!resolved) return false;
  return oauthAccounts.some((c) => c.provider === platform && c.accountId === resolved);
}

export interface CrossFolderScanPayload {
  platform: Platform;
  accountId: string;
  candidates: Array<{ id: string; name: string; mimeType: string; sizeBytes?: number; parentFolderIds: string[] }>;
  universe: Array<{ id: string; name: string; mimeType: string; sizeBytes?: number; parentFolderIds: string[] }>;
  llm?: {
    provider?: string;
    hasByokKey?: boolean;
  };
}

export async function postCrossFolderScan(payload: CrossFolderScanPayload): Promise<{ status: string; candidatesCount: number; universeCount: number }> {
  return request('/scan/cross-folder', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
