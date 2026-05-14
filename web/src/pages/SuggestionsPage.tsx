import { PageHeader } from "../components/PageHeader";
import { SuggestionCard } from "../components/SuggestionCard";
import type { Suggestion } from "../types";

interface Props {
  suggestions: Suggestion[];
  mockPopup: Suggestion | null;
  loading: boolean;
  signedIn: boolean;
  onRefresh: () => void;
  onUpdateSuggestion: (id: string, status: "confirmed" | "skipped" | "dismissed", dismissedForever?: boolean) => Promise<void>;
  onTriggerMock: () => void;
}

export function SuggestionsPage({
  suggestions,
  mockPopup,
  loading,
  signedIn,
  onRefresh,
  onUpdateSuggestion,
  onTriggerMock,
}: Props) {
  if (!signedIn) {
    return (
      <>
        <PageHeader
          title="Suggestions"
          description="Pending file hygiene actions appear here once your dashboard session is ready."
        />
        <div className="empty-state">
          <div className="empty-state-icon">🪟</div>
          <p>Sign in from Overview to review suggestions from the extension.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="Pending file hygiene actions waiting for your review."
        action={
          <div className="header-actions">
            <button id="trigger-mock" type="button" className="btn btn-ghost btn-sm" onClick={onTriggerMock}>
              Trigger Mock
            </button>
            <button id="refresh-suggestions" type="button" className="btn btn-primary btn-sm" onClick={onRefresh} disabled={loading}>
              Refresh
            </button>
          </div>
        }
      />

      {mockPopup ? (
        <div className="preview-block">
          <p className="form-label">Popup preview</p>
          <SuggestionCard suggestion={mockPopup} onUpdateStatus={onUpdateSuggestion} />
        </div>
      ) : null}

      {suggestions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <p>No pending suggestions right now.</p>
        </div>
      ) : (
        <div className="item-list">
          {suggestions.map((suggestion) => (
            <SuggestionCard key={suggestion.id} suggestion={suggestion} onUpdateStatus={onUpdateSuggestion} />
          ))}
        </div>
      )}
    </>
  );
}
