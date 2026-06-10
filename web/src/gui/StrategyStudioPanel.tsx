type StrategyProfileRow = {
  id: string;
  name: string;
  is_active: boolean;
};

function getStatusTone(status: string) {
  const lower = status.toLowerCase();
  if (/(published|saved|ready|loaded|active|created|updated|private-ready)/.test(lower)) return "good";
  if (/(error|failed|missing|incomplete|blocked)/.test(lower)) return "bad";
  if (/(wait|pending|idle|local-only|private-only)/.test(lower)) return "neutral";
  return "warn";
}

type Props = {
  strategyStudioName: string;
  strategyProfileLoadedAt: number | null;
  strategyPublishEnabled: boolean;
  leaderboardPublishStatus: string;
  activeStrategyName: string;
  activeDiagnosticsQualityScore: number | null;
  selectedStrategyProfileId: string;
  savedStrategyProfiles: StrategyProfileRow[];
  strategyReserveMarginPct: number;
  strategyRlWeight: number;
  strategyForecastWeight: number;
  authSession: { user?: { email?: string } } | null;
  configModeLabel: string;
  strategyConfigBrief: string;
  strategyProfileStatus: string;
  activeCloudProfileName: string | null;
  activeCloudProfileUpdatedAt: string | null;
  publishPreview: {
    strategyLabel: string;
    regionLabel: string;
    qualityLabel: string;
    publicFieldsLabel: string;
  } | null;
  onStrategyStudioNameChange: (value: string) => void;
  onSelectedStrategyProfileIdChange: (value: string) => void;
  onLoadSelectedStrategyProfile: () => void;
  onSetActiveStrategyProfile: () => void;
  onStrategyReserveMarginPctChange: (value: number) => void;
  onStrategyRlWeightChange: (value: number) => void;
  onStrategyForecastWeightChange: (value: number) => void;
  onStrategyPublishEnabledChange: (value: boolean) => void;
  onSaveStrategyStudio: () => void;
  onGenerateStrategyProfileFromCurrent: () => void;
  onPublishActiveResult: () => void;
  canGenerate: boolean;
  canPublish: boolean;
};

