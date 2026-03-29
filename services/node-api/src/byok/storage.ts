// Minimal ambient declaration for the Chrome extension storage API.
// The real types come from @types/chrome when bundled inside the extension;
// this stub keeps the node-api package free of that large dependency.
declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string[], callback: (result: Record<string, string>) => void): void;
      get(keys: null, callback: (result: Record<string, string>) => void): void;
      set(items: Record<string, string>, callback?: () => void): void;
      remove(key: string, callback?: () => void): void;
    }
    const local: StorageArea;
  }
}

import { LLM_PROVIDERS } from '../settings.js';
import type {
  BYOKStore,
  LlmProvider,
  ProviderConfig,
} from './types.js';
import {
  BYOK_KEY_PREFIX,
  BYOK_ACTIVE_PROVIDER_KEY,
  BYOK_DEFAULT_PROVIDER,
} from './types.js';

/**
 * Low-level key-value adapter so BYOKKeyStore can work in both a Chrome
 * extension context (chrome.storage.local) and plain browser / test contexts
 * (window.localStorage).
 */
interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Adapter backed by chrome.storage.local.
 * Only instantiated when the chrome extension API is present.
 */
class ChromeStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] ?? null);
      });
    });
  }

  async set(key: string, value: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  async remove(key: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  }

  async keys(): Promise<string[]> {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        resolve(Object.keys(items));
      });
    });
  }
}

/**
 * Adapter backed by window.localStorage.
 * Used as a fallback in non-extension contexts (web UI, tests).
 */
class LocalStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async keys(): Promise<string[]> {
    return Object.keys(localStorage);
  }
}

/**
 * In-memory adapter used for unit tests and server-side code paths where
 * neither chrome.storage nor window.localStorage is available.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

/**
 * Resolve the best storage adapter for the current runtime environment.
 *
 * Priority:
 *   1. chrome.storage.local  — Chrome extension
 *   2. window.localStorage   — Plain browser page / popup
 *   3. InMemoryStorageAdapter — Node.js / tests
 */
function resolveAdapter(): StorageAdapter {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return new ChromeStorageAdapter();
  }
  if (typeof window !== 'undefined' && window?.localStorage) {
    return new LocalStorageAdapter();
  }
  return new InMemoryStorageAdapter();
}

/** Build the per-provider storage key */
function providerKey(provider: LlmProvider): string {
  return `${BYOK_KEY_PREFIX}${provider}`;
}

/**
 * Browser-local BYOK (Bring-Your-Own-Key) key store.
 *
 * Secrets live exclusively in the browser storage layer — they are never
 * sent to or persisted by the DriveSense backend.
 *
 * Usage:
 *   const store = new BYOKKeyStore();
 *   await store.setKey('openai', 'sk-...');
 *   await store.setActiveProvider('openai');
 *   const key = await store.getKey('openai'); // 'sk-...'
 */
export class BYOKKeyStore implements BYOKStore {
  private adapter: StorageAdapter;

  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? resolveAdapter();
  }

  async setKey(
    provider: LlmProvider,
    apiKey: string,
    model?: string,
  ): Promise<void> {
    const config: ProviderConfig = { provider, apiKey, ...(model ? { model } : {}) };
    await this.adapter.set(providerKey(provider), JSON.stringify(config));
  }

  async getKey(provider: LlmProvider): Promise<string | null> {
    const config = await this.getConfig(provider);
    return config?.apiKey ?? null;
  }

  async getConfig(provider: LlmProvider): Promise<ProviderConfig | null> {
    const raw = await this.adapter.get(providerKey(provider));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ProviderConfig;
    } catch {
      return null;
    }
  }

  async clearKey(provider: LlmProvider): Promise<void> {
    await this.adapter.remove(providerKey(provider));
  }

  async clearAll(): Promise<void> {
    await Promise.all(LLM_PROVIDERS.map((p) => this.adapter.remove(providerKey(p))));
    await this.adapter.remove(BYOK_ACTIVE_PROVIDER_KEY);
  }

  async getActiveProvider(): Promise<LlmProvider> {
    const stored = await this.adapter.get(BYOK_ACTIVE_PROVIDER_KEY);
    if (stored && (LLM_PROVIDERS as readonly string[]).includes(stored)) {
      return stored as LlmProvider;
    }
    return BYOK_DEFAULT_PROVIDER;
  }

  async setActiveProvider(provider: LlmProvider): Promise<void> {
    await this.adapter.set(BYOK_ACTIVE_PROVIDER_KEY, provider);
  }

  async listConfiguredProviders(): Promise<LlmProvider[]> {
    const allKeys = await this.adapter.keys();
    const configured: LlmProvider[] = [];
    for (const provider of LLM_PROVIDERS) {
      if (allKeys.includes(providerKey(provider))) {
        configured.push(provider);
      }
    }
    return configured;
  }
}

/** Convenience singleton — resolves the adapter once at module load time */
export const byokStore = new BYOKKeyStore();
