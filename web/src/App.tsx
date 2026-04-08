import { useMemo, useState } from "react";
import "./App.css";
import { SuggestionCard, type Suggestion } from "./components/SuggestionCard";
import { PageHeader } from "./components/PageHeader";
import { StatusBar } from "./components/StatusBar";

const API_BASE = "/api";
const TOKEN_KEY = "drivesense.authToken";
const KEYS_KEY = "drivesense.byokKeys.v1";

const PROVIDERS = ["gemini", "openai", "anthropic", "glm"] as const;
type Provider = (typeof PROVIDERS)[number];
type Platform = "google_drive" | "notion";

const MODEL_OPTIONS: Record<Provider, { id: string; label: string }[]> = {
  gemini:    [{ id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" }, { id: "gemini-3-flash", label: "Gemini 3 Flash" }],
  openai:    [{ id: "gpt-5.4", label: "GPT-5.4" }, { id: "gpt-5.4-mini", label: "GPT-5.4 mini" }, { id: "gpt-4o-mini", label: "gpt-4o-mini" }],
  anthropic: [{ id: "claude-opus-4-6-latest", label: "Claude Opus 4.6" }, { id: "claude-sonnet-4-6-latest", label: "Claude Sonnet 4.6" }],
  glm:       [{ id: "glm-5", label: "GLM-5" }, { id: "glm-4.7-flash", label: "GLM-4.7-Flash" }],
};

interface Settings { llmProvider: Provider; llmModel: string | null; }
interface FolderWhitelistRule { type: "folder_whitelist"; path: string; platform: Platform; }
interface FolderBlacklistRule { type: "folder_blacklist"; path: string; platform: Platform; }
interface FiletypeWhitelistRule { type: "filetype_whitelist"; allowed_types: string[]; }
interface KeywordGuardRule { type: "keyword_guard"; keywords: string[]; }
type Rule = FolderWhitelistRule | FolderBlacklistRule | FiletypeWhitelistRule | KeywordGuardRule;
interface UndoAction { id: string; suggestionId: string | null; action: string; platform: Platform; actionDetails: Record<string, unknown>; undoPayload: Record<string, unknown>; executedAt: string; undoneAt: string | null; }
interface ProviderKeys { gemini: string; openai: string; anthropic: string; glm: string; }

const EMPTY_KEYS: ProviderKeys = { gemini: "", openai: "", anthropic: "", glm: "" };

function readToken() { return localStorage.getItem(TOKEN_KEY) ?? ""; }

/** When the dashboard is opened in Chrome and VITE_DS_EXTENSION_ID is set, push the token into the extension. */
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
  try { return { ...EMPTY_KEYS, ...(JSON.parse(localStorage.getItem(KEYS_KEY) ?? "{}") as Partial<ProviderKeys>) }; }
  catch { return EMPTY_KEYS; }
}

function statusType(msg: string): "success" | "error" | "default" {
  if (/saved|success|added|removed|undone|loaded/i.test(msg)) return "success";
  if (/fail|error|required/i.test(msg)) return "error";
  return "default";
}

export default function App() {
  const [tab, setTab] = useState("suggestions");
  const [token, setToken] = useState(readToken);
  const [tokenInput, setTokenInput] = useState(readToken);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [keys, setKeys] = useState<ProviderKeys>(readKeys);
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [undoHistory, setUndoHistory] = useState<UndoAction[]>([]);
  const [mockPopup, setMockPopup] = useState<Suggestion | null>(null);

  // Rule derived state
  const whitelistEntries = useMemo(() => rules.flatMap((r, i) => r.type === "folder_whitelist" ? [{ i, r }] : []), [rules]);
  const blacklistEntries = useMemo(() => rules.flatMap((r, i) => r.type === "folder_blacklist" ? [{ i, r }] : []), [rules]);
  const filetypeIdx = rules.findIndex(r => r.type === "filetype_whitelist");
  const filetypes = filetypeIdx >= 0 ? (rules[filetypeIdx] as FiletypeWhitelistRule).allowed_types : [];
  const keywordIdx = rules.findIndex(r => r.type === "keyword_guard");
  const keywords = keywordIdx >= 0 ? (rules[keywordIdx] as KeywordGuardRule).keywords : [];

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    if (!token) throw new Error("Save a bearer token first.");
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setLoading(true); setStatus(label);
    try { await fn(); } catch (e) { setStatus(e instanceof Error ? e.message : "Error"); } finally { setLoading(false); }
  }

  async function loadData() {
    await run("Still looking…", async () => {
      const [s, r, sg, u] = await Promise.all([
        req<{ settings: Settings }>("/settings"),
        req<{ rules: Rule[] }>("/rules"),
        req<{ suggestions: Suggestion[] }>("/suggestions?status=pending"),
        req<{ actions: UndoAction[] }>("/undo-history?limit=20&includeUndone=true"),
      ]);
      setSettings(s.settings); setRules(r.rules); setSuggestions(sg.suggestions ?? []); setUndoHistory(u.actions ?? []);
      setStatus("Updated successfully");

      // Auto-connect logic if requested via URL param
      const params = new URLSearchParams(window.location.search);
      const connectPlatform = params.get("connect");
      if (connectPlatform === "google_drive" || connectPlatform === "notion") {
        // Clear param so it doesn't loop
        window.history.replaceState({}, "", window.location.pathname);
        setStatus(`Initiating ${connectPlatform} connection...`);
        try {
          const { authUrl } = await req<{ authUrl: string }>(`/${connectPlatform.replace("_", "-")}/oauth/start`);
          window.location.href = authUrl;
        } catch (e) {
          setStatus(`Failed to start ${connectPlatform} connection`);
        }
      }
    });
  }

  // Handle direct OAuth login success
  useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === "/oauth-success") {
      const newToken = params.get("token");
      if (newToken) {
        localStorage.setItem(TOKEN_KEY, newToken);
        setToken(newToken);
        setTokenInput(newToken);
        pushTokenToExtension(newToken);
        setStatus("Login Successful. You can close this tab.");
        // Clean up URL
        window.history.replaceState({}, "", "/");
        
        // Try to close the tab if it was opened by the extension
        setTimeout(() => {
          try { window.close(); } catch (e) {}
        }, 1500);
      }
    }
  }, []);

  async function saveRules(next: Rule[], msg: string) {
    await run("Updating rules…", async () => {
      const r = await req<{ rules: Rule[] }>("/rules", { method: "PUT", body: JSON.stringify({ rules: next }) });
      setRules(r.rules); setStatus(msg);
    });
  }

  async function updateSuggestion(id: string, s: string, dismissedForever = false) {
    await req(`/suggestions/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: s, dismissedForever }) });
    setSuggestions(c => c.filter(x => x.id !== id));
    if (mockPopup?.id === id) setMockPopup(null);
    setStatus(`Suggestion ${s === 'confirmed' ? 'confirmed' : s === 'skipped' ? 'skipped' : 'dismissed'}`);
  }

  async function performUndo(id: string) {
    await run("Reversing…", async () => {
      await req(`/undo-history/${id}/undo`, { method: "POST" });
      setUndoHistory(c => c.map(a => a.id === id ? { ...a, undoneAt: new Date().toISOString() } : a));
      setStatus("Action reversed successfully");
    });
  }

  return (
    <div className="shell single-column">
      <div className="main">
        {/* Simple navigation */}
        <nav className="top-nav">
          <button className={tab === "suggestions" ? "active" : ""} onClick={() => setTab("suggestions")}>Suggestions</button>
          <button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>Rules</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
        </nav>

        <main className="page-content">
          {tab === "suggestions" && <SuggestionsPage suggestions={suggestions} mockPopup={mockPopup} loading={loading} token={token} onLoad={loadData} onUpdateSuggestion={updateSuggestion} onTriggerMock={() => setMockPopup({ id: `mock-${Date.now()}`, title: "Archive Stale File", description: "This file hasn't been modified in 2 years.", reason: "No activity since Jan 2024.", action: "archive", confidence: "high", status: "pending", fileIds: ["file123"], platform: "google_drive" })} />}
          {tab === "rules"       && <RulesPage rules={rules} loading={loading} token={token} whitelistEntries={whitelistEntries} blacklistEntries={blacklistEntries} filetypes={filetypes} keywords={keywords} filetypeIdx={filetypeIdx} keywordIdx={keywordIdx} saveRules={saveRules} />}
          {tab === "history"    && <HistoryPage history={undoHistory} loading={loading} onUndo={performUndo} />}
          {tab === "settings"   && <SettingsPage settings={settings} keys={keys} tokenInput={tokenInput} loading={loading} onTokenInput={setTokenInput} onSaveToken={() => { localStorage.setItem(TOKEN_KEY, tokenInput); setToken(tokenInput); pushTokenToExtension(tokenInput); setStatus("Token saved"); }} onSaveKeys={() => { localStorage.setItem(KEYS_KEY, JSON.stringify(keys)); setStatus("API keys saved locally"); }} onKeysChange={setKeys} onSettingsChange={setSettings} onSaveSettings={async () => { if (!settings) return; await run("Saving settings…", async () => { const r = await req<{ settings: Settings }>("/settings", { method: "PATCH", body: JSON.stringify({ llmProvider: settings.llmProvider, llmModel: settings.llmModel?.trim() || null }) }); setSettings(r.settings); setStatus("Settings saved"); }); }} onLoad={loadData} />}
        </main>
      </div>

      <StatusBar message={status} type={statusType(status)} />
    </div>
  );
}

// ─── Suggestions page ────────────────────────────────────────────────────────

function SuggestionsPage({ suggestions, mockPopup, loading, token, onLoad, onUpdateSuggestion, onTriggerMock }: {
  suggestions: Suggestion[]; mockPopup: Suggestion | null; loading: boolean; token: string;
  onLoad: () => void; onUpdateSuggestion: (id: string, s: string, d?: boolean) => Promise<void>; onTriggerMock: () => void;
}) {
  return (
    <>
      <PageHeader title="Suggestions" description="Pending file hygiene actions waiting for your review."
        action={<div style={{ display: "flex", gap: "8px" }}>
          <button id="trigger-mock" type="button" className="btn btn-ghost btn-sm" onClick={onTriggerMock}>Trigger Mock</button>
          <button id="load-suggestions" type="button" className="btn btn-primary btn-sm" onClick={onLoad} disabled={loading || !token}>Load</button>
        </div>}
      />

      {/* Mock popup preview */}
      {mockPopup && (
        <div style={{ marginBottom: "24px" }}>
          <p className="form-label" style={{ marginBottom: "8px" }}>📍 Mock popup preview</p>
          <div style={{ position: "relative" }}>
            <SuggestionCard suggestion={mockPopup} onUpdateStatus={onUpdateSuggestion} />
          </div>
        </div>
      )}

      {suggestions.length === 0
        ? <div className="empty-state"><div className="empty-state-icon">✨</div><p>No pending suggestions. Load data to check for new ones.</p></div>
        : <div className="item-list">{suggestions.map(s => <SuggestionCard key={s.id} suggestion={s} onUpdateStatus={onUpdateSuggestion} />)}</div>
      }
    </>
  );
}

// ─── Rules page ──────────────────────────────────────────────────────────────

type FolderRulePlatform = "google_drive" | "notion";

function RulesPage({ rules, loading, token, whitelistEntries, blacklistEntries, filetypes, keywords, filetypeIdx, keywordIdx, saveRules }: {
  rules: Rule[]; loading: boolean; token: string;
  whitelistEntries: { i: number; r: { path: string; platform: string } }[];
  blacklistEntries: { i: number; r: { path: string; platform: string } }[];
  filetypes: string[]; keywords: string[];
  filetypeIdx: number; keywordIdx: number;
  saveRules: (next: Rule[], msg: string) => Promise<void>;
}) {
  const [wPath, setWPath] = useState(""); const [wPlat, setWPlat] = useState<FolderRulePlatform>("google_drive");
  const [bPath, setBPath] = useState(""); const [bPlat, setBPlat] = useState<FolderRulePlatform>("google_drive");
  const [ftype, setFtype] = useState(""); const [kw, setKw] = useState("");

  return (
    <>
      <PageHeader title="Rules" description="Declarative rules DriveSense must respect. No folder is touched unless explicitly whitelisted." />

      {/* Folder whitelist */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">🟢 Folder Whitelist</div><div className="card-desc">DriveSense only scans folders you explicitly whitelist.</div></div></div>
        <div className="input-row" style={{ marginBottom: "12px" }}>
          <input id="whitelist-path" className="input" value={wPath} onChange={e => setWPath(e.target.value)} placeholder="/Team Drive/Marketing" disabled={loading} />
          <select className="select" style={{ width: "auto" }} value={wPlat} onChange={e => setWPlat(e.target.value as FolderRulePlatform)} disabled={loading}>
            <option value="google_drive">Google Drive</option><option value="notion">Notion</option>
          </select>
          <button id="add-whitelist" type="button" className="btn btn-primary btn-sm" disabled={loading || !token} onClick={async () => { if (!wPath.trim()) return; await saveRules([...rules, { type: "folder_whitelist", path: wPath.trim(), platform: wPlat }], "Whitelist folder added"); setWPath(""); }}>Add</button>
        </div>
        {whitelistEntries.length === 0
          ? <p style={{ color: "var(--text-3)", fontSize: "13px" }}>No whitelisted folders yet — DriveSense won't scan anything.</p>
          : <div className="item-list">{whitelistEntries.map(({ i, r }) => <div key={i} className="list-item"><span>{r.path} <em>{r.platform}</em></span><button type="button" className="btn btn-danger btn-xs" disabled={loading} onClick={() => saveRules(rules.filter((_, idx) => idx !== i), "Whitelist folder removed")}>Remove</button></div>)}</div>
        }
      </div>

      {/* Folder blacklist */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">🔴 Folder Blacklist</div><div className="card-desc">Never touch these folders, even inside a whitelisted parent.</div></div></div>
        <div className="input-row" style={{ marginBottom: "12px" }}>
          <input id="blacklist-path" className="input" value={bPath} onChange={e => setBPath(e.target.value)} placeholder="/Team Drive/Legal" disabled={loading} />
          <select className="select" style={{ width: "auto" }} value={bPlat} onChange={e => setBPlat(e.target.value as FolderRulePlatform)} disabled={loading}>
            <option value="google_drive">Google Drive</option><option value="notion">Notion</option>
          </select>
          <button id="add-blacklist" type="button" className="btn btn-primary btn-sm" disabled={loading || !token} onClick={async () => { if (!bPath.trim()) return; await saveRules([...rules, { type: "folder_blacklist", path: bPath.trim(), platform: bPlat }], "Blacklist folder added"); setBPath(""); }}>Add</button>
        </div>
        {blacklistEntries.length === 0
          ? <p style={{ color: "var(--text-3)", fontSize: "13px" }}>No blacklisted folders.</p>
          : <div className="item-list">{blacklistEntries.map(({ i, r }) => <div key={i} className="list-item"><span>{r.path} <em>{r.platform}</em></span><button type="button" className="btn btn-danger btn-xs" disabled={loading} onClick={() => saveRules(rules.filter((_, idx) => idx !== i), "Blacklist folder removed")}>Remove</button></div>)}</div>
        }
      </div>

      {/* File types */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">📄 File Type Whitelist</div><div className="card-desc">Only scan these file types.</div></div></div>
        <div className="input-row" style={{ marginBottom: "12px" }}>
          <input id="filetype-input" className="input" value={ftype} onChange={e => setFtype(e.target.value)} placeholder="gdoc, pdf, docx" disabled={loading} />
          <button id="add-filetype" type="button" className="btn btn-primary btn-sm" disabled={loading || !token} onClick={async () => {
            const t = ftype.trim().toLowerCase(); if (!t) return;
            const next = [...rules];
            if (filetypeIdx >= 0) { const ex = next[filetypeIdx] as { type: "filetype_whitelist"; allowed_types: string[] }; if (!ex.allowed_types.includes(t)) next[filetypeIdx] = { ...ex, allowed_types: [...ex.allowed_types, t] }; }
            else next.push({ type: "filetype_whitelist", allowed_types: [t] });
            await saveRules(next, "File type added"); setFtype("");
          }}>Add</button>
        </div>
        <div className="tag-list">
          {filetypes.length === 0 ? <span style={{ color: "var(--text-3)", fontSize: "13px" }}>No types specified — all skipped.</span>
            : filetypes.map(t => <span key={t} className="tag">{t}<button type="button" className="tag-remove" onClick={async () => {
                const next = [...rules]; const ex = next[filetypeIdx] as { type: "filetype_whitelist"; allowed_types: string[] };
                const newTypes = ex.allowed_types.filter(x => x !== t);
                if (newTypes.length === 0) { const filtered = next.filter((_, idx) => idx !== filetypeIdx); await saveRules(filtered, "File type removed"); }
                else { next[filetypeIdx] = { ...ex, allowed_types: newTypes }; await saveRules(next, "File type removed"); }
              }}>×</button></span>)}
        </div>
      </div>

      {/* Keywords */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">🔑 Keyword Guard</div><div className="card-desc">Never act on files whose name contains these keywords.</div></div></div>
        <div className="input-row" style={{ marginBottom: "12px" }}>
          <input id="keyword-input" className="input" value={kw} onChange={e => setKw(e.target.value)} placeholder="final, draft, do-not-delete" disabled={loading} />
          <button id="add-keyword" type="button" className="btn btn-primary btn-sm" disabled={loading || !token} onClick={async () => {
            const k = kw.trim().toLowerCase(); if (!k) return;
            const next = [...rules];
            if (keywordIdx >= 0) { const ex = next[keywordIdx] as { type: "keyword_guard"; keywords: string[] }; if (!ex.keywords.includes(k)) next[keywordIdx] = { ...ex, keywords: [...ex.keywords, k] }; }
            else next.push({ type: "keyword_guard", keywords: [k] });
            await saveRules(next, "Keyword added"); setKw("");
          }}>Add</button>
        </div>
        <div className="tag-list">
          {keywords.length === 0 ? <span style={{ color: "var(--text-3)", fontSize: "13px" }}>No keywords guarded.</span>
            : keywords.map(k => <span key={k} className="tag">{k}<button type="button" className="tag-remove" onClick={async () => {
                const next = [...rules]; const ex = next[keywordIdx] as { type: "keyword_guard"; keywords: string[] };
                const newKws = ex.keywords.filter(x => x !== k);
                if (newKws.length === 0) { await saveRules(next.filter((_, idx) => idx !== keywordIdx), "Keyword removed"); }
                else { next[keywordIdx] = { ...ex, keywords: newKws }; await saveRules(next, "Keyword removed"); }
              }}>×</button></span>)}
        </div>
      </div>
    </>
  );
}

// ─── Undo History page ───────────────────────────────────────────────────────

function HistoryPage({ history, loading, onUndo }: { history: UndoAction[]; loading: boolean; onUndo: (id: string) => Promise<void> }) {
  return (
    <>
      <PageHeader title="Undo History" description="All confirmed actions — fully reversible, one click." />
      {history.length === 0
        ? <div className="empty-state"><div className="empty-state-icon">📋</div><p>No history yet. Load data to see recent actions.</p></div>
        : <div className="item-list">
            {history.map(a => (
              <div key={a.id} className={`undo-item${a.undoneAt ? " undone" : ""}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span className="undo-action-badge">{a.action}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-3)" }}>{a.platform}</span>
                  </div>
                  <div className="undo-meta">Executed {new Date(a.executedAt).toLocaleString()}</div>
                  <pre className="undo-details">{JSON.stringify(a.actionDetails, null, 2)}</pre>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {a.undoneAt
                    ? <span className="undone-label">✓ Undone {new Date(a.undoneAt).toLocaleDateString()}</span>
                    : <button id={`undo-${a.id}`} type="button" className="btn btn-ghost btn-sm" onClick={() => onUndo(a.id)} disabled={loading}>↩ Undo</button>
                  }
                </div>
              </div>
            ))}
          </div>
      }
    </>
  );
}

