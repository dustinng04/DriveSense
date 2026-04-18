/**
 * DriveSense extension popup script.
 *
 * Handles:
 *  - Displaying pending suggestion count from chrome.storage.local
 *  - BYOK key management (stored only in chrome.storage.local)
 *  - Connectivity check against Node API (base URL from build config)
 *  - Opening the web dashboard
 */
import { DASHBOARD_URL } from '../shared/buildConfig.js';
import {
  getAuthToken,
  getByokKey,
  getPendingSuggestions,
  setByokKey,
  storageGet,
} from '../shared/storage.js';
import {
  fetchSessionMe,
  isContextLinked,
  ping,
  resolveAccountIdForPlatform,
  startGoogleOauth,
  startNotionOauth,
} from '../shared/api.js';

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T | null;
  if (!element) throw new Error(`Element #${id} not found`);
  return element;
}

function setFooterStatus(message: string, type: 'default' | 'success' | 'error' = 'default'): void {
  const footer = el('footerStatus');
  footer.textContent = message;
  footer.className = type === 'success' ? 'success' : type === 'error' ? 'error' : '';
}

// ─── Connectivity & Status ───────────────────────────────────────────────────

async function refreshStatus(): Promise<void> {
  const dot = el('statusDot');
  const text = el('statusText');
  const countEl = el('suggestionCount');
  const contextPill = el('contextIndicator');

  const loggedInView = el('loggedInView');
  const loggedOutView = el('loggedOutView');
  const unlinkedWarning = el('unlinkedWarning');
  const contextAction = el('contextAction');

  dot.className = 'status-dot';
  text.textContent = 'Still looking…';

  const [reachable, suggestions, hasToken, { activeContext }] = await Promise.all([
    ping(),
    getPendingSuggestions(),
    getAuthToken().then((t) => Boolean(t?.trim())),
    storageGet('activeContext'),
  ]);

  const count = suggestions.length;
  countEl.textContent = String(count);

  // Update context UI
  if (activeContext) {
    contextPill.textContent = activeContext.platform === 'google_drive' ? 'Drive' : 'Notion';
    if (activeContext.accountId) {
      const id = activeContext.accountId;
      const short = id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
      text.textContent = `Watching: ${short}`;
    }
  } else {
    contextPill.textContent = 'Global';
  }

  if (!hasToken) {
    loggedInView.classList.add('hidden');
    loggedOutView.classList.remove('hidden');

    // Set dynamic buttons based on context
    const platform = activeContext?.platform;
    if (platform === 'google_drive') {
      contextAction.innerHTML = `<button class="btn-primary" id="connectGoogle">Sign in with Google Drive</button>`;
    } else if (platform === 'notion') {
      contextAction.innerHTML = `<button class="btn-primary" id="connectNotion">Sign in with Notion</button>`;
    } else {
      contextAction.innerHTML = `
        <button class="btn-primary" id="connectGoogle" style="margin-bottom: 8px;">Sign in with Google Drive</button>
        <button class="btn-primary" id="connectNotion">Sign in with Notion</button>
      `;
    }

    const googleBtn = document.getElementById('connectGoogle');
    const notionBtn = document.getElementById('connectNotion');

    if (googleBtn) {
      googleBtn.onclick = () => {
        import('../shared/buildConfig.js').then(({ API_URL }) => {
          void chrome.tabs.create({ url: `${API_URL}/oauth/google-drive/login/start` });
        });
      };
    }
    if (notionBtn) {
      notionBtn.onclick = () => {
        import('../shared/buildConfig.js').then(({ API_URL }) => {
          void chrome.tabs.create({ url: `${API_URL}/oauth/notion/login/start` });
        });
      };
    }

    dot.className = 'status-dot';
    return;
  }

  loggedInView.classList.remove('hidden');
  loggedOutView.classList.add('hidden');

  if (!reachable) {
    dot.className = 'status-dot';
    text.textContent = "Can't reach DriveSense API";
    return;
  }

  // Identity / linkage (oauth rows from GET /session/me — cached for API headers)
  if (activeContext?.platform) {
    try {
      const session = await (sessionPromise ?? fetchSessionMe());
      sessionPromise = Promise.resolve(session);

      const oauthAccounts = session.oauthAccounts;
      const linked = isContextLinked(activeContext.platform, oauthAccounts, {
        accountId: activeContext.accountId,
      });

      if (!linked) {
        unlinkedWarning.classList.remove('hidden');
        const resolved = resolveAccountIdForPlatform(
          activeContext.platform,
          oauthAccounts,
          activeContext.accountId,
        );
        el('unlinkedText').textContent = resolved
          ? `Account ${resolved.length > 14 ? `${resolved.slice(0, 8)}…` : resolved} is not linked to DriveSense.`
          : `Link this ${activeContext.platform === 'google_drive' ? 'Google' : 'Notion'} account in DriveSense.`;
        dot.className = 'status-dot pending';

        el('linkCurrentAccount').onclick = async () => {
          try {
            const url =
              activeContext.platform === 'google_drive'
                ? await startGoogleOauth()
                : await startNotionOauth();
            void chrome.tabs.create({ url });
          } catch (err) {
            console.error('OAuth start failed', err);
            setFooterStatus('Failed to start linking', 'error');
          }
        };
      } else {
        unlinkedWarning.classList.add('hidden');
      }
    } catch (err) {
      console.warn('Identity check failed', err);
    }
  }

  if (count > 0) {
    dot.className = 'status-dot pending';
    if (!activeContext?.accountId) {
      text.textContent = `${count} items waiting for review`;
    }
  } else {
    dot.className = 'status-dot watching';
    if (!activeContext?.accountId) {
      text.textContent = 'Watching items';
    }
  }
}

