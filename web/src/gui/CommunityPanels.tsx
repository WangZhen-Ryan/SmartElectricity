import { PRIVACY_BOUNDARY_COPY } from "../core/privacy";
import AnimatedSection from "./AnimatedSection";
import AnimatedSwitch from "./AnimatedSwitch";
import StaggerGroup from "./StaggerGroup";

export type BatteryBrandCard = {
  name: string;
  mode: string;
  detail: string;
  tone: string;
};

export type WelcomeStats = {
  activeUsersNow: number;
  publicMode: string;
  topRegion: string;
  topRegionUsers: number;
  trustLabel: string;
};

export type RegionMapShape = {
  short: string;
  d: string;
  labelX: number;
  labelY: number;
};

export type RegionMapData = {
  code: string;
  label: string;
  postcodeRange: string;
  tone: string;
  users: number;
};

export type RegionInsight = {
  code: string;
  label: string;
  postcodeRange: string;
  users: number;
  pulse: string;
  totalProfitAud: number;
  avgProfitAud: number | null;
};

export type WelcomePreviewRow = {
  id?: string;
  user_id: string;
  day?: string;
  label?: string;
  region: string;
  profit_aud: number;
  capabilityScore?: number;
};

export type RegionBucket = {
  code: string;
  short: string;
  label: string;
  postcodeRange: string;
};

export type PublicRegionActivityRow = {
  region: string;
  online_now: number | null;
  latest_seen_at: string | null;
};

export type CommunityLeaderboardRow = {
  id: string;
  rank: number;
  label: string;
  region: string;
  profit_aud: number;
  capabilityScore: number;
  marketAlpha: number;
  stability: number;
  execution: number;
};

type PropsWelcome = {
  authSession: { user?: { email?: string } } | null;
  homeWelcomeStats: WelcomeStats;
  supportedBatteryBrands: BatteryBrandCard[];
  shapes: RegionMapShape[];
  welcomeRegionMapByCode: Map<string, RegionMapData>;
  welcomeRegionInsightsByCode: Map<string, RegionInsight>;
  welcomeMapHoverRegion: string | null;
  welcomeMapSelectedRegion: string | null;
  welcomeLeaderboardPreview: WelcomePreviewRow[];
  onHoverRegion: (value: string | null) => void;
  onSelectRegion: (value: string | null) => void;
  onOpenAccount: () => void;
  onOpenBacktest: () => void;
  onOpenMonitor: () => void;
  onOpenLeaderboardForRegion: (shortCode: string) => void;
  formatProfit: (value: number) => string;
  getRegionBucketMeta: (regionCode: string) => RegionBucket;
};

