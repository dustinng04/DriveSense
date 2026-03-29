import { LLM_PROVIDERS } from '../settings.js';
import type {
  LlmAdapter,
  LlmAdapterOptions,
  LlmFetch,
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmJsonResponse,
  LlmMessage,
  LlmModelOption,
  LlmProvider,
  LlmUsage,
} from './types.js';
import { LlmProviderError } from './types.js';
import { defaultPromptLogger } from '../logging/index.js';

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'gemini';

export const LLM_MODEL_OPTIONS: Record<LlmProvider, readonly LlmModelOption[]> = {
  gemini: [
    { provider: 'gemini', id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { provider: 'gemini', id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  ],
  openai: [
    { provider: 'openai', id: 'gpt-5.4', label: 'GPT-5.4' },
    { provider: 'openai', id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
    { provider: 'openai', id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { provider: 'openai', id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
    { provider: 'openai', id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  ],
  anthropic: [
    { provider: 'anthropic', id: 'claude-opus-4-6-latest', label: 'Claude Opus 4.6' },
    { provider: 'anthropic', id: 'claude-sonnet-4-6-latest', label: 'Claude Sonnet 4.6' },
    { provider: 'anthropic', id: 'claude-haiku-latest', label: 'Claude Haiku' },
  ],
  glm: [
    { provider: 'glm', id: 'glm-5', label: 'GLM-5' },
    { provider: 'glm', id: 'glm-5.1', label: 'GLM-5.1' },
    { provider: 'glm', id: 'glm-4-plus', label: 'GLM-4.x' },
    { provider: 'glm', id: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
  ],
};

export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  gemini: LLM_MODEL_OPTIONS.gemini[1].id,
  openai: LLM_MODEL_OPTIONS.openai[2].id,
  anthropic: LLM_MODEL_OPTIONS.anthropic[1].id,
  glm: LLM_MODEL_OPTIONS.glm[3].id,
};

const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
};

abstract class FetchLlmAdapter implements LlmAdapter {
  readonly provider: LlmProvider;
  readonly defaultModel: string;
  protected readonly fetcher: LlmFetch;
  protected readonly baseUrl: string;

  constructor(provider: LlmProvider, options: LlmAdapterOptions = {}) {
    this.provider = provider;
    this.defaultModel = DEFAULT_LLM_MODELS[provider];
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URLS[provider];

    if (!this.fetcher) {
      throw new LlmProviderError(provider, 'No fetch implementation is available for LLM requests.');
    }
  }

  abstract generateText(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;

  async generateJson<TJson>(request: LlmGenerateRequest): Promise<LlmJsonResponse<TJson>> {
    const response = await this.generateText({ ...request, responseFormat: 'json' });

    try {
      return {
        ...response,
        json: parseJsonResponse<TJson>(response.text),
      };
    } catch (error) {
      throw new LlmProviderError(this.provider, 'LLM returned malformed JSON.', { cause: error });
    }
  }

  protected resolveModel(request: LlmGenerateRequest): string {
    return request.model ?? this.defaultModel;
  }

  protected ensureApiKey(request: LlmGenerateRequest): void {
    if (!request.apiKey.trim()) {
      throw new LlmProviderError(this.provider, `Missing API key for ${this.provider}.`);
    }
  }

  protected async postJson(url: string, request: LlmGenerateRequest, body: unknown, headers: HeadersInit): Promise<unknown> {
    this.ensureApiKey(request);

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new LlmProviderError(
        this.provider,
        `${this.provider} request failed with HTTP ${response.status}: ${truncate(responseText, 500)}`,
        { status: response.status },
      );
    }

    if (!responseText) {
      return {};
    }

    try {
      return JSON.parse(responseText) as unknown;
    } catch (error) {
      throw new LlmProviderError(this.provider, `${this.provider} returned non-JSON response.`, { cause: error });
    }
  }
}

class GeminiAdapter extends FetchLlmAdapter {
  constructor(options?: LlmAdapterOptions) {
    super('gemini', options);
  }

  async generateText(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const model = this.resolveModel(request);
    const systemText = joinMessages(request.messages, 'system');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    // Log the prompt for debugging (non-blocking)
    const logEntry = defaultPromptLogger.createEntry(this.provider, model, request.messages, {
      responseFormat: request.responseFormat,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
    });
    defaultPromptLogger.log(logEntry).catch((error) => {
      console.error('Error logging prompt:', error);
    });

    const data = await this.postJson(
      `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
      request,
      {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        generationConfig: compactObject({
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: request.responseFormat === 'json' ? 'application/json' : undefined,
        }),
      },
      {},
    );

    return {
      provider: this.provider,
      model,
      text: readGeminiText(data),
      usage: readGeminiUsage(data),
    };
  }
}

class OpenAiAdapter extends FetchLlmAdapter {
  constructor(options?: LlmAdapterOptions) {
    super('openai', options);
  }

  async generateText(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const model = this.resolveModel(request);
    const data = await this.postJson(
      `${this.baseUrl}/chat/completions`,
      request,
      {
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      },
      { authorization: `Bearer ${request.apiKey}` },
    );

    return {
      provider: this.provider,
      model,
      text: readString(data, ['choices', 0, 'message', 'content']),
      usage: readOpenAiUsage(data),
    };
  }
}

class AnthropicAdapter extends FetchLlmAdapter {
  constructor(options?: LlmAdapterOptions) {
    super('anthropic', options);
  }

  async generateText(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const model = this.resolveModel(request);
    const systemText = joinMessages(request.messages, 'system');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }));

    const data = await this.postJson(
      `${this.baseUrl}/messages`,
      request,
      {
        model,
        messages,
        system: systemText || undefined,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens ?? 1024,
      },
      {
        'x-api-key': request.apiKey,
        'anthropic-version': '2023-06-01',
      },
    );

    return {
      provider: this.provider,
      model,
      text: readAnthropicText(data),
      usage: readAnthropicUsage(data),
    };
  }
}

class GlmAdapter extends FetchLlmAdapter {
  constructor(options?: LlmAdapterOptions) {
    super('glm', options);
  }

  async generateText(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const model = this.resolveModel(request);
    const data = await this.postJson(
      `${this.baseUrl}/chat/completions`,
      request,
      {
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      },
      { authorization: `Bearer ${request.apiKey}` },
    );

    return {
      provider: this.provider,
      model,
      text: readString(data, ['choices', 0, 'message', 'content']),
      usage: readOpenAiUsage(data),
    };
  }
}

export function createLlmAdapter(provider: LlmProvider = DEFAULT_LLM_PROVIDER, options?: LlmAdapterOptions): LlmAdapter {
  switch (provider) {
    case 'gemini':
      return new GeminiAdapter(options);
    case 'openai':
      return new OpenAiAdapter(options);
    case 'anthropic':
      return new AnthropicAdapter(options);
    case 'glm':
      return new GlmAdapter(options);
    default:
      return assertNeverProvider(provider);
  }
}

export function isLlmProvider(provider: string): provider is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(provider);
}

export function getDefaultLlmModel(provider: LlmProvider): string {
  return DEFAULT_LLM_MODELS[provider];
}

export function getLlmModelOptions(provider: LlmProvider): readonly LlmModelOption[] {
  return LLM_MODEL_OPTIONS[provider];
}

function assertNeverProvider(provider: never): never {
  throw new LlmProviderError(DEFAULT_LLM_PROVIDER, `Unsupported LLM provider: ${provider}`);
}

function joinMessages(messages: LlmMessage[], role: LlmMessage['role']): string {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join('\n\n');
}

function parseJsonResponse<TJson>(text: string): TJson {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(withoutFence) as TJson;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function readGeminiText(data: unknown): string {
  const candidate = readArray(data, ['candidates', 0, 'content', 'parts']);
  return candidate
    .map((part) => readString(part, ['text']))
    .filter(Boolean)
    .join('');
}

function readAnthropicText(data: unknown): string {
  const content = readArray(data, ['content']);
  return content
    .filter((item) => readString(item, ['type']) === 'text')
    .map((item) => readString(item, ['text']))
    .join('');
}

function readGeminiUsage(data: unknown): LlmUsage | undefined {
  const usage = readRecord(data, ['usageMetadata']);
  if (!usage) return undefined;

  return compactObject({
    inputTokens: readNumber(usage, ['promptTokenCount']),
    outputTokens: readNumber(usage, ['candidatesTokenCount']),
    totalTokens: readNumber(usage, ['totalTokenCount']),
  });
}

function readOpenAiUsage(data: unknown): LlmUsage | undefined {
  const usage = readRecord(data, ['usage']);
  if (!usage) return undefined;

  return compactObject({
    inputTokens: readNumber(usage, ['prompt_tokens']),
    outputTokens: readNumber(usage, ['completion_tokens']),
    totalTokens: readNumber(usage, ['total_tokens']),
  });
}

function readAnthropicUsage(data: unknown): LlmUsage | undefined {
  const usage = readRecord(data, ['usage']);
  if (!usage) return undefined;

  const inputTokens = readNumber(usage, ['input_tokens']);
  const outputTokens = readNumber(usage, ['output_tokens']);

  return compactObject({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
  });
}

function readString(data: unknown, path: Array<string | number>): string {
  const value = readPath(data, path);
  return typeof value === 'string' ? value : '';
}

function readNumber(data: unknown, path: Array<string | number>): number | undefined {
  const value = readPath(data, path);
  return typeof value === 'number' ? value : undefined;
}

function readArray(data: unknown, path: Array<string | number>): unknown[] {
  const value = readPath(data, path);
  return Array.isArray(value) ? value : [];
}

function readRecord(data: unknown, path: Array<string | number>): Record<string, unknown> | undefined {
  const value = readPath(data, path);
  return isRecord(value) ? value : undefined;
}

function readPath(data: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, key) => {
    if (Array.isArray(current) && typeof key === 'number') {
      return current[key];
    }

    if (isRecord(current) && typeof key === 'string') {
      return current[key];
    }

    return undefined;
  }, data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
