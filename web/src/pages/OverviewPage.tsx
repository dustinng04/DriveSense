import { PageHeader } from "../components/PageHeader";
import type { Platform, ProviderOverviewState } from "../types";

interface Props {
  loading: boolean;
  signedIn: boolean;
  providers: ProviderOverviewState[];
  pendingSuggestions: number;
  blacklistCount: number;
  keywordCount: number;
  undoCount: number;
  onRefresh: () => void;
  onConnect: (provider: Platform) => void;
  onDisconnect: (provider: Platform, accountId: string) => Promise<void>;
}

export function OverviewPage({
  loading,
  signedIn,
  providers,
  pendingSuggestions,
  blacklistCount,
  keywordCount,
  undoCount,
  onRefresh,
  onConnect,
  onDisconnect,
}: Props) {
  return (
    <>
      <PageHeader
        title="Overview"
        description="DriveSense watches quietly, explains every suggestion, and never acts without confirmation."
        action={
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading || !signedIn}>
            Refresh
          </button>
        }
      />

      {!signedIn ? (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Dashboard Sign-In</div>
              <div className="card-desc">Use an OAuth login to start a real dashboard session. No manual token entry is needed anymore.</div>
            </div>
          </div>
          <div className="overview-actions">
            <button type="button" className="btn btn-primary" onClick={() => onConnect("google_drive")}>
              Sign in with Google Drive
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onConnect("notion")}>
              Sign in with Notion
            </button>
          </div>
          <p className="helper-copy">Google Drive is the safest entry point because Notion login may depend on an existing Drive connection.</p>
        </div>
      ) : (
        <>
          <div className="overview-grid">
            <div className="overview-stat">
              <span className="overview-stat-label">Pending suggestions</span>
              <strong>{pendingSuggestions}</strong>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-label">Blacklisted folders</span>
              <strong>{blacklistCount}</strong>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-label">Keyword guards</span>
              <strong>{keywordCount}</strong>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-label">Undo entries</span>
              <strong>{undoCount}</strong>
            </div>
          </div>

          <div className="provider-grid">
            {providers.map((providerState) => (
              <section key={providerState.provider} className="card provider-card">
                <div className="card-header provider-card-header">
                  <div>
                    <div className="card-title">{providerState.label}</div>
                    <div className="card-desc">
                      {providerState.connected
                        ? `${providerState.accounts.length} linked account${providerState.accounts.length === 1 ? "" : "s"}`
                        : "Not linked yet"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onConnect(providerState.provider)}
                  >
                    {providerState.connected ? "Add account" : `Connect ${providerState.label}`}
                  </button>
                </div>

                {providerState.accounts.length === 0 ? (
                  <p className="helper-copy">No linked accounts yet.</p>
                ) : (
                  <div className="item-list compact-list">
                    {providerState.accounts.map((account) => (
                      <div key={`${providerState.provider}:${account.accountId}`} className="platform-account">
                        <div className="platform-copy">
                          <div className="platform-title-row">
                            <strong>{account.accountEmail || account.accountId}</strong>
                            {account.isPrimary ? <span className="pill">Primary</span> : null}
                          </div>
                          {account.accountEmail ? <div className="platform-meta">{account.accountId}</div> : null}
                        </div>
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          onClick={() => onDisconnect(providerState.provider, account.accountId)}
                          disabled={loading}
                        >
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Privacy Boundary</div>
            <div className="card-desc">DriveSense suggests and explains. It never moves, archives, or deletes anything automatically.</div>
          </div>
        </div>
        <div className="privacy-note">
          <p>BYOK keys stay in browser local storage.</p>
          <p>Undo history is retained so every confirmed action can be reversed.</p>
          <p>Folder blacklists override scanning decisions immediately.</p>
        </div>
      </div>
    </>
  );
}
