import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import type { FiletypeWhitelistRule, KeywordGuardRule, Platform, Rule } from "../types";

interface Props {
  rules: Rule[];
  loading: boolean;
  signedIn: boolean;
  blacklistEntries: { i: number; r: { path: string; platform: Platform } }[];
  filetypes: string[];
  keywords: string[];
  filetypeIdx: number;
  keywordIdx: number;
  onSaveRules: (next: Rule[], message: string) => Promise<void>;
}

export function RulesPage({
  rules,
  loading,
  signedIn,
  blacklistEntries,
  filetypes,
  keywords,
  filetypeIdx,
  keywordIdx,
  onSaveRules,
}: Props) {
  const [blacklistPath, setBlacklistPath] = useState("");
  const [blacklistPlatform, setBlacklistPlatform] = useState<Platform>("google_drive");
  const [filetype, setFiletype] = useState("");
  const [keyword, setKeyword] = useState("");

  if (!signedIn) {
    return (
      <>
        <PageHeader title="Rules" description="DriveSense rules become editable after sign-in." />
        <div className="empty-state">
          <div className="empty-state-icon">🛡️</div>
          <p>Sign in from Overview to manage blacklists, file types, and keyword guards.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Rules"
        description="DriveSense scans by default and skips anything blocked here."
      />

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Folder Blacklist</div>
            <div className="card-desc">Exclude folders DriveSense should never touch.</div>
          </div>
        </div>
        <div className="input-row">
          <input
            id="blacklist-path"
            className="input"
            value={blacklistPath}
            onChange={(event) => setBlacklistPath(event.target.value)}
            placeholder="/Team Drive/Legal"
            disabled={loading}
          />
          <select
            className="select platform-select"
            value={blacklistPlatform}
            onChange={(event) => setBlacklistPlatform(event.target.value as Platform)}
            disabled={loading}
          >
            <option value="google_drive">Google Drive</option>
            <option value="notion">Notion</option>
          </select>
          <button
            id="add-blacklist"
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading}
            onClick={async () => {
              if (!blacklistPath.trim()) {
                return;
              }

              await onSaveRules(
                [
                  ...rules,
                  { type: "folder_blacklist", path: blacklistPath.trim(), platform: blacklistPlatform },
                ],
                "Blacklist folder added",
              );
              setBlacklistPath("");
            }}
          >
            Add
          </button>
        </div>
        {blacklistEntries.length === 0 ? (
          <p className="helper-copy">No blacklisted folders yet.</p>
        ) : (
          <div className="item-list compact-list">
            {blacklistEntries.map(({ i, r }) => (
              <div key={`${r.platform}:${r.path}:${i}`} className="list-item">
                <span>
                  {r.path} <em>{r.platform}</em>
                </span>
                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  disabled={loading}
                  onClick={() => onSaveRules(rules.filter((_, idx) => idx !== i), "Blacklist folder removed")}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">File Type Allowlist</div>
            <div className="card-desc">Only analyze the file types you explicitly allow.</div>
          </div>
        </div>
        <div className="input-row">
          <input
            id="filetype-input"
            className="input"
            value={filetype}
            onChange={(event) => setFiletype(event.target.value)}
            placeholder="gdoc, pdf, md"
            disabled={loading}
          />
          <button
            id="add-filetype"
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading}
            onClick={async () => {
              const normalized = filetype.trim().toLowerCase();
              if (!normalized) {
                return;
              }

              const next = [...rules];
              if (filetypeIdx >= 0) {
                const existing = next[filetypeIdx] as FiletypeWhitelistRule;
                if (!existing.allowedTypes.includes(normalized)) {
                  next[filetypeIdx] = { ...existing, allowedTypes: [...existing.allowedTypes, normalized] };
                }
              } else {
                next.push({ type: "filetype_whitelist", allowedTypes: [normalized] });
              }

              await onSaveRules(next, "File type added");
              setFiletype("");
            }}
          >
            Add
          </button>
        </div>
        <div className="tag-list">
          {filetypes.length === 0 ? (
            <span className="helper-copy">No file types specified yet.</span>
          ) : (
            filetypes.map((type) => (
              <span key={type} className="tag">
                {type}
                <button
                  type="button"
                  className="tag-remove"
                  onClick={async () => {
                    const next = [...rules];
                    const existing = next[filetypeIdx] as FiletypeWhitelistRule;
                    const remaining = existing.allowedTypes.filter((value) => value !== type);

                    if (remaining.length === 0) {
                      await onSaveRules(next.filter((_, idx) => idx !== filetypeIdx), "File type removed");
                    } else {
                      next[filetypeIdx] = { ...existing, allowedTypes: remaining };
                      await onSaveRules(next, "File type removed");
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Keyword Guard</div>
            <div className="card-desc">Skip files whose names contain these protected keywords.</div>
          </div>
        </div>
        <div className="input-row">
          <input
            id="keyword-input"
            className="input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="final, signed, do-not-delete"
            disabled={loading}
          />
          <button
            id="add-keyword"
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading}
            onClick={async () => {
              const normalized = keyword.trim().toLowerCase();
              if (!normalized) {
                return;
              }

              const next = [...rules];
              if (keywordIdx >= 0) {
                const existing = next[keywordIdx] as KeywordGuardRule;
                if (!existing.keywords.includes(normalized)) {
                  next[keywordIdx] = { ...existing, keywords: [...existing.keywords, normalized] };
                }
              } else {
                next.push({ type: "keyword_guard", keywords: [normalized] });
              }

              await onSaveRules(next, "Keyword added");
              setKeyword("");
            }}
          >
            Add
          </button>
        </div>
        <div className="tag-list">
          {keywords.length === 0 ? (
            <span className="helper-copy">No guarded keywords yet.</span>
          ) : (
            keywords.map((value) => (
              <span key={value} className="tag">
                {value}
                <button
                  type="button"
                  className="tag-remove"
                  onClick={async () => {
                    const next = [...rules];
                    const existing = next[keywordIdx] as KeywordGuardRule;
                    const remaining = existing.keywords.filter((item) => item !== value);

                    if (remaining.length === 0) {
                      await onSaveRules(next.filter((_, idx) => idx !== keywordIdx), "Keyword removed");
                    } else {
                      next[keywordIdx] = { ...existing, keywords: remaining };
                      await onSaveRules(next, "Keyword removed");
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </div>
    </>
  );
}