// ─── Settings page ───────────────────────────────────────────────────────────

function SettingsPage({ settings, keys, tokenInput, loading, onTokenInput, onSaveToken, onSaveKeys, onKeysChange, onSettingsChange, onSaveSettings, onLoad }: {
  settings: Settings | null; keys: ProviderKeys; tokenInput: string; loading: boolean;
  onTokenInput: (v: string) => void; onSaveToken: () => void; onSaveKeys: () => void;
  onKeysChange: (k: ProviderKeys) => void; onSettingsChange: (s: Settings | null) => void;
  onSaveSettings: () => Promise<void>; onLoad: () => void;
}) {
  return (
    <>
      <PageHeader title="Settings" description="Auth token, LLM configuration, and BYOK API keys." />

      {/* Auth token */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">🔐 API Access Token</div><div className="card-desc">Required to authenticate with the DriveSense Node API.</div></div></div>
        <div className="form-group">
          <label className="form-label" htmlFor="auth-token">Bearer Token</label>
          <div className="input-row">
            <input id="auth-token" type="password" className="input" value={tokenInput} onChange={e => onTokenInput(e.target.value)} placeholder="Paste bearer token…" />
            <button id="save-token" type="button" className="btn btn-primary btn-sm" onClick={onSaveToken}>Save Token</button>
            <button id="load-data" type="button" className="btn btn-secondary btn-sm" onClick={onLoad} disabled={loading || !tokenInput}>Load Data</button>
          </div>
        </div>
      </div>

      {/* LLM */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">🤖 LLM Configuration</div><div className="card-desc">Persisted server-side via /settings.</div></div></div>
        <div className="grid-2" style={{ marginBottom: "16px" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="llm-provider">Provider</label>
            <select id="llm-provider" className="select" value={settings?.llmProvider ?? "gemini"} disabled={loading}
              onChange={e => { const v = e.target.value as Provider; onSettingsChange(settings ? { ...settings, llmProvider: v, llmModel: null } : { llmProvider: v, llmModel: null }); }}>
              {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="llm-model">Model</label>
            <select id="llm-model" className="select" value={settings?.llmModel ?? ""} disabled={loading}
              onChange={e => onSettingsChange(settings ? { ...settings, llmModel: e.target.value || null } : { llmProvider: "gemini", llmModel: e.target.value || null })}>
              <option value="">Default Model</option>
              {MODEL_OPTIONS[settings?.llmProvider ?? "gemini"].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <button id="save-settings" type="button" className="btn btn-primary btn-sm" onClick={onSaveSettings} disabled={loading || !settings}>Save LLM Settings</button>
      </div>

      {/* BYOK keys */}
      <div className="card">
        <div className="card-header"><div><div className="card-title">🗝️ BYOK API Keys</div><div className="card-desc">Stored in browser localStorage only — never sent to the backend.</div></div></div>
        <div className="grid-2">
          {PROVIDERS.map(p => (
            <div key={p} className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor={`key-${p}`}>{p} key</label>
              <input id={`key-${p}`} type="password" className="input" value={keys[p]} placeholder={`${p} API key`}
                onChange={e => onKeysChange({ ...keys, [p]: e.target.value })} />
            </div>
          ))}
        </div>
        <button id="save-keys" type="button" className="btn btn-primary btn-sm" style={{ marginTop: "16px" }} onClick={onSaveKeys} disabled={loading}>Save Keys Locally</button>
      </div>
    </>
  );
}
