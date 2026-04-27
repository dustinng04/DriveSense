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
 *  - Subscribe to Supabase Realtime for real-time suggestion delivery
 *  - Debounced cross-folder scan trigger on context detection
 */
import {
  fetchPendingSuggestions,
  ping,
  updateSuggestionStatus,
  postCrossFolderScan,
  fetchSettings,
  patchSuggestionEnrichment,
  fetchSessionMe,
  fetchFolderFiles,
  fetchParentFolderId,
} from '../shared/api.js';
import { BUILD_TIME_BEARER_TOKEN } from '../shared/buildConfig.js';
import {
  getAuthToken,
  getPendingSuggestions,
  setAuthToken,
  setPendingSuggestions,
  storageGet,
  getUserId,
} from '../shared/storage.js';
import { initSupabase, subscribeToSuggestions } from '../shared/realtime.js';
import { getAllIndexedFiles, getCandidatesForOrchestrator, isFolderCrawlFresh, upsertFilesFromCrawl } from '../shared/metadataIndex.js';
import type { BackgroundMessage, BackgroundResponse } from '../shared/types.js';
import { enrichSuggestionWithByok } from '../shared/suggestionEnrichment.js';
import { ProgressiveCrawlQueue } from './progressiveCrawl.js';

const LOG_PREFIX = '[DriveSense:bg]';
const ALARM_NAME = 'ds_suggestion_poll';
const POLL_INTERVAL_MINUTES = 5;

// Debounce control for cross-folder scan
let crossFolderTimerHandle: ReturnType<typeof setTimeout> | null = null;
let crossFolderContextKey: string | null = null;
const CROSS_FOLDER_DELAY_MS = 15_000; // 15 seconds debounce

// Progressive crawl queue
const crawlQueue = new ProgressiveCrawlQueue();

// ─── Supabase Realtime ────────────────────────────────────────────────────────

// Initialize Supabase immediately at top-level to handle MV3 service worker restarts
initSupabase();

// chrome.runtime.onStartup.addListener(() => {
//   initSupabase();
// });

// Initialize Supabase on install/update
chrome.runtime.onInstalled.addListener(() => {
  initSupabase();
  void applyBuildTimeAuthTokenIfNeeded();
});

// Helper to subscribe to realtime suggestions
async function ensureRealtimeSubscription(): Promise<void> {
  const token = await getAuthToken();
  if (!token) return;

  let userId = await getUserId();

  // Cold start fallback: decode JWT if userId is missing
  if (!userId) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadStr = atob(parts[1]!);
        const payload = JSON.parse(payloadStr);
        userId = payload.sub ?? null;
      }
    } catch {
      // Ignore
    }
  }

  if (!userId) {
    console.debug(LOG_PREFIX, 'Cannot subscribe to Realtime: missing userId');
    return;
  }

  // Subscribe (if not already subscribed)
  subscribeToSuggestions(userId, token, async (event) => {
    console.log(LOG_PREFIX, 'Realtime suggestion event', event);
    if (event.eventType === 'DELETE') {
      const current = await getPendingSuggestions();
      const next = current.filter((s) => s.id !== event.oldId);
      if (next.length !== current.length) {
        await setPendingSuggestions(next);
        const count = next.length;
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      }
      return;
    }

    const suggestion = event.suggestion;
    if (!suggestion) return;

    if (suggestion.status === 'pending_enrichment') {
      void handlePendingEnrichment(suggestion);
      return;
    }

    if (suggestion.status === 'confirmed' || suggestion.status === 'dismissed' || suggestion.status === 'skipped') {
      const current = await getPendingSuggestions();
      const next = current.filter((s) => s.id !== suggestion.id);
      if (next.length !== current.length) {
        await setPendingSuggestions(next);
        const count = next.length;
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      }
      return;
    }

    if (suggestion.status === 'pending') {
      // New suggestion arrived via Realtime; add to pending and update badge
      const current = await getPendingSuggestions();
      const existingIdx = current.findIndex((s) => s.id === suggestion.id);
      if (existingIdx === -1) {
        current.push(suggestion);
        await setPendingSuggestions(current);

        // Update badge
        chrome.action.setBadgeText({ text: String(current.length) });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

        // Optional: Show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'DriveSense',
          message: `New suggestion: ${suggestion.title}`,
        });
      } else {
        // Just update existing
        current[existingIdx] = suggestion;
        await setPendingSuggestions(current);
      }
    }
  });
}

const enrichmentInFlight = new Set<string>();

