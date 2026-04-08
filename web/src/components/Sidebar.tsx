interface Props {
  activeTab: string;
  pendingCount: number;
  onNavigate: (tab: string) => void;
  connected: boolean;
  loading: boolean;
}

const NAV_ITEMS = [
  { id: 'suggestions', label: 'Suggestions', icon: '💡' },
  { id: 'rules',       label: 'Rules',       icon: '🛡️' },
  { id: 'history',     label: 'Undo History', icon: '↩️' },
  { id: 'settings',   label: 'Settings',    icon: '⚙️' },
] as const;

export function Sidebar({ activeTab, pendingCount, onNavigate, connected, loading }: Props) {
  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="brand-logo" aria-hidden="true">🧹</div>
        <div>
          <div className="brand-name">DriveSense</div>
          <div className="brand-version">v0.1.0 — Dashboard</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-section-label">Workspace</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            id={`nav-${item.id}`}
            type="button"
            className={`nav-item${activeTab === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            {item.label}
            {item.id === 'suggestions' && pendingCount > 0 && (
              <span className="nav-badge" aria-label={`${pendingCount} pending`}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Connection status */}
      <div className="sidebar-footer">
        <div className={`connection-dot${connected ? ' connected' : loading ? '' : ' error'}`} />
        <span className="connection-label">
          {loading ? 'Connecting…' : connected ? 'API Connected' : 'API Offline'}
        </span>
      </div>
    </aside>
  );
}
