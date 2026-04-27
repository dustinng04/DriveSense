/**
 * DriveSense content script.
 *
 * Injected into Google Drive and Notion pages.
 * Responsibilities:
 *  1. Detect the current page context (platform, file/folder URL)
 *  2. Notify the background worker so it can trigger a suggestion refresh
 *  3. Render a non-intrusive suggestion overlay card when the background
 *     worker has pending suggestions that haven't been shown yet
 */
import type { BackgroundMessage, BackgroundResponse, OAuthAccountSummary, Platform, Suggestion } from '../shared/types.js';

const LOG_PREFIX = '[DriveSense]';
const OVERLAY_ID = 'drivesense-overlay';

// ─── Context detection ────────────────────────────────────────────────────────

function detectPlatform(): Platform | null {
  const { hostname } = window.location;
  if (hostname === 'drive.google.com' || hostname === 'docs.google.com') {
    return 'google_drive';
  }
  if (hostname === 'notion.so' || hostname.endsWith('.notion.so')) {
    return 'notion';
  }
  return null;
}

function extractFileId(): string | undefined {
  const { pathname } = window.location;

  // Google Docs / Sheets / Slides / Forms: /document/d/{id}, /spreadsheets/d/{id}, etc.
  const googleAppsMatch = pathname.match(/\/(?:document|spreadsheets|presentation|forms)\/d\/([^/]+)/);
  if (googleAppsMatch) return googleAppsMatch[1];

  // Google Drive file preview: /file/d/{id}/...
  const driveFileMatch = pathname.match(/\/file\/d\/([^/]+)/);
  if (driveFileMatch) return driveFileMatch[1];

  // Google Drive folder: /drive/folders/{id} or /drive/u/N/folders/{id}
  const folderMatch = pathname.match(/\/folders\/([^/]+)/);
  if (folderMatch) return folderMatch[1];

  // Shared drive (Team Drive): /drive/u/N/drives/{id}
  const sharedDriveMatch = pathname.match(/\/drives\/([^/]+)/);
  if (sharedDriveMatch) return sharedDriveMatch[1];

  // Google Drive root (my-drive, shared-with-me, computers)
  if (pathname.match(/^\/drive(\/u\/\d+)?\/(my-drive|shared-with-me|computers)/)) {
    return 'root';
  }

  // Notion page: notion.so/{workspace}/{id} or notion.so/{slug}-{id}
  // ID is a 32-character hex string at the end of the path; normalize to hyphenated UUID.
  const notionMatch = pathname.match(/(?:-|\/)([a-f0-9]{32})(?:\/|$)/i);
  if (notionMatch) {
    // const h = notionMatch[1]!;
    // return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    if (notionMatch) return notionMatch[1];
  }

  return undefined;
}

/**
 * Determine whether the current page is a file view (Docs/Sheets/Slides/Forms)
 * or a folder/drive view. Used to guard server-side folder crawls.
 */