export function WelcomeLandingPanel({
  authSession,
  homeWelcomeStats,
  supportedBatteryBrands,
  shapes,
  welcomeRegionMapByCode,
  welcomeRegionInsightsByCode,
  welcomeMapHoverRegion,
  welcomeMapSelectedRegion,
  welcomeLeaderboardPreview,
  onHoverRegion,
  onSelectRegion,
  onOpenAccount,
  onOpenBacktest,
  onOpenMonitor,
  onOpenLeaderboardForRegion,
  formatProfit,
  getRegionBucketMeta,
}: PropsWelcome) {
  const isCompact =
    typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
  const hoverRegionInsight = welcomeMapHoverRegion
    ? welcomeRegionInsightsByCode.get(welcomeMapHoverRegion) || null
    : null;
  const selectedRegionInsight = welcomeMapSelectedRegion
    ? welcomeRegionInsightsByCode.get(welcomeMapSelectedRegion) || null
    : null;
  const activeRegionCode = isCompact
    ? welcomeMapSelectedRegion
    : welcomeMapHoverRegion || welcomeMapSelectedRegion;
  const activeRegionInsight = activeRegionCode
    ? welcomeRegionInsightsByCode.get(activeRegionCode) || null
    : null;

  return (
    <AnimatedSection as="section" className="panel setup-welcome-panel" enter="rise">
      <div className="welcome-public-grid">
        <div className="welcome-copy-column">
          <div className="panel-header">
            <h2>Welcome Setup</h2>
            <p className="hint">Public landing for market pulse, regional heat, and setup unlock.</p>
          </div>
          <div className="welcome-copy-block">
            <p className="eyebrow">Public Landing</p>
            <h3>See where battery operators are active across Australia.</h3>
            <p className="subhead">
              Explore regional pulse, compare public leaderboard momentum, then sign in to save
              your own setup and unlock private Backtest, Monitor, and Config tools.
            </p>
          </div>
          <StaggerGroup className="summary-grid">
            <div className="summary-card">
              <span className="mono">Active Now</span>
              <strong>{homeWelcomeStats.activeUsersNow}</strong>
              <span>{homeWelcomeStats.publicMode}</span>
            </div>
            <div className="summary-card">
              <span className="mono">Top Region</span>
              <strong>{homeWelcomeStats.topRegion}</strong>
              <span>{homeWelcomeStats.topRegionUsers} users live</span>
            </div>
            <div className="summary-card">
              <span className="mono">Forecast Posture</span>
              <strong>{homeWelcomeStats.trustLabel}</strong>
              <span>Weather + solar pipeline</span>
            </div>
          </StaggerGroup>
          <div className="welcome-cta-row">
            <button className="primary" onClick={onOpenAccount}>
              {authSession ? "Open Account Setup" : "Sign In To Setup"}
            </button>
            <button className="ghost" onClick={onOpenBacktest}>
              {authSession ? "Launch Backtest" : "Unlock Backtest"}
            </button>
            <button className="ghost" onClick={onOpenMonitor}>
              {authSession ? "Open Monitor" : "Unlock Monitor"}
            </button>
          </div>
          <StaggerGroup className="battery-brand-grid" delayStep={90}>
            {supportedBatteryBrands.map((brand) => (
              <div key={brand.name} className={`summary-card battery-brand-card ${brand.tone}`}>
                <span className="mono">{brand.name}</span>
                <strong>{brand.mode}</strong>
                <span>{brand.detail}</span>
              </div>
            ))}
          </StaggerGroup>
        </div>
        <AnimatedSection
          className={`welcome-map-shell${welcomeMapSelectedRegion ? " has-selection" : ""}`}
          enter="slide"
          delayIndex={1}
        >
          <div className="panel-header">
            <h2>Australia Activity Map</h2>
            <p className="hint">Real postcode-aligned market clusters, highlighted by live regional activity.</p>
          </div>
          <div className="summary-card public-boundary-card">
            <span className="mono">Public Data Boundary</span>
            <strong>Only public metrics are shown here.</strong>
            <span>
              {PRIVACY_BOUNDARY_COPY.public} Regions, public profit, capability score, and strategy
              label are visible.
            </span>
          </div>
          <div className="welcome-map-layout">
            <div className="au-svg-map-shell">
              <svg className="au-svg-map" viewBox="0 0 480 430" aria-label="Australia activity map">
                <path
                  className="au-svg-silhouette"
                  d="M52 152 L82 100 L142 76 L258 86 L374 96 L430 146 L424 274 L378 344 L330 354 L314 410 L258 394 L194 306 L134 314 L82 284 L54 226 Z"
                />
                {shapes.map((shape) => {
                  const region = welcomeRegionMapByCode.get(shape.short);
                  const tone = region?.tone || "cool";
                  const isTop = shape.short === homeWelcomeStats.topRegion;
                  const isHovered = welcomeMapHoverRegion === shape.short;
                  const isSelected = welcomeMapSelectedRegion === shape.short;
                  return (
                    <g
                      key={shape.short}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => onHoverRegion(shape.short)}
                      onMouseLeave={() => onHoverRegion(null)}
                      onClick={() => {
                        if (isCompact) {
                          onSelectRegion(isSelected ? null : shape.short);
                          return;
                        }
                        onOpenLeaderboardForRegion(shape.short);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (isCompact) {
                            onSelectRegion(isSelected ? null : shape.short);
                          } else {
                            onOpenLeaderboardForRegion(shape.short);
                          }
                        }
                      }}
                    >
                      <path
                        className={`au-map-region ${tone}${isTop ? " active" : ""}${isHovered ? " hovered" : ""}${isSelected ? " selected" : ""}`}
                        d={shape.d}
                      />
                      {isHovered || isSelected ? (
                        <path
                          className={`au-map-region-contour ${isSelected ? "selected" : "hovered"}`}
                          d={shape.d}
                        />
                      ) : null}
                      {isHovered || isSelected ? (
                        <>
                          <circle
                            cx={shape.labelX}
                            cy={shape.labelY - 6}
                            r={isSelected ? 22 : 16}
                            className={`au-map-pulse-ring ${isSelected ? "selected" : "hovered"}`}
                          />
                          <circle
                            cx={shape.labelX}
                            cy={shape.labelY - 6}
                            r="5"
                            className={`au-map-pulse-core ${isSelected ? "selected" : "hovered"}`}
                          />
                        </>
                      ) : null}
                      <text x={shape.labelX} y={shape.labelY} className="au-map-label">
                        {shape.short}
                      </text>
                      <text x={shape.labelX} y={shape.labelY + 20} className="au-map-subvalue">
                        {region?.users ?? 0}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <AnimatedSwitch
                switchKey={activeRegionInsight ? `${activeRegionInsight.code}-${welcomeMapSelectedRegion ? "selected" : "hover"}` : "none"}
                className="au-map-tooltip-switch"
                mode="slide"
              >
              {activeRegionInsight ? (
                <div className="au-map-tooltip motion-scene-card motion-hero-node hero-community">
                  {(() => {
                    const hoverMeta = getRegionBucketMeta(`AU-${activeRegionInsight.code}`);
                    return (
                      <>
                        <div className="au-map-tooltip-head">
                          <strong>{activeRegionInsight.code}</strong>
                          <span>{activeRegionInsight.label}</span>
                        </div>
                        <div className="au-map-tooltip-row">
                          <span>Online</span>
                          <strong>{activeRegionInsight.users}</strong>
                        </div>
                        <div className="au-map-tooltip-row">
                          <span>Regional profit</span>
                          <strong>{formatProfit(activeRegionInsight.totalProfitAud)}</strong>
                        </div>
                        <div className="au-map-tooltip-row">
                          <span>Avg / trader</span>
                          <strong>
                            {activeRegionInsight.avgProfitAud === null
                              ? "—"
                              : formatProfit(activeRegionInsight.avgProfitAud)}
                          </strong>
                        </div>
                        <div className="au-map-tooltip-row">
                          <span>Postcode</span>
                          <strong>
                            {activeRegionInsight.postcodeRange || hoverMeta.postcodeRange}
                          </strong>
                        </div>
                        <div className="au-map-tooltip-row">
                          <span>Pulse</span>
                          <strong>{activeRegionInsight.pulse}</strong>
                        </div>
                        <div className="au-map-tooltip-foot">
                          {welcomeMapSelectedRegion
                            ? "Selected on mobile. Use the CTA below to open the public leaderboard for this region."
                            : "Click to open leaderboard filtered to this region."}
                        </div>
                        {welcomeMapSelectedRegion ? (
                          <div className="hero-actions">
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => onOpenLeaderboardForRegion(activeRegionInsight.code)}
                            >
                              Open {activeRegionInsight.code} Leaderboard
                            </button>
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => onSelectRegion(null)}
                            >
                              Clear
                            </button>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}
              </AnimatedSwitch>
              <div className="au-map-inline-hint">
                {isCompact
                  ? "Tap a state to inspect it, then open the filtered leaderboard."
                  : "Hover for details, click a state to open the filtered leaderboard."}
              </div>
            </div>
            <StaggerGroup className="welcome-map-sidebar" delayStep={90}>
              <div className="summary-card">
                <span className="mono">Top Cluster</span>
                <strong>{homeWelcomeStats.topRegion}</strong>
                <span>{homeWelcomeStats.topRegionUsers} users live now</span>
              </div>
              <div className="summary-card">
                <span className="mono">Leaderboard Preview</span>
                <strong>{welcomeLeaderboardPreview.length ? "Public top 5" : "No public entries yet"}</strong>
                <div className="welcome-mini-leaderboard">
                  {welcomeLeaderboardPreview.length ? (
                    welcomeLeaderboardPreview.map((entry, index) => (
                      <div key={`${entry.user_id}-${entry.day || index}`} className="welcome-mini-row">
                        <span>#{index + 1}</span>
                        <strong>{entry.label || "Anonymous"}</strong>
                        <span>{getRegionBucketMeta(entry.region).short}</span>
                        <span>{formatProfit(entry.profit_aud)}</span>
                        <em>{entry.capabilityScore !== undefined ? `${Math.round(entry.capabilityScore)} score` : "Public metric"}</em>
                      </div>
                    ))
                  ) : (
                    <div className="welcome-mini-row empty">
                      <span>—</span>
                      <strong>Awaiting public scores</strong>
                      <span>AU</span>
                      <span>$0.00</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="summary-card">
                <span className="mono">Setup Path</span>
                <strong>{authSession ? "Private workspace unlocked" : "Sign in to save setup"}</strong>
                <span>
                  {authSession
                    ? "Open Config to save Amber, battery, and forecast settings."
                    : "Guest mode shows public market pulse only."}
                </span>
              </div>
              {selectedRegionInsight ? (
                <div className="summary-card welcome-selected-region-card motion-scene-card motion-hero-node hero-community">
                  <span className="mono">Selected Region</span>
                  <strong>
                    {selectedRegionInsight.code} · {selectedRegionInsight.label}
                  </strong>
                  <span>{selectedRegionInsight.postcodeRange}</span>
                  <div className="welcome-selected-metrics">
                    <div>
                      <span>Online</span>
                      <strong>{selectedRegionInsight.users}</strong>
                    </div>
                    <div>
                      <span>Regional profit</span>
                      <strong>{formatProfit(selectedRegionInsight.totalProfitAud)}</strong>
                    </div>
                    <div>
                      <span>Avg / trader</span>
                      <strong>
                        {selectedRegionInsight.avgProfitAud === null
                          ? "—"
                          : formatProfit(selectedRegionInsight.avgProfitAud)}
                      </strong>
                    </div>
                  </div>
                  <span className="hint">{selectedRegionInsight.pulse}</span>
                  <div className="hero-actions">
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => onOpenLeaderboardForRegion(selectedRegionInsight.code)}
                    >
                      Open {selectedRegionInsight.code} Leaderboard
                    </button>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => onSelectRegion(null)}
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              ) : null}
            </StaggerGroup>
          </div>
        </AnimatedSection>
      </div>
    </AnimatedSection>
  );
}

type PropsLeaderboard = {
  authSession: { user?: { email?: string } } | null;
  communityStatus: string;
  filteredCommunityOnlineNow: number;
  filteredCommunityTopRegion: { region: string; online_now: number | null } | null;
  filteredCommunityMyEntry: { rank: number; profit_aud: number } | null;
  leaderboardRegionFilter: string;
  leaderboardBucketFilter: string;
  filteredPublicRegionActivity: PublicRegionActivityRow[];
  filteredCommunityLeaderboard: CommunityLeaderboardRow[];
  communityRegionRanksByEntryId: Map<string, number>;
  regionBuckets: RegionBucket[];
  onLeaderboardRegionFilterChange: (value: string) => void;
  onLeaderboardBucketFilterChange: (value: string) => void;
  formatProfit: (value: number) => string;
  getRegionBucketMeta: (regionCode: string) => RegionBucket;
};

export function RegionalLeaderboardPanel({
  authSession,
  communityStatus,
  filteredCommunityOnlineNow,
  filteredCommunityTopRegion,
  filteredCommunityMyEntry,
  leaderboardRegionFilter,
  leaderboardBucketFilter,
  filteredPublicRegionActivity,
  filteredCommunityLeaderboard,
  communityRegionRanksByEntryId,
  regionBuckets,
  onLeaderboardRegionFilterChange,
  onLeaderboardBucketFilterChange,
  formatProfit,
  getRegionBucketMeta,
}: PropsLeaderboard) {
  return (
    <AnimatedSection as="section" className="panel leaderboard-panel" enter="rise">
      <div className="panel-header">
        <h2>Regional Leaderboard</h2>
        <p className="hint">Live public rankings by region, profit, and execution score.</p>
      </div>
      <StaggerGroup className="leaderboard-grid">
        <div className="leaderboard-kpi">
          <span className="mono">Online Now</span>
          <strong>{filteredCommunityOnlineNow}</strong>
          <span className="hint">{communityStatus}</span>
        </div>
        <div className="leaderboard-kpi">
          <span className="mono">Top Region</span>
          <strong>{getRegionBucketMeta(filteredCommunityTopRegion?.region || "AU-NSW").short}</strong>
          <span className="hint">
            {filteredCommunityTopRegion
              ? `${Number(filteredCommunityTopRegion.online_now || 0)} users active`
              : "Waiting for live presence"}
          </span>
        </div>
        <div className="leaderboard-kpi">
          <span className="mono">Your Rank</span>
          <strong>{filteredCommunityMyEntry ? `#${filteredCommunityMyEntry.rank}` : "—"}</strong>
          <span className="hint">
            {filteredCommunityMyEntry
              ? `${formatProfit(filteredCommunityMyEntry.profit_aud)} today`
              : authSession
                ? "No public score yet"
                : "Sign in to join"}
          </span>
        </div>
      </StaggerGroup>
      <div className="summary-card public-boundary-card">
        <span className="mono">Public Leaderboard Policy</span>
        <strong>Visible fields are intentionally limited.</strong>
        <span>
          {PRIVACY_BOUNDARY_COPY.public} This table shows public rank, region, strategy label,
          profit, and capability-style metrics only.
        </span>
      </div>
      <div className="summary-card leaderboard-filter-summary motion-hero-node hero-leaderboard">
        <span className="mono">Current Public View</span>
        <strong>
          {leaderboardRegionFilter === "ALL"
            ? "All regions"
            : `${getRegionBucketMeta(leaderboardRegionFilter).short} only`}
          {" · "}
          {leaderboardBucketFilter === "ALL"
            ? "All postcode buckets"
            : getRegionBucketMeta(leaderboardBucketFilter).postcodeRange}
        </strong>
        <span className="hint">
          Showing {filteredCommunityLeaderboard.length} public trader
          {filteredCommunityLeaderboard.length === 1 ? "" : "s"} and{" "}
          {filteredPublicRegionActivity.length} active regional heartbeat
          {filteredPublicRegionActivity.length === 1 ? "" : "s"}.
        </span>
        <div className="hero-actions">
          <button
            className="ghost small"
            type="button"
            onClick={() => {
              onLeaderboardRegionFilterChange("ALL");
              onLeaderboardBucketFilterChange("ALL");
            }}
          >
            Clear Public Filters
          </button>
        </div>
      </div>
      <div className="leaderboard-filter-bar">
        <div className="field">
          <label>Region Filter</label>
          <select
            value={leaderboardRegionFilter}
            onChange={(event) => onLeaderboardRegionFilterChange(event.target.value)}
          >
            <option value="ALL">All regions</option>
            {regionBuckets.map((bucket) => (
              <option key={bucket.code} value={bucket.code}>
                {bucket.short} · {bucket.label}
              </option>
            ))}
          </select>
        </div>
        <div className="leaderboard-bucket-chips">
          <button
            className={leaderboardBucketFilter === "ALL" ? "ghost small active" : "ghost small"}
            onClick={() => onLeaderboardBucketFilterChange("ALL")}
          >
            All postcode buckets
          </button>
          {regionBuckets.map((bucket) => (
            <button
              key={bucket.code}
              className={leaderboardBucketFilter === bucket.code ? "ghost small active" : "ghost small"}
              onClick={() => onLeaderboardBucketFilterChange(bucket.code)}
              title={`${bucket.label} · ${bucket.postcodeRange}`}
            >
              {bucket.short} {bucket.postcodeRange}
            </button>
          ))}
        </div>
      </div>
      <StaggerGroup className="leaderboard-region-grid" delayStep={80}>
        {filteredPublicRegionActivity.length ? (
          filteredPublicRegionActivity.map((region) => {
            const meta = getRegionBucketMeta(region.region);
            return (
              <div key={region.region} className="leaderboard-region-card">
                <span className="mono">{meta.short}</span>
                <strong>{Number(region.online_now || 0)}</strong>
                <span className="hint">{meta.postcodeRange}</span>
                <span className="hint">
                  {region.latest_seen_at
                    ? `Latest ${new Date(region.latest_seen_at).toLocaleTimeString()}`
                    : "No recent heartbeat"}
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">No public presence for this filter yet. Clear filters or sign in to add activity.</div>
        )}
      </StaggerGroup>
      <div className="table leaderboard-public-table">
        <div className="table-row head">
          <span>Rank</span>
          <span>Trader</span>
          <span>Region</span>
          <span>Profit</span>
          <span>Capability</span>
          <span>Breakdown</span>
        </div>
        {filteredCommunityLeaderboard.length ? (
          filteredCommunityLeaderboard.map((entry, index) => {
            const meta = getRegionBucketMeta(entry.region);
            const regionRank = communityRegionRanksByEntryId.get(entry.id) || 0;
            return (
              <div
                key={entry.id}
                className={`table-row motion-public-row${filteredCommunityMyEntry?.rank === entry.rank ? " best" : ""}`}
                style={{ ["--motion-delay" as string]: `${index * 36}ms` }}
              >
                <span>#{entry.rank} · R#{regionRank}</span>
                <span>{entry.label}</span>
                <span>
                  {meta.short} · {meta.postcodeRange}
                </span>
                <span>{formatProfit(entry.profit_aud)}</span>
                <span>{entry.capabilityScore.toFixed(1)}</span>
                <span>
                  A{entry.marketAlpha.toFixed(0)} · S{entry.stability.toFixed(0)} · E{entry.execution.toFixed(0)}
                </span>
              </div>
            );
          })
        ) : (
          <div className="empty">No public leaderboard entries for this filter yet. Clear filters or run a backtest.</div>
        )}
      </div>
    </AnimatedSection>
  );
}
