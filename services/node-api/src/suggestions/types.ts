/**
 * Suggestion Card — the data structure surfaced to the UI.
 * Contains all information needed for the UI to display and execute an action.
 */
export interface SuggestionCard {
  /** Unique identifier for this suggestion */
  id: string;
  /** Short action label (e.g., "Archive stale file", "Merge duplicates") */
  title: string;
  /** Plain-language explanation of why this action is recommended */
  description: string;
  /** The action type: archive, merge, rename, or review */
  action: 'archive' | 'merge' | 'rename' | 'review';
  /** File IDs involved (typically 1 for archive/rename, 2+ for merge) */
  fileIds: string[];
  /** Confidence level: high, medium, or low */
  confidence: 'high' | 'medium' | 'low';
  /** ISO 8601 timestamp when this card was generated */
  generatedAt: string;
}

/**
 * Minimal card request — internal format used by the builder.
 * Builder transforms analysis results into this format, then to SuggestionCard.
 */
export interface SuggestionRequest {
  action: 'archive' | 'merge' | 'rename' | 'review';
  fileIds: string[];
  title: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
}
