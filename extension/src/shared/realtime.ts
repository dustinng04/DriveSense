/**
 * Supabase Realtime client for the DriveSense extension.
 * Subscribes to suggestion updates for the authenticated user.
 */

import { createClient, type RealtimeChannel, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Suggestion } from './types.js';

// Hardcoded at build time or from Vite env
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

let supabaseClient: ReturnType<typeof createClient> | null = null;
let suggestionsChannel: RealtimeChannel | null = null;

/**
 * Initialize Supabase client (called once on extension load).
 */
export function initSupabase(): void {
  if (supabaseClient) return; // Already initialized

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Realtime] Supabase credentials not configured; Realtime will be unavailable.');
    return;
  }

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export type SuggestionEvent = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  suggestion?: Suggestion;
  oldId?: string;
};

/**
 * Subscribe to all suggestion updates for the authenticated user.
 * Calls onSuggestionEvent whenever a suggestion is inserted, updated, or deleted.
 */
export function subscribeToSuggestions(
  userId: string,
  authToken: string,
  onSuggestionEvent: (event: SuggestionEvent) => void,
): () => void {
  if (!supabaseClient) {
    console.warn('[Realtime] Supabase client not initialized.');
    return () => { };
  }

  // Set the custom auth token for Realtime RLS
  supabaseClient.realtime.setAuth(authToken);

  // Unsubscribe from any existing channel
  if (suggestionsChannel) {
    void supabaseClient.removeChannel(suggestionsChannel);
  }

  // Subscribe to suggestions table filtered by user
  suggestionsChannel = supabaseClient
    .channel(`public:suggestions:user_id=eq.${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'suggestions',
        filter: `user_id=eq.${userId}`,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (payload.eventType === 'DELETE') {
          const oldId = String(payload.old?.id ?? '');
          if (oldId) {
            onSuggestionEvent({ eventType: 'DELETE', oldId });
          }
        } else {
          const row = payload.new as Record<string, unknown> | null;
          if (row) {
            const suggestion = mapRowToSuggestion(row);
            onSuggestionEvent({ eventType: payload.eventType as 'INSERT' | 'UPDATE', suggestion });
          }
        }
      },
    )
    .subscribe((status: string, err?: Error) => {
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        console.error('[Realtime] Subscription failed or closed:', status, err);
      } else if (status === 'SUBSCRIBED') {
        console.debug('[Realtime] Subscribed to suggestions.');
      }
    });

  // Return unsubscribe function
  return () => {
    if (suggestionsChannel) {
      void supabaseClient?.removeChannel(suggestionsChannel);
      suggestionsChannel = null;
    }
  };
}

/**
 * Map a Supabase suggestions row to a Suggestion type.
 */
function mapRowToSuggestion(row: Record<string, unknown>): Suggestion {
  const analysis = (row.analysis as Record<string, unknown>) ?? undefined;
  const confidence = analysis?.confidence as string;
  const normalizedConfidence: 'high' | 'medium' | 'low' = ['high', 'low'].includes(confidence)
    ? (confidence as 'high' | 'low')
    : 'medium';

  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    action: (row.action ?? 'archive') as 'archive' | 'merge' | 'rename' | 'review',
    confidence: normalizedConfidence,
    status: (row.status ?? 'pending') as Suggestion['status'],
    fileIds: ((row.files as Array<Record<string, unknown>>) ?? []).map((f) => String(f.id ?? '')),
    platform: (row.platform ?? 'google_drive') as 'google_drive' | 'notion',
    reason: (row.reason as string) ?? undefined,
    analysis,
  };
}
