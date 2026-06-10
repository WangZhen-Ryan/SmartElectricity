type RuntimeHealthItem = {
  label: string;
  ok: boolean;
  detail: string;
};

type RuntimeHealth = {
  items: RuntimeHealthItem[];
  score: number;
  onlineNow: number;
  topRegion: string;
  usersTracked: number;
};

type TopRegion = {
  region: string;
  online_now: number | null;
} | null;

type AdminProps = {
  currentPath: string;
  runtimeHealth: RuntimeHealth;
  publicRegionCount: number;
  communityStatus: string;
  communityLeaderboardCount: number;
  onOpenPublicApp: () => void;
  onOpenOps: () => void;
};

export function AdminConsoleView({
  currentPath,
  runtimeHealth,
  publicRegionCount,
  communityStatus,
  communityLeaderboardCount,
  onOpenPublicApp,
  onOpenOps,
}: AdminProps) {
  return (
    <div className="page admin-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Admin Access</p>
          <h1>
            Platform control plane. <span>Keep this route behind Cloudflare Access.</span>
          </h1>
          <p className="subhead">
            Public users authenticate with Supabase Auth on the main app. This route is reserved
            for platform policy, moderation, and operator oversight.
          </p>
        </div>
        <div className="status-card">
          <p className="mono">Route</p>
          <p>{currentPath}</p>
          <div className="stats">
            <div>
              <span>Online Now</span>
              <strong>{runtimeHealth.onlineNow}</strong>
            </div>
            <div>
              <span>Top Region</span>
              <strong>{runtimeHealth.topRegion}</strong>
            </div>
            <div>
              <span>Runtime Health</span>
              <strong>{runtimeHealth.score}%</strong>
            </div>
            <div>
              <span>Tracked Users</span>
              <strong>{runtimeHealth.usersTracked}</strong>
            </div>
          </div>
        </div>
      </header>
      <section className="panel admin-ops-panel">
        <div className="panel-header">
          <h2>Admin Console</h2>
          <p className="hint">Platform health, moderation posture, and public growth summary.</p>
        </div>
        <div className="admin-grid">
          <div className="summary-card admin-kpi-card">
            <span className="mono">Identity Split</span>
            <strong>Cloudflare + Supabase</strong>
            <span className="hint">Cloudflare guards admin; Supabase handles public user auth and saved configs.</span>
          </div>
          <div className="summary-card admin-kpi-card">
            <span className="mono">Public Flow</span>
            <strong>{publicRegionCount ? "Live landing" : "Cold start"}</strong>
            <span className="hint">{communityStatus}</span>
          </div>
          <div className="summary-card admin-kpi-card">
            <span className="mono">Leaderboard</span>
            <strong>{communityLeaderboardCount ? "Publishing" : "Empty"}</strong>
            <span className="hint">Public ranks, region scores, and welcome preview cards are live.</span>
          </div>
        </div>
        <div className="admin-runtime-grid">
          {runtimeHealth.items.map((item) => (
            <div key={item.label} className={`summary-card admin-runtime-card ${item.ok ? "good" : "warn"}`}>
              <span className="mono">{item.label}</span>
              <strong>{item.ok ? "Healthy" : "Needs attention"}</strong>
              <span className="hint">{item.detail}</span>
            </div>
          ))}
        </div>
        <div className="admin-support-grid">
          <div className="summary-card admin-support-card">
            <span className="mono">Admin Actions</span>
            <strong>Operator Shortcuts</strong>
            <div className="hero-actions">
              <button className="ghost small" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                Top of page
              </button>
              <button className="ghost small" onClick={onOpenPublicApp}>
                Open public app
              </button>
              <button className="ghost small" onClick={onOpenOps}>
                Ops route
              </button>
            </div>
          </div>
          <div className="summary-card admin-support-card">
            <span className="mono">Moderation Queue</span>
            <strong>{communityLeaderboardCount ? `${communityLeaderboardCount} ranked users` : "No public entries yet"}</strong>
            <span className="hint">Use this panel for abuse flags, payout review, featured traders, and public card curation.</span>
          </div>
        </div>
      </section>
    </div>
  );
}

type OpsProps = {
  currentPath: string;
  runtimeHealth: RuntimeHealth;
  communityOnlineNow: number;
  communityLeaderboardCount: number;
  publicRegionCount: number;
  communityTopRegion: TopRegion;
  topRegionShort: string;
  onOpenPublicApp: () => void;
  onOpenAdmin: () => void;
};

export function OpsRuntimeView({
  currentPath,
  runtimeHealth,
  communityOnlineNow,
  communityLeaderboardCount,
  publicRegionCount,
  communityTopRegion,
  topRegionShort,
  onOpenPublicApp,
  onOpenAdmin,
}: OpsProps) {
  return (
    <div className="page admin-shell ops-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Ops Runtime</p>
          <h1>
            Runtime watchdog. <span>Use this route for health checks and support triage.</span>
          </h1>
          <p className="subhead">
            Focus on live functions, presence throughput, leaderboard freshness, and user-facing
            support tools. Keep this route behind Cloudflare Access.
          </p>
        </div>
        <div className="status-card">
          <p className="mono">Route</p>
          <p>{currentPath}</p>
          <div className="stats">
            <div>
              <span>Presence</span>
              <strong>{communityOnlineNow}</strong>
            </div>
            <div>
              <span>Public Scores</span>
              <strong>{communityLeaderboardCount}</strong>
            </div>
            <div>
              <span>Regions</span>
              <strong>{publicRegionCount}</strong>
            </div>
            <div>
              <span>Health</span>
              <strong>{runtimeHealth.score}%</strong>
            </div>
          </div>
        </div>
      </header>
      <section className="panel admin-ops-panel">
        <div className="panel-header">
          <h2>Runtime Panel</h2>
          <p className="hint">Live service status, response posture, and operational shortcuts.</p>
        </div>
        <div className="admin-runtime-grid">
          {runtimeHealth.items.map((item) => (
            <div key={item.label} className={`summary-card admin-runtime-card ${item.ok ? "good" : "warn"}`}>
              <span className="mono">{item.label}</span>
              <strong>{item.ok ? "Healthy" : "Needs attention"}</strong>
              <span className="hint">{item.detail}</span>
            </div>
          ))}
        </div>
        <div className="admin-support-grid">
          <div className="summary-card admin-support-card">
            <span className="mono">Support Runbook</span>
            <strong>Fast Triage</strong>
            <span className="hint">Check functions URL, presence heartbeat, and public leaderboard write path before debugging clients.</span>
            <div className="hero-actions">
              <button className="ghost small" onClick={onOpenPublicApp}>
                Public app
              </button>
              <button className="ghost small" onClick={onOpenAdmin}>
                Admin route
              </button>
            </div>
          </div>
          <div className="summary-card admin-support-card">
            <span className="mono">Freshness</span>
            <strong>{communityTopRegion ? `${topRegionShort} hottest` : "Awaiting presence"}</strong>
            <span className="hint">
              {communityTopRegion
                ? `${Number(communityTopRegion.online_now || 0)} users online in the busiest cluster.`
                : "No presence heartbeats have landed yet."}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
