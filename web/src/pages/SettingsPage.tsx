import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { PROVIDERS, SCAN_SCHEDULES, type ProviderKeys, type Settings } from "../types";

interface Props {
  settings: Settings | null;
  keys: ProviderKeys;
  loading: boolean;
  signedIn: boolean;
  onKeysChange: (keys: ProviderKeys) => void;
  onSaveKeys: () => void;
  onSettingsChange: (settings: Settings) => void;
  onSaveSettings: () => Promise<void>;
}

type SettingsField = "timezone" | "similarityThreshold" | "staleAfterDays" | "notAccessedAfterDays" | "preferences";
type FieldErrors = Partial<Record<SettingsField, string>>;
type SettingsDraft = {
  source: string;
  timezoneText: string;
  similarityThresholdText: string;
  staleAfterDaysText: string;
  notAccessedAfterDaysText: string;
  preferencesText: string;
  fieldErrors: FieldErrors;
};

function isValidTimezone(value: string): boolean {
  const timezone = value.trim();
  if (!timezone) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function parseNumberInput(rawValue: string): number | null {
  if (!rawValue.trim()) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateNumberInput(
  rawValue: string,
  {
    label,
    min,
    max,
    integerOnly = false,
  }: {
    label: string;
    min: number;
    max: number;
    integerOnly?: boolean;
  },
): string {
  const parsed = parseNumberInput(rawValue);
  if (parsed === null) {
    return `${label} must be a number.`;
  }

  if (integerOnly && !Number.isInteger(parsed)) {
    return `${label} must be a whole number.`;
  }

  if (parsed < min || parsed > max) {
    return `${label} must be between ${min} and ${max}.`;
  }

  return "";
}

function validateSettingsDraft(values: {
  timezone: string;
  similarityThreshold: string;
  staleAfterDays: string;
  notAccessedAfterDays: string;
  preferencesText: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!isValidTimezone(values.timezone)) {
    errors.timezone = "Timezone must be a valid IANA timezone, for example Asia/Ho_Chi_Minh.";
  }

  const similarityError = validateNumberInput(values.similarityThreshold, {
    label: "Similarity threshold",
    min: 0.7,
    max: 1,
  });
  if (similarityError) {
    errors.similarityThreshold = similarityError;
  }

  const staleAfterError = validateNumberInput(values.staleAfterDays, {
    label: "Stale after days",
    min: 1,
    max: 3650,
    integerOnly: true,
  });
  if (staleAfterError) {
    errors.staleAfterDays = staleAfterError;
  }

  const notAccessedError = validateNumberInput(values.notAccessedAfterDays, {
    label: "Not accessed after days",
    min: 1,
    max: 3650,
    integerOnly: true,
  });
  if (notAccessedError) {
    errors.notAccessedAfterDays = notAccessedError;
  }

  try {
    const parsed = JSON.parse(values.preferencesText) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      errors.preferences = "Preferences must be a JSON object.";
    }
  } catch {
    errors.preferences = "Preferences must be valid JSON.";
  }

  return errors;
}

function serializeSettingsSource(settings: Settings | null): string {
  if (!settings) {
    return "";
  }

  return JSON.stringify({
    timezone: settings.timezone,
    similarityThreshold: settings.similarityThreshold,
    staleAfterDays: settings.staleAfterDays,
    notAccessedAfterDays: settings.notAccessedAfterDays,
    preferences: settings.preferences ?? {},
  });
}

function createSettingsDraft(settings: Settings | null): SettingsDraft {
  const timezoneText = settings?.timezone ?? "";
  const similarityThresholdText = settings ? String(settings.similarityThreshold) : "";
  const staleAfterDaysText = settings ? String(settings.staleAfterDays) : "";
  const notAccessedAfterDaysText = settings ? String(settings.notAccessedAfterDays) : "";
  const preferencesText = JSON.stringify(settings?.preferences ?? {}, null, 2);

  return {
    source: serializeSettingsSource(settings),
    timezoneText,
    similarityThresholdText,
    staleAfterDaysText,
    notAccessedAfterDaysText,
    preferencesText,
    fieldErrors: validateSettingsDraft({
      timezone: timezoneText,
      similarityThreshold: similarityThresholdText,
      staleAfterDays: staleAfterDaysText,
      notAccessedAfterDays: notAccessedAfterDaysText,
      preferencesText,
    }),
  };
}

export function SettingsPage({
  settings,
  keys,
  loading,
  signedIn,
  onKeysChange,
  onSaveKeys,
  onSettingsChange,
  onSaveSettings,
}: Props) {
  const [draft, setDraft] = useState<SettingsDraft>(() => createSettingsDraft(settings));

  if (!signedIn) {
    return (
      <>
        <PageHeader title="Settings" description="DriveSense settings appear here after sign-in." />
        <div className="empty-state">
          <div className="empty-state-icon">⚙️</div>
          <p>Sign in from Overview to adjust dashboard and scanning defaults.</p>
        </div>
      </>
    );
  }

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" description="DriveSense settings are loading." />
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <p>Still loading your saved settings.</p>
        </div>
      </>
    );
  }

  const settingsSource = serializeSettingsSource(settings);
  if (draft.source !== settingsSource) {
    setDraft(createSettingsDraft(settings));
  }

  const currentDraft = draft.source === settingsSource ? draft : createSettingsDraft(settings);
  const hasValidationErrors = Object.values(currentDraft.fieldErrors).some(Boolean);

  function updateDraft(updater: (current: SettingsDraft) => SettingsDraft) {
    setDraft((current) => updater(current.source === settingsSource ? current : createSettingsDraft(settings)));
  }

  function setFieldError(field: SettingsField, message: string) {
    updateDraft((current) => {
      if (current.fieldErrors[field] === message) {
        return current;
      }

      return {
        ...current,
        fieldErrors: {
          ...current.fieldErrors,
          [field]: message,
        },
      };
    });
  }

  return (
    <>
      <PageHeader title="Settings" description="Scanning defaults, delivery preferences, and local BYOK keys." />

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">LLM and Scan Defaults</div>
            <div className="card-desc">These values are stored server-side and shape suggestion generation.</div>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group inline-form-group">
            <label className="form-label" htmlFor="llm-provider">Provider</label>
            <select
              id="llm-provider"
              className="select"
              value={settings.llmProvider}
              disabled={loading}
              onChange={(event) => onSettingsChange({ ...settings, llmProvider: event.target.value as Settings["llmProvider"] })}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </div>
          <div className="form-group inline-form-group">
            <label className="form-label" htmlFor="timezone">Timezone</label>
            <input
              id="timezone"
              className="input"
              value={currentDraft.timezoneText}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDraft((current) => ({ ...current, timezoneText: nextValue }));

                if (!isValidTimezone(nextValue)) {
                  setFieldError("timezone", "Timezone must be a valid IANA timezone, for example Asia/Ho_Chi_Minh.");
                  return;
                }

                setFieldError("timezone", "");
                onSettingsChange({ ...settings, timezone: nextValue.trim() });
              }}
              disabled={loading}
            />
            {currentDraft.fieldErrors.timezone ? <p className="field-error">{currentDraft.fieldErrors.timezone}</p> : null}
          </div>
          <div className="form-group inline-form-group">
            <label className="form-label" htmlFor="scan-schedule">Scan schedule</label>
            <select
              id="scan-schedule"
              className="select"
              value={settings.scanSchedule}
              disabled={loading}
              onChange={(event) => onSettingsChange({ ...settings, scanSchedule: event.target.value as Settings["scanSchedule"] })}
            >
              {SCAN_SCHEDULES.map((schedule) => (
                <option key={schedule} value={schedule}>{schedule}</option>
              ))}
            </select>
          </div>
          <div className="form-group inline-form-group">
            <label className="form-label" htmlFor="similarity-threshold">Similarity threshold</label>
            <input
              id="similarity-threshold"
              type="number"
              min="0.7"
              max="1"
              step="0.01"
              className="input"
              value={currentDraft.similarityThresholdText}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDraft((current) => ({ ...current, similarityThresholdText: nextValue }));

                const nextError = validateNumberInput(nextValue, {
                  label: "Similarity threshold",
                  min: 0.7,
                  max: 1,
                });
                setFieldError("similarityThreshold", nextError);

                if (nextError) {
                  return;
                }

                onSettingsChange({ ...settings, similarityThreshold: Number(nextValue) });
              }}
              disabled={loading}
            />
            {currentDraft.fieldErrors.similarityThreshold ? <p className="field-error">{currentDraft.fieldErrors.similarityThreshold}</p> : null}
          </div>
          <div className="form-group inline-form-group">
            <label className="form-label" htmlFor="stale-after-days">Stale after days</label>
            <input
              id="stale-after-days"
              type="number"
              min="1"
              max="3650"
              className="input"
              value={currentDraft.staleAfterDaysText}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDraft((current) => ({ ...current, staleAfterDaysText: nextValue }));

                const nextError = validateNumberInput(nextValue, {
                  label: "Stale after days",
                  min: 1,
                  max: 3650,
                  integerOnly: true,
                });
                setFieldError("staleAfterDays", nextError);

                if (nextError) {
                  return;
                }

                onSettingsChange({ ...settings, staleAfterDays: Number(nextValue) });
              }}
              disabled={loading}
            />
            {currentDraft.fieldErrors.staleAfterDays ? <p className="field-error">{currentDraft.fieldErrors.staleAfterDays}</p> : null}
          </div>
          <div className="form-group inline-form-group">
            <label className="form-label" htmlFor="not-accessed-after-days">Not accessed after days</label>
            <input
              id="not-accessed-after-days"
              type="number"
              min="1"
              max="3650"
              className="input"
              value={currentDraft.notAccessedAfterDaysText}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDraft((current) => ({ ...current, notAccessedAfterDaysText: nextValue }));

                const nextError = validateNumberInput(nextValue, {
                  label: "Not accessed after days",
                  min: 1,
                  max: 3650,
                  integerOnly: true,
                });
                setFieldError("notAccessedAfterDays", nextError);

                if (nextError) {
                  return;
                }

                onSettingsChange({ ...settings, notAccessedAfterDays: Number(nextValue) });
              }}
              disabled={loading}
            />
            {currentDraft.fieldErrors.notAccessedAfterDays ? <p className="field-error">{currentDraft.fieldErrors.notAccessedAfterDays}</p> : null}
          </div>
        </div>

        <div className="settings-toggle-list">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.promptLoggingEnabled}
              onChange={(event) => onSettingsChange({ ...settings, promptLoggingEnabled: event.target.checked })}
              disabled={loading}
            />
            <span>Enable prompt logging for local debugging</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.suggestionNotifications.dashboard}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  suggestionNotifications: {
                    ...settings.suggestionNotifications,
                    dashboard: event.target.checked,
                  },
                })
              }
              disabled={loading}
            />
            <span>Show dashboard notifications</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.suggestionNotifications.realtime}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  suggestionNotifications: {
                    ...settings.suggestionNotifications,
                    realtime: event.target.checked,
                  },
                })
              }
              disabled={loading}
            />
            <span>Allow realtime suggestion delivery</span>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Advanced Preferences</div>
            <div className="card-desc">JSON object stored server-side for internal feature flags and future knobs.</div>
          </div>
        </div>
        <div className="form-group inline-form-group">
          <label className="form-label" htmlFor="preferences-json">Preferences JSON</label>
          <textarea
            id="preferences-json"
            className="textarea"
            value={currentDraft.preferencesText}
            onChange={(event) => {
              updateDraft((current) => ({ ...current, preferencesText: event.target.value }));
              try {
                const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
                  setFieldError("preferences", "Preferences must be a JSON object.");
                  return;
                }

                setFieldError("preferences", "");
                onSettingsChange({ ...settings, preferences: parsed });
              } catch {
                setFieldError("preferences", "Preferences must be valid JSON.");
              }
            }}
            disabled={loading}
          />
          {currentDraft.fieldErrors.preferences ? <p className="field-error">{currentDraft.fieldErrors.preferences}</p> : null}
        </div>
        <button
          id="save-settings"
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (hasValidationErrors) {
              return;
            }

            void onSaveSettings();
          }}
          disabled={loading || hasValidationErrors}
        >
          Save Settings
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">BYOK API Keys</div>
            <div className="card-desc">Stored in browser localStorage only and never sent to the backend.</div>
          </div>
        </div>
        <div className="grid-2">
          {PROVIDERS.map((provider) => (
            <div key={provider} className="form-group inline-form-group">
              <label className="form-label" htmlFor={`key-${provider}`}>{provider} key</label>
              <input
                id={`key-${provider}`}
                type="password"
                className="input"
                value={keys[provider]}
                placeholder={`${provider} API key`}
                onChange={(event) => onKeysChange({ ...keys, [provider]: event.target.value })}
              />
            </div>
          ))}
        </div>
        <button
          id="save-keys"
          type="button"
          className="btn btn-primary"
          onClick={onSaveKeys}
          disabled={loading}
        >
          Save Keys Locally
        </button>
      </div>
    </>
  );
}