/** Cached session fetch for one popup session */
let sessionPromise: Promise<Awaited<ReturnType<typeof fetchSessionMe>>> | null = null;

// ─── Initialise form values from storage ─────────────────────────────────────

async function populateByokFields(): Promise<void> {
  const [gemini, openai, anthropic, glm] = await Promise.all([
    getByokKey('gemini'),
    getByokKey('openai'),
    getByokKey('anthropic'),
    getByokKey('glm'),
  ]);

  (el('keyGemini') as HTMLInputElement).value = gemini;
  (el('keyOpenai') as HTMLInputElement).value = openai;
  (el('keyAnthropic') as HTMLInputElement).value = anthropic;
  (el('keyGlm') as HTMLInputElement).value = glm;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

el('saveKeys').addEventListener('click', async () => {
  try {
    await Promise.all([
      setByokKey('gemini', (el('keyGemini') as HTMLInputElement).value),
      setByokKey('openai', (el('keyOpenai') as HTMLInputElement).value),
      setByokKey('anthropic', (el('keyAnthropic') as HTMLInputElement).value),
      setByokKey('glm', (el('keyGlm') as HTMLInputElement).value),
    ]);
    setFooterStatus('Keys saved locally — never sent to server', 'success');
  } catch (error) {
    setFooterStatus(error instanceof Error ? error.message : 'Failed to save keys', 'error');
  }
});

el('refreshBtn').addEventListener('click', () => {
  sessionPromise = null;
  setFooterStatus('Still looking…');
  void refreshStatus().then(() => {
    setFooterStatus('Refreshed', 'success');
  });
});

el('openDashboard').addEventListener('click', () => {
  void chrome.tabs.create({ url: DASHBOARD_URL });
});

el('openDashboardFull').onclick = () => {
  void chrome.tabs.create({ url: DASHBOARD_URL });
};

// BYOK collapsible toggle
el('byokToggle').addEventListener('click', () => {
  const section = el('byokSection');
  const arrow = el('byokArrow');
  const isOpen = section.classList.toggle('open');
  arrow.textContent = isOpen ? '▼' : '▶';
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

function initialize(): void {
  void Promise.all([populateByokFields(), refreshStatus()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
