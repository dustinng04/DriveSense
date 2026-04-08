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
import type { BackgroundMessage, BackgroundResponse, Platform, Suggestion } from '../shared/types.js';

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
  // Google Drive file: /file/d/{id}/...
  const driveMatch = window.location.pathname.match(/\/file\/d\/([^/]+)/);
  if (driveMatch) return driveMatch[1];

  // Google Drive folder: /drive/folders/{id}
  const folderMatch = window.location.pathname.match(/\/folders\/([^/]+)/);
  if (folderMatch) return folderMatch[1];

  // Notion page: notion.so/{workspace}/{id} or notion.so/{id}
  const notionMatch = window.location.pathname.match(/\/([a-f0-9]{32})/i);
  if (notionMatch) return notionMatch[1];

  return undefined;
}

function detectAccountIdentity(platform: Platform): string | undefined {
  if (platform === 'google_drive') {
    // 1. Try the Account button aria-label (Common pattern: "Google Account: Name (email@gmail.com)")
    const accountBtn = document.querySelector('a[href*="accounts.google.com/SignOutOptions"]');
    if (accountBtn) {
      const label = accountBtn.getAttribute('aria-label') || '';
      const emailMatch = label.match(/\(([^)]+)\)/);
      if (emailMatch) return emailMatch[1];
    }

    // 2. Try the "og:email" or similar if present (unlikely in Drive but good fallback)
    const metaEmail = document.querySelector('meta[name="email"]')?.getAttribute('content');
    if (metaEmail) return metaEmail;

    // 3. Try searching for @gmail.com or @ in specific user UI elements
    const userEmailEl = document.querySelector('.gb_de'); // Common class for user email in Google header
    if (userEmailEl?.textContent?.includes('@')) return userEmailEl.textContent.trim();
  }

  if (platform === 'notion') {
    // Notion stores some state in __INITIAL_STATE__ or we can peek at the sidebar if it's open
    // For now, we'll try to find an email-like string in the sidebar/account-switcher
    const sidebarAccount = document.querySelector('.notion-sidebar-user-menu');
    if (sidebarAccount?.textContent?.includes('@')) {
      const match = sidebarAccount.textContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (match) return match[0];
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const platform = detectPlatform();
  if (!platform) return;

  const fileId = extractFileId();
  console.debug(LOG_PREFIX, `detected ${platform} context`, { fileId, url: window.location.href });

  // Tell background worker about the current context
  const accountEmail = detectAccountIdentity(platform);
  try {
    await sendMessage({
      type: 'CONTEXT_DETECTED',
      platform,
      url: window.location.href,
      fileId,
      accountEmail,
    });
  } catch (error) {
    console.debug(LOG_PREFIX, 'background not available yet', error);
    return;
  }

  // Check if there's a suggestion to surface
  const { pendingSuggestions, lastShownSuggestionId } =
    await chrome.storage.local.get(['pendingSuggestions', 'lastShownSuggestionId']) as {
      pendingSuggestions?: Suggestion[];
      lastShownSuggestionId?: string | null;
    };

  const suggestions = pendingSuggestions ?? [];
  const next = suggestions.find((s) => s.id !== lastShownSuggestionId);

  if (next) {
    // Only show one card at a time — lightweight, non-intrusive
    await showSuggestion(next);
  }
}

// Guard: only run once even if script is injected multiple times
if (!(window as unknown as Record<string, unknown>)['__driveSenseInjected']) {
  (window as unknown as Record<string, unknown>)['__driveSenseInjected'] = true;
  void init();
}
