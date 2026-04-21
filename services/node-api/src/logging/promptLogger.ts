import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LlmProvider } from '../llm/types.js';
import type { LlmMessage } from '../llm/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PromptLogEntry {
  timestamp: string;
  provider: LlmProvider;
  promptTemplate?: string;
  renderedPrompt: string;
  responseFormat?: 'text' | 'json';
  temperature?: number;
  maxOutputTokens?: number;
  apiKeyRedacted: boolean;
}

/**
 * Redacts API keys from strings to prevent accidental logging of secrets.
 * Redacts patterns like: Bearer <token>, key=<token>, x-api-key: <token>
 */
function redactApiKey(value: string): string {
  return value
    .replace(/Bearer\s+[\w\-_]+/gi, 'Bearer [REDACTED]')
    .replace(/key=[\w\-_]+/gi, 'key=[REDACTED]')
    .replace(/x-api-key:\s*[\w\-_]+/gi, 'x-api-key: [REDACTED]');
}

/**
 * Converts LLM messages to a readable string representation, with API keys redacted.
 */
function formatMessages(messages: LlmMessage[]): string {
  return messages
    .map((msg) => {
      const redacted = redactApiKey(msg.content);
      return `[${msg.role}]: ${redacted}`;
    })
    .join('\n\n');
}

/**
 * PromptLogger handles logging of LLM prompts to timestamped files without persisting secrets.
 * Logs are written to: services/node-api/logs/prompts/YYYY-MM-DD.log
 */
export class PromptLogger {
  private logsDir: string;

  constructor(logsDir?: string) {
    this.logsDir = logsDir || path.join(__dirname, '../../logs/prompts');
  }

  /**
   * Logs a prompt to the timestamped log file.
   */
  async log(entry: PromptLogEntry): Promise<void> {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });

      const date = new Date(entry.timestamp);
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const logFile = path.join(this.logsDir, `${dateStr}.log`);

      const logLine = JSON.stringify({
        time: date.toISOString(),
        provider: entry.provider,
        promptTemplate: entry.promptTemplate,
        renderedPrompt: entry.renderedPrompt,
        responseFormat: entry.responseFormat,
        temperature: entry.temperature,
        maxOutputTokens: entry.maxOutputTokens,
        apiKeyRedacted: entry.apiKeyRedacted,
      });

      await fs.appendFile(logFile, `${logLine}\n`, 'utf-8');
    } catch (error) {
      console.error('Failed to log prompt:', error);
    }
  }

  /**
   * Creates a log entry for a single prompt request.
   */
  createEntry(
    provider: LlmProvider,
    messages: LlmMessage[],
    options?: {
      promptTemplate?: string;
      responseFormat?: 'text' | 'json';
      temperature?: number;
      maxOutputTokens?: number;
    },
  ): PromptLogEntry {
    return {
      timestamp: new Date().toISOString(),
      provider,
      promptTemplate: options?.promptTemplate,
      renderedPrompt: formatMessages(messages),
      responseFormat: options?.responseFormat,
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
      apiKeyRedacted: true,
    };
  }
}

export const defaultPromptLogger = new PromptLogger();
