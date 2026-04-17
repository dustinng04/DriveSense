/**
 * Typed wrapper around chrome.storage.local for the DriveSense extension.
 *
 * BYOK keys are stored here and NEVER forwarded to the Node API backend —
 * they are only read locally to make LLM calls directly from the extension.
 */
import type { ExtensionStorage, Provider, Suggestion } from './types.js';

const STORAGE_DEFAULTS: ExtensionStorage = {
  byokKeys: {},
  authToken: '',
  pendingSuggestions: [],
  lastShownSuggestionId: null,
  activeContext: null,
  metadataIndex: {
    version: 1,
    entries: {},
    folderCrawls: {},
  },
};

/**
 * Read one or more keys from extension local storage.
 * Returns defaults for any missing keys.
 */
export async function storageGet<K extends keyof ExtensionStorage>(
  ...keys: K[]
): Promise<Pick<ExtensionStorage, K>> {
  const defaults = Object.fromEntries(
    keys.map((k) => [k, STORAGE_DEFAULTS[k]]),
  ) as Pick<ExtensionStorage, K>;

  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys as string[], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Storage read failed: ${chrome.runtime.lastError.message}`));
      } else {
        resolve({ ...defaults, ...(result as Pick<ExtensionStorage, K>) });
      }
    });
  });
}

/**
 * Write one or more keys to extension local storage.
 */
export async function storageSet(
  values: Partial<ExtensionStorage>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// --- Convenience accessors ---

export async function getByokKey(provider: Provider): Promise<string> {
  const { byokKeys } = await storageGet('byokKeys');
  return byokKeys[provider] ?? '';
}

export async function setByokKey(provider: Provider, key: string): Promise<void> {
  const { byokKeys } = await storageGet('byokKeys');
  await storageSet({ byokKeys: { ...byokKeys, [provider]: key } });
}

export async function getAuthToken(): Promise<string> {
  const { authToken } = await storageGet('authToken');
  return authToken;
}

export async function setAuthToken(token: string): Promise<void> {
  await storageSet({ authToken: token });
}

export async function getPendingSuggestions(): Promise<Suggestion[]> {
  const { pendingSuggestions } = await storageGet('pendingSuggestions');
  return pendingSuggestions;
}

export async function setPendingSuggestions(suggestions: Suggestion[]): Promise<void> {
  await storageSet({ pendingSuggestions: suggestions });
}
