import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { StatusBar } from "./components/StatusBar";
import { HistoryPage } from "./pages/HistoryPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RulesPage } from "./pages/RulesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";
import type {
  FiletypeWhitelistRule,
  KeywordGuardRule,
  Platform,
  ProviderConnectionStatus,
  ProviderKeys,
  ProviderOverviewState,
  Rule,
  SessionData,
  Settings,
  Suggestion,
  TabId,
  UndoAction,
} from "./types";

const API_BASE = "/api";
const TOKEN_KEY = "drivesense.authToken";
const KEYS_KEY = "drivesense.byokKeys.v1";

const EMPTY_KEYS: ProviderKeys = { gemini: "", openai: "", anthropic: "", glm: "" };

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "suggestions", label: "Suggestions" },
  { id: "rules", label: "Rules" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

function readToken() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

function getOauthSuccessInfo(): { newToken: string | null; isLinked: boolean } | null {
  if (typeof window === "undefined" || window.location.pathname !== "/oauth-success") return null;
  const params = new URLSearchParams(window.location.search);
  const newToken = params.get("token");
  const isLinked = params.get("notionConnected") === "true" || params.get("googleDriveConnected") === "true";
  if (!newToken && !isLinked) return null;
  return { newToken, isLinked };
}

function readInitialToken(): string {
  const oauth = getOauthSuccessInfo();
  if (oauth?.newToken) return oauth.newToken;
  return readToken();
}

function readInitialStatus(): string {
  const oauth = getOauthSuccessInfo();
  if (oauth?.newToken) return "Login successful. You can close this tab.";
  if (oauth?.isLinked) return "Account linked successfully. You can close this tab.";
  return "Ready";
}

function pushTokenToExtension(tokenValue: string): void {
  const extensionId = import.meta.env.VITE_DS_EXTENSION_ID?.trim();
  if (!extensionId || !tokenValue.trim()) return;

  type ChromeRuntime = {
    runtime: {
      sendMessage: (extensionId: string, message: object, responseCallback?: () => void) => void;
      lastError?: { message: string };
    };
  };
  const chromeApi = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (!chromeApi?.runtime?.sendMessage) return;

  chromeApi.runtime.sendMessage(
    extensionId,
    { type: "SET_AUTH_TOKEN", token: tokenValue.trim() },
    () => {
      void chromeApi.runtime.lastError;
    },
  );
}

function readKeys(): ProviderKeys {
  try {
    return {
      ...EMPTY_KEYS,
      ...(JSON.parse(localStorage.getItem(KEYS_KEY) ?? "{}") as Partial<ProviderKeys>),
    };
  } catch {
    return EMPTY_KEYS;
  }
}

function statusType(message: string): "success" | "error" | "default" {
  if (/saved|success|added|removed|undone|loaded|linked|disconnected|updated/i.test(message)) return "success";
  if (/fail|error|required|expired|invalid/i.test(message)) return "error";
  return "default";
}

function providerPath(provider: Platform): string {
  return provider === "google_drive" ? "google-drive" : "notion";
}

function buildOverviewState(
  provider: Platform,
  label: string,
  session: SessionData | null,
  status: ProviderConnectionStatus | null,
): ProviderOverviewState {
  const oauthAccounts = session?.oauthAccounts.filter((account) => account.provider === provider) ?? [];
  const statusAccounts = status?.accounts ?? [];
  const merged = new Map(
    oauthAccounts.map((account) => [
      account.accountId,
      { accountId: account.accountId, accountEmail: account.accountEmail, isPrimary: account.isPrimary },
    ]),
  );

  for (const account of statusAccounts) {
    const current = merged.get(account.accountId);
    merged.set(account.accountId, {
      accountId: account.accountId,
      accountEmail: current?.accountEmail ?? null,
      isPrimary: account.isPrimary,
    });
  }

  return {
    provider,
    label,
    connected: (status?.connected ?? false) || merged.size > 0,
    accounts: [...merged.values()].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
  };
}

export default function App() {
  const [tab, setTab] = useState<TabId>("overview");
  const [token, setToken] = useState(readInitialToken);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [keys, setKeys] = useState<ProviderKeys>(readKeys);
  const [status, setStatus] = useState(readInitialStatus);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [undoHistory, setUndoHistory] = useState<UndoAction[]>([]);
  const [mockPopup, setMockPopup] = useState<Suggestion | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<ProviderConnectionStatus | null>(null);
  const [notionStatus, setNotionStatus] = useState<ProviderConnectionStatus | null>(null);

  const signedIn = token.trim().length > 0;

  const blacklistEntries = useMemo(
    () => rules.flatMap((rule, index) => (rule.type === "folder_blacklist" ? [{ i: index, r: rule }] : [])),
    [rules],
  );
  const filetypeIdx = rules.findIndex((rule) => rule.type === "filetype_whitelist");
  const filetypes = filetypeIdx >= 0 ? (rules[filetypeIdx] as FiletypeWhitelistRule).allowedTypes : [];
  const keywordIdx = rules.findIndex((rule) => rule.type === "keyword_guard");
  const keywords = keywordIdx >= 0 ? (rules[keywordIdx] as KeywordGuardRule).keywords : [];

  const providerStates = useMemo(
    () => [
      buildOverviewState("google_drive", "Google Drive", session, googleDriveStatus),
      buildOverviewState("notion", "Notion", session, notionStatus),
    ],
    [googleDriveStatus, notionStatus, session],
  );

  function resetDashboardData() {
    setSettings(null);
    setRules([]);
    setSuggestions([]);
    setUndoHistory([]);
    setSession(null);
    setGoogleDriveStatus(null);
    setNotionStatus(null);
  }

  const req = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!token.trim()) {
      throw new Error("Sign in from Overview to use the dashboard.");
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = (await res.text()) || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        resetDashboardData();
        throw new Error("Session expired. Sign in again.");
      }
      throw new Error(text);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }, [token]);

  async function run(label: string, fn: () => Promise<void>) {
    setLoading(true);
    setStatus(label);
    try {
      await fn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  const beginProviderConnection = useCallback(async (provider: Platform) => {
    const providerSegment = providerPath(provider);
    if (!token.trim()) {
      const redirectUri = `${window.location.origin}/oauth-success`;
      window.location.href = `${API_BASE}/oauth/${providerSegment}/login/start?redirect_uri=${encodeURIComponent(redirectUri)}`;
      return;
    }

    await run(`Opening ${provider === "google_drive" ? "Google Drive" : "Notion"}…`, async () => {
      const response = await req<{ authUrl: string }>(`/${providerSegment}/oauth/start`);
      window.location.href = response.authUrl;
    });
  }, [req, token]);

  const loadData = useCallback(async () => {
    if (!token.trim()) {
      setStatus("Sign in from Overview to load dashboard data.");
      return;
    }

    await run("Still looking…", async () => {
      const [settingsResponse, rulesResponse, suggestionsResponse, undoResponse, sessionResponse, googleResponse, notionResponse] =
        await Promise.all([
          req<{ settings: Settings }>("/settings"),
          req<{ rules: Rule[] }>("/rules"),
          req<{ suggestions: Suggestion[] }>("/suggestions?status=pending"),
          req<{ actions: UndoAction[] }>("/undo-history?limit=20&includeUndone=true"),
          req<SessionData>("/session/me"),
          req<ProviderConnectionStatus>("/google-drive/oauth/status"),
          req<ProviderConnectionStatus>("/notion/oauth/status"),
        ]);

      setSettings(settingsResponse.settings);
      setRules(rulesResponse.rules ?? []);
      setSuggestions(suggestionsResponse.suggestions ?? []);
      setUndoHistory(undoResponse.actions ?? []);
      setSession(sessionResponse);
      setGoogleDriveStatus(googleResponse);
      setNotionStatus(notionResponse);
      setStatus("Updated successfully");

      const params = new URLSearchParams(window.location.search);
      const connectPlatform = params.get("connect");
      if (connectPlatform === "google_drive" || connectPlatform === "notion") {
        window.history.replaceState({}, "", window.location.pathname);
        await beginProviderConnection(connectPlatform);
      }
    });
  }, [beginProviderConnection, req, token]);

  useEffect(() => {
    const oauth = getOauthSuccessInfo();
    if (!oauth) return;

    if (oauth.newToken) {
      localStorage.setItem(TOKEN_KEY, oauth.newToken);
      pushTokenToExtension(oauth.newToken);
    }

    window.history.replaceState({}, "", "/");
    const timer = setTimeout(() => {
      try {
        window.close();
      } catch {
        // Tab may not be script-closable.
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token.trim()) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData, token]);

  async function saveRules(next: Rule[], message: string) {
    await run("Updating rules…", async () => {
      const response = await req<{ rules: Rule[] }>("/rules", {
        method: "PUT",
        body: JSON.stringify({ rules: next }),
      });
      setRules(response.rules ?? []);
      setStatus(message);
    });
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }

    await run("Saving settings…", async () => {
      const response = await req<{ settings: Settings }>("/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setSettings(response.settings);
      setStatus("Settings saved");
    });
  }

  async function updateSuggestion(id: string, nextStatus: "confirmed" | "skipped" | "dismissed", dismissedForever = false) {
    await req(`/suggestions/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus, dismissedForever }),
    });
    setSuggestions((current) => current.filter((suggestion) => suggestion.id !== id));
    if (mockPopup?.id === id) {
      setMockPopup(null);
    }
    setStatus(
      `Suggestion ${
        nextStatus === "confirmed" ? "confirmed" : nextStatus === "skipped" ? "skipped" : "dismissed"
      }`,
    );
  }

  async function performUndo(id: string) {
    await run("Reversing…", async () => {
      await req(`/undo-history/${id}/undo`, { method: "POST" });
      await loadData();
      setStatus("Action reversed successfully");
    });
  }

  async function performDisconnect(provider: Platform, accountId: string) {
    await run(`Disconnecting ${provider === "google_drive" ? "Google Drive" : "Notion"}…`, async () => {
      await req(`/${providerPath(provider)}/oauth/connection`, {
        method: "DELETE",
        headers: {
          "X-Platform-Account": accountId,
        },
      });
      await loadData();
      setStatus(`${provider === "google_drive" ? "Google Drive" : "Notion"} account disconnected`);
    });
  }

  return (
    <div className="shell single-column">
      <div className="main">
        <nav className="top-nav" aria-label="Dashboard navigation">
          {TABS.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              <span>{item.label}</span>
              {item.id === "suggestions" && suggestions.length > 0 ? (
                <span className="nav-count">{suggestions.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <main className="page-content">
          {tab === "overview" ? (
            <OverviewPage
              loading={loading}
              signedIn={signedIn}
              providers={providerStates}
              pendingSuggestions={suggestions.length}
              blacklistCount={blacklistEntries.length}
              keywordCount={keywords.length}
              undoCount={undoHistory.length}
              onRefresh={loadData}
              onConnect={beginProviderConnection}
              onDisconnect={performDisconnect}
            />
          ) : null}
          {tab === "suggestions" ? (
            <SuggestionsPage
              suggestions={suggestions}
              mockPopup={mockPopup}
              loading={loading}
              signedIn={signedIn}
              onRefresh={loadData}
              onUpdateSuggestion={updateSuggestion}
              onTriggerMock={() =>
                setMockPopup({
                  id: `mock-${Date.now()}`,
                  title: "Archive stale file",
                  description: "This file has not been modified in two years.",
                  reason: "No recent activity was detected for this file.",
                  action: "archive",
                  confidence: "high",
                  status: "pending",
                  fileIds: ["file123"],
                  platform: "google_drive",
                })
              }
            />
          ) : null}
          {tab === "rules" ? (
            <RulesPage
              rules={rules}
              loading={loading}
              signedIn={signedIn}
              blacklistEntries={blacklistEntries}
              filetypes={filetypes}
              keywords={keywords}
              filetypeIdx={filetypeIdx}
              keywordIdx={keywordIdx}
              onSaveRules={saveRules}
            />
          ) : null}
          {tab === "history" ? (
            <HistoryPage history={undoHistory} loading={loading} signedIn={signedIn} onUndo={performUndo} />
          ) : null}
          {tab === "settings" ? (
            <SettingsPage
              key={settings ? "settings-loaded" : "settings-loading"}
              settings={settings}
              keys={keys}
              loading={loading}
              signedIn={signedIn}
              onKeysChange={setKeys}
              onSaveKeys={() => {
                localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
                setStatus("API keys saved locally");
              }}
              onSettingsChange={setSettings}
              onSaveSettings={saveSettings}
            />
          ) : null}
        </main>
      </div>

      <StatusBar message={status} type={statusType(status)} />
    </div>
  );
}