async function handlePendingEnrichment(suggestion: { id: string } & any): Promise<void> {
  if (enrichmentInFlight.has(suggestion.id)) return;
  enrichmentInFlight.add(suggestion.id);

  try {
    const { byokKeys } = await storageGet('byokKeys');

    let settings: Awaited<ReturnType<typeof fetchSettings>> | null = null;
    try {
      settings = await fetchSettings();
    } catch {
      settings = null;
    }

    const provider = settings?.llmProvider;
    const apiKey = provider ? (byokKeys?.[provider] ?? '').trim() : '';

    // Policy: if no BYOK key, promote to 'pending' with deterministic copy.
    if (!provider || !apiKey) {
      await patchSuggestionEnrichment(suggestion.id, {
        reason: suggestion.reason ?? null,
        confidence: suggestion.confidence ?? 'medium',
        analysis: { enrichment: { kind: 'byok_extension', skipped: true, reason: 'missing_byok_key_or_provider' } },
      });
      return;
    }

    const enrichment = await enrichSuggestionWithByok(suggestion, { provider, apiKey });
    if (!enrichment) {
      await patchSuggestionEnrichment(suggestion.id, {
        reason: suggestion.reason ?? null,
        confidence: suggestion.confidence ?? 'medium',
        analysis: { enrichment: { kind: 'byok_extension', skipped: true, reason: 'unsupported_or_missing_analysis' } },
      });
      return;
    }

    const mergedReason = [suggestion.reason, `LLM note: ${enrichment.reason}`].filter(Boolean).join(' • ');

    await patchSuggestionEnrichment(suggestion.id, {
      reason: mergedReason || null,
      confidence: enrichment.confidence,
      analysis: enrichment.analysisPatch,
    });
  } catch (error) {
    console.debug(LOG_PREFIX, 'enrichment failed', error);
  } finally {
    enrichmentInFlight.delete(suggestion.id);
  }
}

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.authToken) {
    console.log(LOG_PREFIX, 'authToken changed, refreshing suggestions');
    void refreshSuggestions();
  }
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
          accountId: message.accountId,
          url: message.url,
          fileId: message.fileId,
          contextType: message.contextType,
        },
      });

      // Clear old crawl queue and prioritize new context
      crawlQueue.clear();

      // Trigger in-folder refresh
      void refreshSuggestions();

      // Debounce cross-folder scan (wait 30s for user to stay in this context)
      await triggerCrossFolderScanDebounced(message.platform, message.fileId ?? 'unknown');

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
    // Also fetch and store user identity to ensure chrome.storage.local is populated with userId and oauth accounts
    await fetchSessionMe().catch(() => { });

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

    // Ensure Realtime subscription is active
    void ensureRealtimeSubscription();
  } catch (error) {
    console.error(LOG_PREFIX, 'Failed to refresh suggestions', error);
  }
}

// ─── Cross-folder scan debounce ───────────────────────────────────────────────

/**
 * Debounced cross-folder scan trigger.
 * Waits 30s after context detection; if user switches context, cancels the scan.
 */
async function triggerCrossFolderScanDebounced(platform: string, folderId: string): Promise<void> {
  // Compose a key to track which context we're waiting for
  const contextKey = `${platform}:${folderId}`;

  // Clear any pending timer for a different context
  if (crossFolderTimerHandle !== null) {
    clearTimeout(crossFolderTimerHandle);
  }

  // Update the current context we're tracking
  crossFolderContextKey = contextKey;

  // Schedule the scan for 30 seconds from now
  crossFolderTimerHandle = setTimeout(async () => {
    crossFolderTimerHandle = null;

    // Check if context is still the same (user hasn't switched folders)
    if (crossFolderContextKey !== contextKey) {
      console.debug(LOG_PREFIX, 'Cross-folder scan cancelled (context switched)');
      return;
    }

    // Perform the cross-folder scan
    await performCrossFolderScan();
  }, CROSS_FOLDER_DELAY_MS);
}

/**
 * Execute the cross-folder scan.
 * Fetches candidates and universe from local index, posts to Node API.
 */
