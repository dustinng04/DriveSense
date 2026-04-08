/**
 * DriveSense background service worker (MV3).
 *
 * Responsibilities:
 *  - Periodically poll the Node API for pending suggestions (when auth token is set)
 *  - Cache suggestions in chrome.storage.local so popup and content scripts
 *    can access them without making their own API calls
 *  - Respond to messages from content scripts and popup
 *  - Accept auth token from the dashboard (externally_connectable)
 *  - Handle notification click → open web dashboard
 */
import {
  fetchPendingSuggestions,
  ping,
  updateSuggestionStatus,
} from '../shared/api.js';
import { BUILD_TIME_BEARER_TOKEN } from '../shared/buildConfig.js';
import {
  getAuthToken,
  getPendingSuggestions,
  setAuthToken,
  setPendingSuggestions,
  storageGet,
} from '../shared/storage.js';
import type { BackgroundMessage, BackgroundResponse } from '../shared/types.js';

const LOG_PREFIX = '[DriveSense:bg]';
const ALARM_NAME = 'ds_suggestion_poll';
const POLL_INTERVAL_MINUTES = 5;

// ─── Alarm: periodic suggestion refresh ───────────────────────────────────────

chrome.alarms.create(ALARM_NAME, {
  periodInMinutes: POLL_INTERVAL_MINUTES,
  delayInMinutes: 0.1, // small delay so service worker is fully initialised
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void refreshSuggestions();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void applyBuildTimeAuthTokenIfNeeded();
});

chrome.runtime.onMessageExternal.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (r: { ok: boolean; error?: string }) => void,
  ) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'SET_AUTH_TOKEN'
    ) {
      const raw = (message as { token?: unknown }).token;
      if (typeof raw !== 'string') {
        sendResponse({ ok: false, error: 'Missing token.' });
        return false;
      }

      void setAuthToken(raw.trim()).then(
        () => {
          sendResponse({ ok: true });
          void refreshSuggestions();
        },
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to store token.',
          }),
      );

      return true;
    }

    sendResponse({ ok: false, error: 'Unknown external message.' });
    return false;
  },
);

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error(LOG_PREFIX, 'message handler error', error);
        sendResponse({
          type: 'ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    // Return true to keep the message channel open for the async response
    return true;
  },
);

async function handleMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'PING':
      return { type: 'OK' };

    case 'GET_BYOK_KEY': {
      const { byokKeys } = await storageGet('byokKeys');
      return { type: 'BYOK_KEY', key: byokKeys[message.provider] ?? '' };
    }

    case 'GET_PENDING_COUNT': {
      const suggestions = await getPendingSuggestions();
      return { type: 'PENDING_COUNT', count: suggestions.length };
    }

    case 'DISMISS_SUGGESTION': {
      try {
        await updateSuggestionStatus(message.id, 'dismissed', true);
        const current = await getPendingSuggestions();
        await setPendingSuggestions(current.filter((s) => s.id !== message.id));
        return { type: 'OK' };
      } catch (error) {
        return {
          type: 'ERROR',
          message: error instanceof Error ? error.message : 'Failed to dismiss',
        };
      }
    }

    case 'CONTEXT_DETECTED': {
      // Content script detected a Drive/Notion page — store context and trigger refresh
      await chrome.storage.local.set({
        activeContext: {
          platform: message.platform,
          accountEmail: message.accountEmail,
          url: message.url,
          fileId: message.fileId,
        }
      });
      void refreshSuggestions();
      return { type: 'OK' };
    }

    default:
      return { type: 'ERROR', message: 'Unknown message type' };
  }
}

// ─── Suggestion refresh ───────────────────────────────────────────────────────

async function refreshSuggestions(): Promise<void> {
  const token = await getAuthToken();
  if (!token) {
    console.debug(LOG_PREFIX, 'skipping refresh — no auth token');
    return;
  }

  const reachable = await ping();
  if (!reachable) {
    console.debug(LOG_PREFIX, 'API not reachable, skipping refresh');
    return;
  }

  const { activeContext } = await chrome.storage.local.get('activeContext') as { activeContext: any };
  console.debug(LOG_PREFIX, 'refreshing suggestions for context', activeContext);

  try {
    const suggestions = await fetchPendingSuggestions();
    const previous = await getPendingSuggestions();
    await setPendingSuggestions(suggestions);

    // Badge count
    const count = suggestions.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

    // Show notification only if new suggestions arrived
    const currentIds = new Set(suggestions.map((s) => s.id));
    const previousIds = new Set(previous.map((s) => s.id));
    const brandNew = suggestions.filter((s) => !previousIds.has(s.id));

    if (brandNew.length > 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'DriveSense',
        message:
          brandNew.length === 1
            ? `New suggestion: ${brandNew[0]!.title}`
            : `${brandNew.length} new file hygiene suggestions`,
      });
    }

    // Remove stale IDs that are no longer pending
    const { lastShownSuggestionId } = await storageGet('lastShownSuggestionId');
    if (lastShownSuggestionId && !currentIds.has(lastShownSuggestionId)) {
      await chrome.storage.local.set({ lastShownSuggestionId: null });
    }
  } catch (error) {
    console.error(LOG_PREFIX, 'Failed to refresh suggestions', error);
  }
}

async function applyBuildTimeAuthTokenIfNeeded(): Promise<void> {
  if (!BUILD_TIME_BEARER_TOKEN) {
    return;
  }

  const existing = await getAuthToken();
  if (existing?.trim()) {
    return;
  }

  await setAuthToken(BUILD_TIME_BEARER_TOKEN);
}

void applyBuildTimeAuthTokenIfNeeded();

console.debug(LOG_PREFIX, 'service worker started');