export default function StrategyStudioPanel({
  strategyStudioName,
  strategyProfileLoadedAt,
  strategyPublishEnabled,
  leaderboardPublishStatus,
  activeStrategyName,
  activeDiagnosticsQualityScore,
  selectedStrategyProfileId,
  savedStrategyProfiles,
  strategyReserveMarginPct,
  strategyRlWeight,
  strategyForecastWeight,
  authSession,
  configModeLabel,
  strategyConfigBrief,
  strategyProfileStatus,
  activeCloudProfileName,
  activeCloudProfileUpdatedAt,
  publishPreview,
  onStrategyStudioNameChange,
  onSelectedStrategyProfileIdChange,
  onLoadSelectedStrategyProfile,
  onSetActiveStrategyProfile,
  onStrategyReserveMarginPctChange,
  onStrategyRlWeightChange,
  onStrategyForecastWeightChange,
  onStrategyPublishEnabledChange,
  onSaveStrategyStudio,
  onGenerateStrategyProfileFromCurrent,
  onPublishActiveResult,
  canGenerate,
  canPublish,
}: Props) {
  const publishTone = getStatusTone(leaderboardPublishStatus);
  const profileTone = getStatusTone(strategyProfileStatus);
  return (
    <section className="panel" id="strategy-studio">
      <div className="panel-header">
        <h2>Strategy Studio</h2>
        <p className="hint">Minimal strategy profile builder for save, replay, and leaderboard publishing.</p>
      </div>
      <div className="summary-grid">
        <div className="summary-card">
          <span className="mono">Studio Profile</span>
          <strong>{strategyStudioName}</strong>
          <span className="hint">
            {strategyProfileLoadedAt
              ? `Updated ${new Date(strategyProfileLoadedAt).toLocaleString()}`
              : "No saved strategy profile yet."}
          </span>
        </div>
        <div className={`summary-card motion-hero-node ${strategyPublishEnabled ? "hero-leaderboard" : "hero-hold"}`}>
          <span className="mono">Publish State</span>
          <strong>{strategyPublishEnabled ? "Public-ready" : "Private-only"}</strong>
          <span className={`hint studio-status ${publishTone}`}>{leaderboardPublishStatus}</span>
        </div>
        <div className="summary-card">
          <span className="mono">Current Driver</span>
          <strong>{activeStrategyName}</strong>
          <span className="hint">
            {activeDiagnosticsQualityScore !== null
              ? `${activeDiagnosticsQualityScore}/100 quality`
              : "Run backtest first"}
          </span>
        </div>
        <div className="summary-card">
          <span className="mono">Active Cloud Profile</span>
          <strong>{activeCloudProfileName || "Local session only"}</strong>
          <span className="hint">
            {activeCloudProfileUpdatedAt
              ? `Updated ${new Date(activeCloudProfileUpdatedAt).toLocaleString()}`
              : authSession
                ? "No cloud profile marked active yet."
                : "Sign in to activate a cloud strategy profile."}
          </span>
        </div>
      </div>
      <div className="grid">
        <div className="panel inset">
          <div className="field">
            <label>Strategy profile name</label>
            <input
              value={strategyStudioName}
              onChange={(event) => onStrategyStudioNameChange(event.target.value)}
              placeholder="Primary Alpha"
            />
          </div>
          <div className="field">
            <label>Saved cloud profiles</label>
            <div className="row">
              <select
                value={selectedStrategyProfileId}
                onChange={(event) => onSelectedStrategyProfileIdChange(event.target.value)}
                disabled={!savedStrategyProfiles.length}
              >
                <option value="">Select a saved profile</option>
                {savedStrategyProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.is_active ? "Active · " : ""}
                    {profile.name}
                  </option>
                ))}
              </select>
              <button
                className="ghost small"
                onClick={onLoadSelectedStrategyProfile}
                disabled={!selectedStrategyProfileId}
              >
                Load
              </button>
              <button
                className="ghost small"
                onClick={onSetActiveStrategyProfile}
                disabled={!authSession || !selectedStrategyProfileId}
              >
                Set Active
              </button>
            </div>
            <span className="hint">
              {authSession
                ? `${savedStrategyProfiles.length} cloud profile${savedStrategyProfiles.length === 1 ? "" : "s"} available.`
                : "Sign in to load or activate cloud strategy profiles."}
            </span>
          </div>
          <div className="field">
            <label>Reserve safety margin ({strategyReserveMarginPct}%)</label>
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={strategyReserveMarginPct}
              onChange={(event) => onStrategyReserveMarginPctChange(Number(event.target.value))}
            />
            <span className="hint">How much battery reserve to protect before aggressive export.</span>
          </div>
          <div className="field">
            <label>RL confidence weight ({Math.round(strategyRlWeight * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strategyRlWeight}
              onChange={(event) => onStrategyRlWeightChange(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label>Forecast trust weight ({Math.round(strategyForecastWeight * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strategyForecastWeight}
              onChange={(event) => onStrategyForecastWeightChange(Number(event.target.value))}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={strategyPublishEnabled}
              onChange={(event) => onStrategyPublishEnabledChange(event.target.checked)}
            />
            <span>Allow this profile to publish leaderboard results</span>
          </label>
          <div className="hero-actions">
            <button className="primary" onClick={onSaveStrategyStudio}>
              Save Strategy Profile
            </button>
            <button className="ghost" onClick={onGenerateStrategyProfileFromCurrent} disabled={!canGenerate}>
              Generate From Current Result
            </button>
            <button className="ghost" onClick={onPublishActiveResult} disabled={!canPublish}>
              Publish Active Result
            </button>
          </div>
          <div className={`hint studio-status studio-status-banner ${profileTone}`}>{strategyProfileStatus}</div>
        </div>
        <div className="panel inset">
          <div className="score-card">
            <div className="score-top">
              <span className="mono">Normalized Profile</span>
              <strong>{configModeLabel}</strong>
            </div>
            <div className="signal-grid">
              <div className="signal-card">
                <strong>{activeStrategyName}</strong>
                <span className="hint">Execution strategy</span>
              </div>
              <div className="signal-card">
                <strong>{strategyConfigBrief}</strong>
                <span className="hint">Current backtest envelope</span>
              </div>
              <div className="signal-card">
                <strong>{strategyReserveMarginPct}% reserve</strong>
                <span className="hint">Battery safety floor</span>
              </div>
              <div className="signal-card">
                <strong>
                  {Math.round(strategyRlWeight * 100)} RL / {Math.round(strategyForecastWeight * 100)} forecast
                </strong>
                <span className="hint">Decision weight blend</span>
              </div>
              <div className="signal-card">
                <strong>{authSession ? "Cloud + local" : "Local session only"}</strong>
                <span className="hint">Persistence target</span>
              </div>
              <div className="signal-card">
                <strong>{strategyPublishEnabled ? "Leaderboard enabled" : "Private profile"}</strong>
                <span className="hint">Publish permission</span>
              </div>
              <div className="signal-card">
                <strong>{publishPreview?.strategyLabel || activeStrategyName}</strong>
                <span className="hint">Publish strategy label</span>
              </div>
              <div className="signal-card">
                <strong>{publishPreview?.regionLabel || "AU region pending"}</strong>
                <span className="hint">Leaderboard routing</span>
              </div>
              <div className="signal-card">
                <strong>{publishPreview?.qualityLabel || "Quality pending"}</strong>
                <span className="hint">Public quality summary</span>
              </div>
              <div className="signal-card">
                <strong>{publishPreview?.publicFieldsLabel || "Metrics only"}</strong>
                <span className="hint">What gets published</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
