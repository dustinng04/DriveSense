/**
 * Fetch wrapper for the DriveSense Node API.
 *
 * API base URL is fixed at extension build time; auth token lives in chrome.storage.local.
 * BYOK keys are NOT sent here — they go directly to LLM providers from the popup / scripts.
 */
import { API_URL } from './buildConfig.js';
import { getAuthToken } from './storage.js';
import type { Suggestion, UserSettings, Rule } from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();

  if (!token) {
    throw new ApiError(401, 'No auth token. Sign in from the DriveSense dashboard and sync the extension.');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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

export async function fetchConnections(): Promise<Array<{ provider: string, account_email: string }>> {
  const data = await request<{ connections: Array<{ provider: string, account_email: string }> }>('/integrations/connections');
  return data.connections ?? [];
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
