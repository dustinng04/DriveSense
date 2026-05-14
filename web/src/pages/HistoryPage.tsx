import { useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import type { Platform, UndoAction, UndoHistoryGroup } from "../types";

interface Props {
  history: UndoAction[];
  loading: boolean;
  signedIn: boolean;
  onUndo: (id: string) => Promise<void>;
}

function groupUndoHistory(history: UndoAction[]): UndoHistoryGroup[] {
  const groups = new Map<string, UndoAction[]>();

  for (const entry of history) {
    const key = entry.actionGroupId ?? entry.id;
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return [...groups.entries()]
    .map(([undoRef, entries]) => ({
      undoRef,
      entries: [...entries].sort((a, b) => (a.actionGroupStep ?? 0) - (b.actionGroupStep ?? 0)),
      primaryEntry: [...entries].sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())[0]!,
    }))
    .sort((a, b) => new Date(b.primaryEntry.executedAt).getTime() - new Date(a.primaryEntry.executedAt).getTime());
}

function getUndoGroupStatus(entries: UndoAction[]): UndoAction["undoStatus"] {
  if (entries.some((entry) => entry.undoStatus === "failed")) return "failed";
  if (entries.every((entry) => entry.undoStatus === "done")) return "done";
  if (entries.every((entry) => entry.undoStatus === "expired")) return "expired";
  return "available";
}

function formatPlatform(platform: Platform): string {
  return platform === "google_drive" ? "Google Drive" : "Notion";
}

function formatActionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

function summarizeActionDetails(actionDetails: Record<string, unknown>): string {
  const candidateKeys = ["newName", "fileId", "survivorFileId", "sourceFileId", "updateCount"];

  for (const key of candidateKeys) {
    const value = actionDetails[key];
    if (typeof value === "string" && value.trim()) return `${key}: ${value}`;
    if (typeof value === "number") return `${key}: ${value}`;
  }

  const firstEntry = Object.entries(actionDetails).find(([, value]) => {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  });

  if (!firstEntry) return "No details available";
  return `${firstEntry[0]}: ${String(firstEntry[1])}`;
}

function formatUndoStatus(status: UndoAction["undoStatus"]): string {
  if (status === "done") return "Undone";
  if (status === "expired") return "Undo window closed";
  if (status === "failed") return "Needs retry";
  return "Available";
}

export function HistoryPage({ history, loading, signedIn, onUndo }: Props) {
  const groups = useMemo(() => groupUndoHistory(history), [history]);

  if (!signedIn) {
    return (
      <>
        <PageHeader title="Undo History" description="Confirmed actions appear here after sign-in." />
        <div className="empty-state">
          <div className="empty-state-icon">↩</div>
          <p>Sign in from Overview to inspect undo history.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Undo History"
        description="Recent confirmed actions, grouped by operation and refreshed from the server after each undo."
      />
      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>No history yet.</p>
        </div>
      ) : (
        <div className="item-list">
          {groups.map((group) => {
            const status = getUndoGroupStatus(group.entries);
            const canUndo = status === "available" || status === "failed";
            const expiry = group.entries
              .map((entry) => entry.expiresAt)
              .filter((value): value is string => Boolean(value))
              .sort()[0];

            return (
              <div key={group.undoRef} className={`undo-item status-${status}`}>
                <div className="undo-header">
                  <div className="undo-copy">
                    <div className="undo-title-row">
                      <span className="undo-action-badge">{formatActionLabel(group.primaryEntry.action)}</span>
                      <span className="undo-platform-label">{formatPlatform(group.primaryEntry.platform)}</span>
                      {group.entries.length > 1 ? <span className="undo-step-count">{group.entries.length} steps</span> : null}
                      <span className={`undo-status-pill status-${status}`}>{formatUndoStatus(status)}</span>
                    </div>
                    <div className="undo-meta">Executed {new Date(group.primaryEntry.executedAt).toLocaleString()}</div>
                    {expiry ? <div className="undo-meta">Expires {new Date(expiry).toLocaleString()}</div> : null}
                  </div>
                  <button
                    id={`undo-${group.undoRef}`}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onUndo(group.undoRef)}
                    disabled={loading || !canUndo}
                  >
                    Undo
                  </button>
                </div>

                <div className="undo-group-list">
                  {group.entries.map((entry) => (
                    <div key={entry.id} className="undo-group-entry">
                      <div className="undo-group-entry-header">
                        <span className="undo-entry-label">
                          {group.entries.length > 1 ? `Step ${entry.actionGroupStep ?? 1}` : "Action"}
                        </span>
                        <span className={`undo-entry-state status-${entry.undoStatus}`}>{formatUndoStatus(entry.undoStatus)}</span>
                      </div>
                      <div className="undo-meta">{summarizeActionDetails(entry.actionDetails)}</div>
                      {entry.undoError ? <div className="undo-error">{entry.undoError}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
