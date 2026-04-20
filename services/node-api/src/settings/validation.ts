import {
  LLM_PROVIDERS,
  type ScanSchedule,
  type UserSettingsPatch,
} from "../settings.js";

const scanSchedules = new Set<ScanSchedule>(["manual", "daily", "weekly"]);
const allowedKeys = new Set([
  "llmProvider",
  "timezone",
  "promptLoggingEnabled",
  "scanSchedule",
  "staleAfterDays",
  "notAccessedAfterDays",
  "similarityThreshold",
  "suggestionNotifications",
  "autoConfirmActions",
  "preferences",
]);

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function readIntegerInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function parseSettingsPatch(input: unknown): UserSettingsPatch {
  if (!isObjectLike(input)) {
    throw new Error("Settings patch must be a JSON object.");
  }

  const patch: UserSettingsPatch = {};
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown settings key: ${key}.`);
    }
  }

  if (input.llmProvider !== undefined) {
    if (
      typeof input.llmProvider !== "string" ||
      !(LLM_PROVIDERS as readonly string[]).includes(input.llmProvider)
    ) {
      throw new Error(`llmProvider must be one of: ${LLM_PROVIDERS.join(", ")}.`);
    }
    patch.llmProvider = input.llmProvider as (typeof LLM_PROVIDERS)[number];
  }

  if (input.timezone !== undefined) {
    if (typeof input.timezone !== "string" || input.timezone.trim().length === 0) {
      throw new Error("timezone must be a non-empty string.");
    }
    patch.timezone = input.timezone;
  }

  if (input.promptLoggingEnabled !== undefined) {
    patch.promptLoggingEnabled = readBoolean(input.promptLoggingEnabled, "promptLoggingEnabled");
  }

  if (input.scanSchedule !== undefined) {
    if (typeof input.scanSchedule !== "string" || !scanSchedules.has(input.scanSchedule as ScanSchedule)) {
      throw new Error("scanSchedule must be one of: manual, daily, weekly.");
    }
    patch.scanSchedule = input.scanSchedule as ScanSchedule;
  }

  if (input.staleAfterDays !== undefined) {
    patch.staleAfterDays = readIntegerInRange(input.staleAfterDays, "staleAfterDays", 1, 3650);
  }

  if (input.notAccessedAfterDays !== undefined) {
    patch.notAccessedAfterDays = readIntegerInRange(
      input.notAccessedAfterDays,
      "notAccessedAfterDays",
      1,
      3650,
    );
  }

  if (input.similarityThreshold !== undefined) {
    if (
      typeof input.similarityThreshold !== "number" ||
      Number.isNaN(input.similarityThreshold) ||
      input.similarityThreshold < 0.7 ||
      input.similarityThreshold > 1
    ) {
      throw new Error("similarityThreshold must be a number between 0.7 and 1.0.");
    }
    patch.similarityThreshold = input.similarityThreshold;
  }

  if (input.suggestionNotifications !== undefined) {
    if (!isObjectLike(input.suggestionNotifications)) {
      throw new Error("suggestionNotifications must be an object.");
    }

    const notifications: UserSettingsPatch["suggestionNotifications"] = {};
    if (input.suggestionNotifications.dashboard !== undefined) {
      notifications.dashboard = readBoolean(
        input.suggestionNotifications.dashboard,
        "suggestionNotifications.dashboard",
      );
    }
    if (input.suggestionNotifications.realtime !== undefined) {
      notifications.realtime = readBoolean(
        input.suggestionNotifications.realtime,
        "suggestionNotifications.realtime",
      );
    }
    patch.suggestionNotifications = notifications;
  }

  if (input.autoConfirmActions !== undefined && input.autoConfirmActions !== false) {
    throw new Error("autoConfirmActions must remain false.");
  }
  if (input.autoConfirmActions === false) {
    patch.autoConfirmActions = false;
  }

  if (input.preferences !== undefined) {
    if (!isObjectLike(input.preferences)) {
      throw new Error("preferences must be an object.");
    }
    patch.preferences = input.preferences;
  }

  return patch;
}

