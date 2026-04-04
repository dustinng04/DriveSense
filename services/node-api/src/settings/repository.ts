import type { PoolClient } from "pg";
import { withUserTransaction } from "../db/withUserTransaction.js";
import {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  type UserSettings,
  type UserSettingsPatch,
} from "../settings.js";

interface SettingsRow {
  llm_provider: UserSettings["llmProvider"];
  llm_model: string | null;
  timezone: string;
  prompt_logging_enabled: boolean;
  scan_schedule: UserSettings["scanSchedule"];
  stale_after_days: number;
  not_accessed_after_days: number;
  similarity_threshold: number;
  suggestion_notifications: {
    dashboard?: boolean;
    realtime?: boolean;
  } | null;
  auto_confirm_actions: false;
  preferences: Record<string, unknown> | null;
}

function rowToUserSettings(row: SettingsRow): UserSettings {
  return {
    llmProvider: row.llm_provider,
    llmModel: row.llm_model,
    timezone: row.timezone,
    promptLoggingEnabled: row.prompt_logging_enabled,
    scanSchedule: row.scan_schedule,
    staleAfterDays: row.stale_after_days,
    notAccessedAfterDays: row.not_accessed_after_days,
    similarityThreshold: Number(row.similarity_threshold),
    suggestionNotifications: {
      dashboard: row.suggestion_notifications?.dashboard ?? true,
      realtime: row.suggestion_notifications?.realtime ?? true,
    },
    autoConfirmActions: false,
    preferences: row.preferences ?? {},
  };
}

function toWriteModel(settings: UserSettings) {
  return {
    llm_provider: settings.llmProvider,
    llm_model: settings.llmModel,
    timezone: settings.timezone,
    prompt_logging_enabled: settings.promptLoggingEnabled,
    scan_schedule: settings.scanSchedule,
    stale_after_days: settings.staleAfterDays,
    not_accessed_after_days: settings.notAccessedAfterDays,
    similarity_threshold: settings.similarityThreshold,
    suggestion_notifications: settings.suggestionNotifications,
    auto_confirm_actions: false,
    preferences: settings.preferences,
  };
}

async function loadExistingSettings(client: PoolClient, userId: string): Promise<UserSettings | null> {
  const result = await client.query<SettingsRow>(
    `select
      llm_provider,
      llm_model,
      timezone,
      prompt_logging_enabled,
      scan_schedule,
      stale_after_days,
      not_accessed_after_days,
      similarity_threshold,
      suggestion_notifications,
      auto_confirm_actions,
      preferences
     from public.settings
     where user_id = $1
     limit 1`,
    [userId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return rowToUserSettings(result.rows[0]);
}

async function insertDefaultSettings(client: PoolClient, userId: string): Promise<UserSettings> {
  const write = toWriteModel(DEFAULT_USER_SETTINGS);
  const inserted = await client.query<SettingsRow>(
    `insert into public.settings (
      user_id,
      llm_provider,
      llm_model,
      timezone,
      prompt_logging_enabled,
      scan_schedule,
      stale_after_days,
      not_accessed_after_days,
      similarity_threshold,
      suggestion_notifications,
      auto_confirm_actions,
      preferences
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb
    )
    on conflict (user_id) do update
    set user_id = excluded.user_id
    returning
      llm_provider,
      llm_model,
      timezone,
      prompt_logging_enabled,
      scan_schedule,
      stale_after_days,
      not_accessed_after_days,
      similarity_threshold,
      suggestion_notifications,
      auto_confirm_actions,
      preferences`,
    [
      userId,
      write.llm_provider,
      write.llm_model,
      write.timezone,
      write.prompt_logging_enabled,
      write.scan_schedule,
      write.stale_after_days,
      write.not_accessed_after_days,
      write.similarity_threshold,
      JSON.stringify(write.suggestion_notifications),
      write.auto_confirm_actions,
      JSON.stringify(write.preferences),
    ],
  );

  return rowToUserSettings(inserted.rows[0]);
}

async function getOrCreateUserSettingsWithinClient(
  client: PoolClient,
  userId: string,
): Promise<UserSettings> {
  const existing = await loadExistingSettings(client, userId);
  if (existing) {
    return existing;
  }

  return insertDefaultSettings(client, userId);
}

export async function getOrCreateUserSettings(userId: string): Promise<UserSettings> {
  return withUserTransaction(userId, async (client) => {
    return getOrCreateUserSettingsWithinClient(client, userId);
  });
}

export async function patchUserSettings(
  userId: string,
  patch: UserSettingsPatch,
): Promise<UserSettings> {
  return withUserTransaction(userId, async (client) => {
    const current = await getOrCreateUserSettingsWithinClient(client, userId);
    const next = mergeUserSettings(current, patch);
    const write = toWriteModel(next);

    const updated = await client.query<SettingsRow>(
      `update public.settings
      set
        llm_provider = $2,
        llm_model = $3,
        timezone = $4,
        prompt_logging_enabled = $5,
        scan_schedule = $6,
        stale_after_days = $7,
        not_accessed_after_days = $8,
        similarity_threshold = $9,
        suggestion_notifications = $10::jsonb,
        auto_confirm_actions = $11,
        preferences = $12::jsonb
      where user_id = $1
      returning
        llm_provider,
        llm_model,
        timezone,
        prompt_logging_enabled,
        scan_schedule,
        stale_after_days,
        not_accessed_after_days,
        similarity_threshold,
        suggestion_notifications,
        auto_confirm_actions,
        preferences`,
      [
        userId,
        write.llm_provider,
        write.llm_model,
        write.timezone,
        write.prompt_logging_enabled,
        write.scan_schedule,
        write.stale_after_days,
        write.not_accessed_after_days,
        write.similarity_threshold,
        JSON.stringify(write.suggestion_notifications),
        write.auto_confirm_actions,
        JSON.stringify(write.preferences),
      ],
    );

    return rowToUserSettings(updated.rows[0]);
  });
}

