import type { Provider } from './types.js';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface GenerateRequest {
  provider: Provider;
  apiKey: string;
  messages: LlmMessage[];
  responseFormat?: 'text' | 'json';
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GenerateResponse {
  text: string;
}

const DEFAULT_BASE_URLS: Record<Provider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
};

const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  glm: 'glm-4.7-flash',
};

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function safeParseJson<TJson>(value: string): TJson | null {
  try {
    return JSON.parse(stripJsonFence(value)) as TJson;
  } catch {
    return null;
  }
}

function joinMessages(messages: LlmMessage[], role: LlmMessage['role']): string {
  return messages
    .filter((m) => m.role === role)
    .map((m) => m.content)
    .join('\n\n');
}

function readPath(data: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, key) => {
    if (Array.isArray(current) && typeof key === 'number') return current[key];
    if (typeof current === 'object' && current !== null && typeof key === 'string') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

function readString(data: unknown, path: Array<string | number>): string {
  const value = readPath(data, path);
  return typeof value === 'string' ? value : '';
}

function readArray(data: unknown, path: Array<string | number>): unknown[] {
  const value = readPath(data, path);
  return Array.isArray(value) ? value : [];
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM request failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

async function generateGemini(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const model = DEFAULT_MODELS.gemini;
  const systemText = joinMessages(req.messages, 'system');
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const data = await postJson(
    `${DEFAULT_BASE_URLS.gemini}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`,
    {
      contents,
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 500,
        responseMimeType: req.responseFormat === 'json' ? 'application/json' : undefined,
      },
    },
    {},
    signal,
  );

  const parts = readArray(data, ['candidates', 0, 'content', 'parts']);
  return { text: parts.map((p) => readString(p, ['text'])).filter(Boolean).join('') };
}

async function generateOpenAiCompatible(
  provider: 'openai' | 'glm',
  req: GenerateRequest,
  signal?: AbortSignal,
): Promise<GenerateResponse> {
  const model = DEFAULT_MODELS[provider];
  const data = await postJson(
    `${DEFAULT_BASE_URLS[provider]}/chat/completions`,
    {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxOutputTokens ?? 500,
      ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    },
    { authorization: `Bearer ${req.apiKey}` },
    signal,
  );

  return { text: readString(data, ['choices', 0, 'message', 'content']) };
}

async function generateAnthropic(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const model = DEFAULT_MODELS.anthropic;
  const systemText = joinMessages(req.messages, 'system');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const data = await postJson(
    `${DEFAULT_BASE_URLS.anthropic}/messages`,
    {
      model,
      messages,
      system: systemText || undefined,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxOutputTokens ?? 500,
    },
    {
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
  );

  const content = readArray(data, ['content']);
  const text = content
    .filter((item) => readString(item, ['type']) === 'text')
    .map((item) => readString(item, ['text']))
    .join('');
  return { text };
}

export async function generateText(req: GenerateRequest): Promise<GenerateResponse> {
  if (!req.apiKey.trim()) throw new Error(`Missing API key for ${req.provider}`);

  const signal = AbortSignal.timeout(20_000);
  switch (req.provider) {
    case 'gemini':
      return generateGemini(req, signal);
    case 'openai':
      return generateOpenAiCompatible('openai', req, signal);
    case 'glm':
      return generateOpenAiCompatible('glm', req, signal);
    case 'anthropic':
      return generateAnthropic(req, signal);
    default: {
      const _exhaustive: never = req.provider;
      return _exhaustive;
    }
  }
}

