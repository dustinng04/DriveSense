import type { LlmProvider } from '../settings.js';

export type { LlmProvider };

export type LlmMessageRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmModelOption {
  id: string;
  label: string;
  provider: LlmProvider;
}

export type LlmResponseFormat = 'text' | 'json';

export interface LlmGenerateRequest {
  apiKey: string;
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: LlmResponseFormat;
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmGenerateResponse {
  provider: LlmProvider;
  model: string;
  text: string;
  usage?: LlmUsage;
}

export interface LlmJsonResponse<TJson> extends LlmGenerateResponse {
  json: TJson;
}

export interface LlmAdapter {
  provider: LlmProvider;
  defaultModel: string;
  generateText(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
  generateJson<TJson>(request: LlmGenerateRequest): Promise<LlmJsonResponse<TJson>>;
}

export type LlmFetch = typeof fetch;

export interface LlmAdapterOptions {
  fetch?: LlmFetch;
  baseUrl?: string;
}

export class LlmProviderError extends Error {
  readonly provider: LlmProvider;
  readonly status?: number;
  readonly code?: string;

  constructor(
    provider: LlmProvider,
    message: string,
    options: { status?: number; code?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.provider = provider;
    this.status = options.status;
    this.code = options.code;

    if (options.cause) {
      this.cause = options.cause;
    }
  }
}
