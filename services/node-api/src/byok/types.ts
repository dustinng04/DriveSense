import type { LlmProvider } from '../settings.js';

export type { LlmProvider };

/**
 * Stored configuration for a single LLM provider.
 * Keys live only in browser-local storage and are never sent to the backend.
 */
export interface ProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  /** Optional model name override (e.g. "gpt-4o", "gemini-2.0-flash") */
  model?: string;
}

/**
 * Interface that any BYOK storage implementation must satisfy.
 * The reference implementation targets chrome.storage.local when available
 * and falls back to window.localStorage for testing/non-extension contexts.
 */
export interface BYOKStore {
  /** Persist an API key (and optional model) for a provider */
  setKey(provider: LlmProvider, apiKey: string, model?: string): Promise<void>;

  /** Retrieve the raw API key for a provider, or null if not set */
  getKey(provider: LlmProvider): Promise<string | null>;

  /** Retrieve the full ProviderConfig for a provider, or null if not set */
  getConfig(provider: LlmProvider): Promise<ProviderConfig | null>;

  /** Remove the stored key for a provider */
  clearKey(provider: LlmProvider): Promise<void>;

  /** Remove all stored keys and reset active provider to the default */
  clearAll(): Promise<void>;

  /** Return which provider is currently selected */
  getActiveProvider(): Promise<LlmProvider>;

  /** Set the active provider */
  setActiveProvider(provider: LlmProvider): Promise<void>;

  /** List every provider that has a key stored */
  listConfiguredProviders(): Promise<LlmProvider[]>;
}

/** Storage key prefix used by all BYOK entries */
export const BYOK_KEY_PREFIX = 'drivesense_byok_' as const;

/** Storage key for the currently selected provider */
export const BYOK_ACTIVE_PROVIDER_KEY = 'drivesense_byok_active_provider' as const;

/** Default provider when none has been explicitly selected */
export const BYOK_DEFAULT_PROVIDER: LlmProvider = 'gemini';