function extractContextType(): 'file' | 'folder' {
  const { hostname, pathname } = window.location;
  // docs.google.com always hosts file editors
  if (hostname === 'docs.google.com') return 'file';
  // /file/d/{id} is a direct file download/preview
  if (pathname.match(/\/file\/d\//)) return 'file';
  // Everything else on drive.google.com (folders, drives, root) is a folder context
  return 'folder';
}

/**
 * Best-effort OAuth `account_id` for the active session (matches server persistence).
 *
 * Google Drive — Drive URLs include an authuser slot (/u/N/). We send that slot
 * index to the background worker which calls accounts.google.com/ListAccounts
 * (cookie-authenticated) and returns the Gaia ID for that exact slot.
 * Falls back to DOM scraping if the background is unavailable.
 *
 * Notion — content scripts run on www.notion.so (same origin). We call
 * /api/v3/syncRecordValues with the current page's block ID (from URL) to read
 * `block[pageId].spaceId`, which is hardcoded to the page's originating workspace.
 */
async function detectPlatformAccountId(platform: Platform): Promise<string | undefined> {
  // ── Google Drive ────────────────────────────────────────────────────────────
  if (platform === 'google_drive') {
    // 1. Try to match by email from DOM first (fastest, no network)
    const activeEmail = (() => {
      // Profile button aria-label: "Google Account: Name (email@gmail.com)"
      const profileLink = document.querySelector('a[href^="https://accounts.google.com/SignOutOptions"]');
      const label = profileLink?.getAttribute('aria-label') ?? '';
      const emailMatch = label.match(/\(([^)]+)\)/);
      if (emailMatch?.[1]) return emailMatch[1].trim();

      // Fallback: look for common email-like text in the account switcher area
      const accountInfo = document.querySelector('.gb_re, .gb_te');
      if (accountInfo?.textContent?.includes('@')) {
        return accountInfo.textContent.trim();
      }
      return undefined;
    })();

    if (activeEmail) {
      const { oauthAccountSummaries } = (await chrome.storage.local.get('oauthAccountSummaries')) as {
        oauthAccountSummaries?: OAuthAccountSummary[];
      };
      const match = oauthAccountSummaries?.find(
        (s) => s.provider === 'google_drive' && s.accountEmail === activeEmail,
      );
      if (match) return match.accountId;
    }

    /* 
    // Commented out per user request: falling back to ListAccounts is expensive
    const accountIndex = parseInt(
      window.location.search.match(/[?&]authuser=(\d+)/)?.[1] ??
      window.location.pathname.match(/\/u\/(\d+)\//)?.[1] ??
      document.querySelector('meta[itemprop="embedURL"]')
        ?.getAttribute('content')?.match(/\/u\/(\d+)\//)?.[1] ??
      '0',
      10,
    );

    try {
      const res = await fetch(
        'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&json=standard',
        { credentials: 'include' },
      );
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/postMessage\('([\s\S]+?)',\s*'https:\/\//);
        if (match) {
          const jsonStr = match[1]!.replace(
            /\\x([0-9a-fA-F]{2})/gi,
            (_, h: string) => String.fromCharCode(parseInt(h, 16)),
          );
          const data = JSON.parse(jsonStr) as [string, Array<unknown[]>];
          const account = data[1]?.[accountIndex] as unknown[] | undefined;
          const gaiaId = typeof account?.[10] === 'string' ? account[10] : null;
          if (gaiaId) return gaiaId;
        }
      }
    } catch { }
    */

    // Fallback: scrape Drive's inline script tags for Gaia ID
    const blob = [...document.scripts].map((s) => s.textContent ?? '').join('\n');
    const truncated = blob.length > 6_000_000 ? blob.slice(0, 6_000_000) : blob;
    const m =
      truncated.match(/"user_id"\s*:\s*"(\d{6,})"/) ??
      truncated.match(/"oauth2_user_id"\s*:\s*"(\d+)"/);
    return m?.[1];
  }

  // ── Notion ──────────────────────────────────────────────────────────────────
  if (platform === 'notion') {
    // Primary: call syncRecordValues with the current page's block ID (from URL).
    // Every Notion block carries a `spaceId` field that is hardcoded to the workspace
    // the page was created in — this is accurate even for multi-workspace users.
    const pageId = extractFileId();
    if (pageId) {
      try {
        const res = await fetch('https://www.notion.so/api/v3/syncRecordValues', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ pointer: { table: 'block', id: pageId }, version: -1 }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as {
            recordMap?: {
              block?: Record<string, {
                spaceId?: string;
                value?: { role?: string }
              }>
            }
          };
          const spaceId = data.recordMap?.block?.[pageId]?.spaceId;
          console.log(LOG_PREFIX, 'Notion spaceId', spaceId);
          if (spaceId) return spaceId;
        }
      } catch {
        // network error or API changed — fall through
      }
    }

    // Fallback: localStorage cache written during OAuth (no pageId or API failed)
    try {
      const cached = localStorage.getItem('notion_workspace_id');
      if (cached) return cached;
    } catch {
      // ignore
    }
  }

  return undefined;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

function sendMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response ?? { type: 'OK' });
      }
    });
  });
}

/**
 * Send a CONTEXT_DETECTED message with a specific fileId (for DOM-detected previews).
 * Does NOT run the suggestion overlay check — that stays in init().
 */
async function reportFilePreview(platform: Platform, fileId: string): Promise<void> {
  const accountId = await detectPlatformAccountId(platform);
  console.log(LOG_PREFIX, 'Drive preview detected via DOM', { fileId, url: window.location.href });
  await sendMessage({
    type: 'CONTEXT_DETECTED',
    platform,
    url: window.location.href,
    fileId,
    accountId,
    contextType: 'file',
  }).catch((err) => console.debug(LOG_PREFIX, 'reportFilePreview failed', err));
}

/**
 * Watch for Drive list/grid item clicks where the URL does NOT change.
 * Drive file items carry a `data-id` attribute; we use that as the fileId.
 * A 300 ms grace period lets the URL update first — if it does, we skip
 * (MutationObserver in the main loop will re-run init() with the correct URL).
 */
function setupDrivePreviewWatcher(platform: Platform): void {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener('click', (e) => {
    const fileEl = (e.target as Element).closest('[data-id]');
    if (!fileEl) return;
    const domFileId = fileEl.getAttribute('data-id');
    if (!domFileId) return;

    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const urlFileId = extractFileId();
      // If the URL already reflects a file/folder, the MutationObserver handles it
      if (urlFileId && urlFileId !== 'root') return;
      void reportFilePreview(platform, domFileId);
    }, 300);
  }, true /* capture phase */);
}

// ─── Overlay rendering ────────────────────────────────────────────────────────

