export const LLM_PROVIDERS = ["gemini", "openai", "anthropic", "glm"] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type ScanSchedule = "manual" | "daily" | "weekly";

export interface UserSettings {
  llmProvider: LlmProvider;
  llmModel: string | null;
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
  autoConfirmActions: false;
  preferences: Record<string, unknown>;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  llmProvider: "gemini",
  llmModel: null,
  timezone: "UTC",
  promptLoggingEnabled: false,
  scanSchedule: "manual",
  staleAfterDays: 90,
  notAccessedAfterDays: 180,
  similarityThreshold: 0.9,
  suggestionNotifications: {
    dashboard: true,
    realtime: true,
  },
  autoConfirmActions: false,
  preferences: {},
};
