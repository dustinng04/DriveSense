import { useState } from 'react';
import type { Suggestion } from '../types';

interface Props {
  suggestion: Suggestion;
  onUpdateStatus: (id: string, status: 'confirmed' | 'skipped' | 'dismissed', dismissedForever?: boolean) => Promise<void>;
}

export function SuggestionCard({ suggestion, onUpdateStatus }: Props) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (status: 'confirmed' | 'skipped' | 'dismissed', dismissedForever = false) => {
    setLoading(true);
    try {
      await onUpdateStatus(suggestion.id, status, dismissedForever);
    } finally {
      setLoading(false);
    }
  };

  const actionLabels: Record<string, string> = {
    archive: "Move to archive?",
    merge: "Merge files?",
    rename: "Rename file?",
    review: "Review duplicates?",
  };

  const icons: Record<string, string> = {
    archive: "📦",
    merge: "📑",
    rename: "✏️",
    review: "🔍",
  };

  return (
    <article className="suggestion-card-refined" aria-label={suggestion.title}>
      <div className="suggestion-body">
        <div className="suggestion-icon">{icons[suggestion.action] ?? "✨"}</div>
        <div className="suggestion-content">
          <div className="suggestion-title">{suggestion.title}</div>
          <div className="suggestion-reason">{suggestion.reason || suggestion.description}</div>
        </div>
      </div>

      <div className="suggestion-actions">
        <button
          type="button"
          id={`confirm-${suggestion.id}`}
          className="btn-action-primary"
          onClick={() => handleAction('confirmed')}
          disabled={loading}
        >
          {actionLabels[suggestion.action] || "Accept suggestion?"}
        </button>
        <button
          type="button"
          id={`skip-${suggestion.id}`}
          className="btn-action-ghost"
          onClick={() => handleAction('skipped')}
          disabled={loading}
        >
          Not now
        </button>
      </div>
    </article>
  );
}