async function performCrossFolderScan(): Promise<void> {
  try {
    const { activeContext, oauthAccountSummaries, byokKeys } = await storageGet('activeContext', 'oauthAccountSummaries', 'byokKeys');

    if (!activeContext?.platform || !activeContext?.fileId) {
      console.log(LOG_PREFIX, 'Cross-folder scan skipped: no active context or fileId');
      return;
    }

    // Resolve accountId
    const accountId = oauthAccountSummaries
      .filter((acc) => acc.provider === activeContext.platform)
      .find((acc) => acc.accountId === activeContext.accountId)?.accountId;

    if (!accountId) {
      console.log(LOG_PREFIX, 'Cross-folder scan skipped: cannot resolve accountId');
      return;
    }

    // Determine the folder to scan
    let folderIdToScan = activeContext.fileId;
    let shouldScan = true;

    if (activeContext.contextType === 'file') {
      // File context: resolve parent folder
      const parentFolderId = await fetchParentFolderId(activeContext.platform as any, activeContext.fileId);
      
      if (!parentFolderId) {
        console.log(LOG_PREFIX, 'Skipping folder crawl: file has no parent folder');
        shouldScan = false;
      } else {
        folderIdToScan = parentFolderId;
        console.log(LOG_PREFIX, `File context: will scan parent folder ${parentFolderId}`);
      }
    } else if (activeContext.contextType === 'folder') {
      // Folder context: check if it's root
      if (activeContext.fileId === 'root') {
        console.log(LOG_PREFIX, 'Skipping folder crawl: user is browsing root folder view (too broad)');
        shouldScan = false;
      }
    }

    // Check if we need to crawl the folder
    if (shouldScan) {
      const isFresh = await isFolderCrawlFresh(activeContext.platform as any, accountId, folderIdToScan);
      if (!isFresh) {
        console.log(LOG_PREFIX, `Folder crawl is stale or missing. Fetching from Node API...`);
        const fetchedFiles = await fetchFolderFiles(activeContext.platform as any, folderIdToScan);
        if (fetchedFiles.length > 0) {
          await upsertFilesFromCrawl(activeContext.platform as any, accountId, folderIdToScan, fetchedFiles);
        }
      }

      // Enqueue progressive crawl to discover parent + siblings
      await crawlQueue.enqueue({
        folderId: folderIdToScan,
        platform: activeContext.platform as any,
        accountId,
        priority: 0, // Current folder (highest priority)
        depth: 0,
      });

      // Start processing queue (non-blocking)
      void crawlQueue.processQueue().catch(err => {
        console.error(LOG_PREFIX, 'Progressive crawl failed:', err);
      });
    }

    // Log metadataIndex state so we can verify it's populated
    const { metadataIndex } = await storageGet('metadataIndex');
    console.log(LOG_PREFIX, 'metadataIndex snapshot', {
      version: metadataIndex?.version,
      totalEntries: Object.keys(metadataIndex?.entries ?? {}).length,
      totalFolderCrawls: Object.keys(metadataIndex?.folderCrawls ?? {}).length,
      folderCrawlKeys: Object.keys(metadataIndex?.folderCrawls ?? {}),
    });

    // Fetch candidates (files in current folder) and universe (all other files)
    const candidatesRaw = await getCandidatesForOrchestrator(
      activeContext.platform as any,
      accountId,
      folderIdToScan, // Use resolved folder ID, not activeContext.fileId
    );

    const universeRaw = await getAllIndexedFiles(activeContext.platform as any, accountId);

    // Filter universe to exclude candidates (to avoid comparing file against itself)
    const candidateIds = new Set(candidatesRaw.map((c) => c.id));
    const universeFiltered = universeRaw.filter((u) => !candidateIds.has(u.id));

    // Map to payload shape (include all required fields)
    const candidates = candidatesRaw.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedAt: f.modifiedAt,
      createdAt: f.createdAt,
      sizeBytes: f.sizeBytes,
      platform: f.platform,
      parentFolderIds: f.parentFolderIds,
    }));

    const universe = universeFiltered.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedAt: f.modifiedAt,
      createdAt: f.createdAt,
      sizeBytes: f.sizeBytes,
      platform: f.platform,
      parentFolderIds: f.parentFolderIds,
    }));

    if (candidates.length === 0 || universe.length === 0) {
      console.debug(LOG_PREFIX, 'Cross-folder scan skipped: insufficient files to compare');
      return;
    }

    // Fetch user LLM settings to pass to orchestrator
    let userSettings;
    try {
      userSettings = await fetchSettings();
    } catch (error) {
      console.debug(LOG_PREFIX, 'Could not fetch user settings, using defaults', error);
    }

    const llmProvider = userSettings?.llmProvider;
    const hasByokKey = llmProvider && (byokKeys?.[llmProvider] ?? '').trim().length > 0;

    console.debug(
      LOG_PREFIX,
      `Initiating cross-folder scan: ${candidates.length} candidates vs ${universe.length} universe files, LLM provider: ${llmProvider}, BYOK: ${hasByokKey}`,
    );

    // Post to Node API (async, no await needed)
    await postCrossFolderScan({
      platform: activeContext.platform as any,
      accountId,
      candidates,
      universe,
      llm: {
        provider: llmProvider,
        hasByokKey,
      },
    });

    console.debug(LOG_PREFIX, 'Cross-folder scan posted to Node API');
  } catch (error) {
    console.error(LOG_PREFIX, 'Failed to perform cross-folder scan:', error);
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

// ─── Tab visibility listeners for crawl queue ────────────────────────────────

/**
 * Pause crawl queue when user switches away from Drive/Notion tabs.
 * Resume when they come back.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const url = tab.url || '';
    
    if (url.includes('drive.google.com') || url.includes('notion.so')) {
      crawlQueue.resume();
    } else {
      crawlQueue.pause('tab_inactive');
    }
  } catch (error) {
    // Tab might be closing, ignore
  }
});

/**
 * Also check when tabs are updated (e.g., navigation within same tab).
 */
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const url = tab.url || '';
    
    if (url.includes('drive.google.com') || url.includes('notion.so')) {
      crawlQueue.resume();
    } else {
      crawlQueue.pause('tab_inactive');
    }
  }
});

console.debug(LOG_PREFIX, 'service worker started');