function buildOverlay(suggestion: Suggestion): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'DriveSense suggestion');

  // Theme colors (simplified for inline)
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const colors = {
    bg: isDark ? '#221F1B' : '#F7F5F2',
    text: isDark ? '#EDE9E3' : '#1C1A17',
    secondary: isDark ? '#8C8278' : '#6B6560',
    accent: isDark ? '#7BA394' : '#5C7A6E',
    border: isDark ? '#2E2B26' : '#DDD9D3',
  };

  overlay.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    width: 340px;
    background: ${colors.bg};
    border: 1px solid ${colors.border};
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    color: ${colors.text};
    padding: 20px;
    animation: ds-fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  if (!document.getElementById('drivesense-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'drivesense-styles';
    styleTag.textContent = `
      @keyframes ds-fade-in {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      #${OVERLAY_ID} button { cursor: pointer; border: none; background: none; font-family: inherit; font-size: 14px; transition: opacity 0.2s; }
      #${OVERLAY_ID} .ds-btn-primary { color: ${colors.accent}; font-weight: 600; border-bottom: 1px solid ${colors.accent}; padding: 2px 0; }
      #${OVERLAY_ID} .ds-btn-ghost { color: ${colors.secondary}; padding: 2px 0; }
    `;
    document.head.appendChild(styleTag);
  }

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

  overlay.innerHTML = `
    <div style="display:flex; gap:12px; align-items:flex-start; margin-bottom:16px;">
      <div style="font-size:20px; color:${colors.accent}; line-height:1;">${icons[suggestion.action] ?? "✨"}</div>
      <div style="flex:1;">
        <p style="margin:0 0 4px; font-family:'Fraunces', serif; font-size:18px; font-weight:400; color:${colors.text}; line-height:1.2;">${escapeHtml(suggestion.title)}</p>
        <p style="margin:0; font-size:14px; color:${colors.secondary}; line-height:1.5;">${escapeHtml(suggestion.reason || suggestion.description)}</p>
      </div>
      <button id="ds-close" style="color:${colors.secondary}; font-size:20px; line-height:1; padding:0; opacity:0.5;">×</button>
    </div>
    <div style="display:flex; gap:16px; align-items:center;">
      <button id="ds-confirm" class="ds-btn-primary">${actionLabels[suggestion.action] || "Accept?"}</button>
      <button id="ds-skip" class="ds-btn-ghost">Not now</button>
    </div>
  `;

  return overlay;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

async function showSuggestion(suggestion: Suggestion): Promise<void> {
  removeOverlay(); // remove any stale one
  const overlay = buildOverlay(suggestion);
  document.body.appendChild(overlay);

  // Track that we've shown this suggestion
  await chrome.storage.local.set({ lastShownSuggestionId: suggestion.id });

  overlay.querySelector('#ds-close')?.addEventListener('click', () => removeOverlay());

  overlay.querySelector('#ds-confirm')?.addEventListener('click', async () => {
    removeOverlay();
    await sendMessage({ type: 'DISMISS_SUGGESTION', id: suggestion.id }).catch(console.error);
  });

  overlay.querySelector('#ds-skip')?.addEventListener('click', () => {
    removeOverlay();
  });
}

async function maybeShowNextSuggestionFromStorage(): Promise<void> {
  const { pendingSuggestions, lastShownSuggestionId } =
    await chrome.storage.local.get(['pendingSuggestions', 'lastShownSuggestionId']) as {
      pendingSuggestions?: Suggestion[];
      lastShownSuggestionId?: string | null;
    };

  const suggestions = (pendingSuggestions ?? []).filter((s) => s.status === 'pending');
  const next = suggestions.find((s) => s.id !== lastShownSuggestionId);
  if (next) {
    await showSuggestion(next);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const platform = detectPlatform();
  if (!platform) return;

  const fileId = extractFileId();
  const contextType = extractContextType();
  console.log(LOG_PREFIX, `detected ${platform} context`, { fileId, contextType, url: window.location.href });

  // Tell background worker about the current context
  const accountId = await detectPlatformAccountId(platform);
  try {
    await sendMessage({
      type: 'CONTEXT_DETECTED',
      platform,
      url: window.location.href,
      fileId,
      accountId,
      contextType,
    });
  } catch (error) {
    console.log(LOG_PREFIX, 'background not available yet', error);
    return;
  }

  // Check if there's a suggestion to surface
  await maybeShowNextSuggestionFromStorage();
}

// Guard: only run once even if script is injected multiple times
if (!(window as unknown as Record<string, unknown>)['__driveSenseInjected']) {
  (window as unknown as Record<string, unknown>)['__driveSenseInjected'] = true;
  void init();

  // React to background cache updates so pending suggestions can surface immediately.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes.pendingSuggestions && !changes.lastShownSuggestionId) return;
    void maybeShowNextSuggestionFromStorage();
  });

  // Watch for SPA navigations
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log(LOG_PREFIX, 'SPA navigation detected, updating context', lastUrl);
      void init();
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Drive list/grid view: watch for file preview opens where URL doesn't change
  const platform = detectPlatform();
  if (platform === 'google_drive' && window.location.hostname === 'drive.google.com') {
    setupDrivePreviewWatcher(platform);
  }
}
