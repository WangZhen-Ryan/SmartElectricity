type DecisionAction = "charge" | "hold" | "discharge";

type DecisionChip = {
  label: string;
  value: string;
};

type TimelineSlot = {
  time: string;
  buy: number;
  sell: number;
  action: DecisionAction;
};

type TimelineDetailCard = {
  label: string;
  value: string;
  hint: string;
};

type TimelineDetail = {
  slot: TimelineSlot;
  slotReason: string;
  cards: TimelineDetailCard[];
};

type Props = {
  monitorDecision: {
    action: DecisionAction;
    powerKw: number;
    confidence: number;
  } | null;
  configMaxPowerKw: number;
  currentBuy: number | null;
  currentSell: number | null;
  overrideActionFocus: DecisionAction | null;
  instantOverrideEnabled: boolean;
  overrideControlHint: string;
  controlStatusLabel: string;
  controlModeLabel: string;
  controlBlockedReasons: string[];
  homeOverrideInsights: {
    primaryReason: string;
    chips: DecisionChip[];
    supportingReasons: string[];
  } | null;
  batterySocPct: number;
  reserveSocPct: number;
  homeTimelineExpanded: boolean;
  monitorTimeline: TimelineSlot[];
  homeTimelineDetailIndex: number | null;
  homeTimelinePinnedIndex: number | null;
  homeTimelineDetailMetrics: TimelineDetail | null;
  onToggleTimelineExpanded: () => void;
  onToggleManualOverride: (action: DecisionAction) => void;
  onHoverTimelineIndex: (index: number | null) => void;
  onPinnedTimelineIndex: (index: number | null) => void;
  formatAmberPrice: (value: number) => string;
};

export default function HomeDecisionConsolePanel({
  monitorDecision,
  configMaxPowerKw,
  currentBuy,
  currentSell,
  overrideActionFocus,
  instantOverrideEnabled,
  overrideControlHint,
  controlStatusLabel,
  controlModeLabel,
  controlBlockedReasons,
  homeOverrideInsights,
  batterySocPct,
  reserveSocPct,
  homeTimelineExpanded,
  monitorTimeline,
  homeTimelineDetailIndex,
  homeTimelinePinnedIndex,
  homeTimelineDetailMetrics,
  onToggleTimelineExpanded,
  onToggleManualOverride,
  onHoverTimelineIndex,
  onPinnedTimelineIndex,
  formatAmberPrice,
}: Props) {
  return (
    <AnimatedSection className="home-override-panel" enter="rise">
      <div className="panel-header">
        <h3>Live Override Recommendation</h3>
        <span className="hint">
          {instantOverrideEnabled
            ? "Local control available through your own bridge."
            : "Advisory by default. Local control requires a healthy local bridge."}
        </span>
      </div>
      {monitorDecision ? (
        <StaggerGroup className="home-override-grid" delayStep={120}>
          <div className={`home-override-card home-override-primary motion-hero-node hero-${monitorDecision.action} ${monitorDecision.action}`}>
            <span className="mono">Recommended Now</span>
            <div className={`home-override-pill ${monitorDecision.action}`}>
              {monitorDecision.action.toUpperCase()}
            </div>
            <strong>{monitorDecision.powerKw.toFixed(1)} kW target</strong>
            <div className="home-override-powerband">
              <div
                className={`home-override-powerfill ${monitorDecision.action}`}
                style={{
                  width: `${Math.max(
                    18,
                    Math.min(100, (monitorDecision.powerKw / Math.max(0.1, configMaxPowerKw)) * 100),
                  )}%`,
                }}
              />
            </div>
            <div className="override-force-row">
              {(["charge", "hold", "discharge"] as DecisionAction[]).map((action) => (
                <button
                  key={action}
                  className={`ghost small ${
                    overrideActionFocus === action ? "active" : ""
                  } ${instantOverrideEnabled ? "ready" : ""}`}
                  type="button"
                  onClick={() => instantOverrideEnabled && onToggleManualOverride(action)}
                  disabled={!instantOverrideEnabled}
                >
                  Force {action.charAt(0).toUpperCase() + action.slice(1)}
                </button>
              ))}
            </div>
            <span className="hint">
              Confidence {(monitorDecision.confidence * 100).toFixed(0)}% · 5 min live cadence
            </span>
            <span className="hint">
              Buy {currentBuy !== null ? formatAmberPrice(currentBuy) : "—"} · Sell{" "}
              {currentSell !== null ? `${currentSell.toFixed(1)} c/kWh` : "—"}
            </span>
            <span className="mono">{controlStatusLabel}</span>
            <span className="hint">{overrideControlHint}</span>
            <span className="hint">{controlModeLabel}</span>
            {controlBlockedReasons.length ? (
              <div className="home-override-reasons">
                {controlBlockedReasons.slice(0, 3).map((reason) => (
                  <div key={reason} className="home-override-reason">
                    {reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="home-override-card">
            <span className="mono">Decision Factors</span>
            <strong>{homeOverrideInsights?.primaryReason || "Awaiting live rationale."}</strong>
            <div className="home-override-insight-grid">
              {homeOverrideInsights?.chips.slice(0, 6).map((item) => (
                <div key={item.label} className="home-override-insight">
                  <span className="mono">{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="home-override-reasons">
              {homeOverrideInsights?.supportingReasons.map((reason, idx) => (
                <div key={`${reason}-${idx}`} className="home-override-reason">
                  {reason}
                </div>
              ))}
            </div>
            <span className="hint">
              SOC {batterySocPct.toFixed(0)}% · Reserve floor {reserveSocPct.toFixed(0)}%
            </span>
          </div>
          <div className="home-override-card">
            <div className="home-override-head">
              <span className="mono">Decision Timeline</span>
              <button className="ghost small" onClick={onToggleTimelineExpanded}>
                {homeTimelineExpanded ? "Show 6" : "Show 12"}
              </button>
            </div>
            <strong>Next live slots</strong>
            <div className="home-override-timeline">
              {monitorTimeline.slice(0, homeTimelineExpanded ? 12 : 6).map((item, idx) => (
                <div
                  key={`${item.time}-${idx}`}
                  className={`home-override-row ${homeTimelineDetailIndex === idx ? "active" : ""}`}
                  onMouseEnter={() => onHoverTimelineIndex(idx)}
                  onMouseLeave={() => onHoverTimelineIndex(homeTimelinePinnedIndex === idx ? idx : null)}
                  onClick={() => onPinnedTimelineIndex(homeTimelinePinnedIndex === idx ? null : idx)}
                >
                  <span className="mono">
                    {new Date(item.time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    {item.buy.toFixed(1)} / {item.sell.toFixed(1)}c
                  </span>
                  <span className={`pill ${item.action}`}>{item.action.toUpperCase()}</span>
                </div>
              ))}
            </div>
            <AnimatedSwitch
              switchKey={homeTimelineDetailIndex !== null ? `detail-${homeTimelineDetailIndex}-${homeTimelinePinnedIndex !== null ? "locked" : "hover"}` : "idle"}
              className="home-override-detail-switch"
              mode="slide"
            >
            {homeTimelineDetailIndex !== null ? (
              <div className="home-override-detail motion-scene-card">
                <span className="mono">
                  {homeTimelinePinnedIndex !== null ? "Locked Slot Detail" : "Hovered Slot Detail"}
                </span>
                <strong>
                  {homeTimelineDetailMetrics?.slot.action.toUpperCase()} at{" "}
                  {new Date(homeTimelineDetailMetrics?.slot.time || "").toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
                <div className="home-override-detail-grid">
                  {homeTimelineDetailMetrics?.cards.map((card) => (
                    <div key={card.label} className="home-override-detail-card">
                      <span className="mono">{card.label}</span>
                      <strong>{card.value}</strong>
                      <span className="hint">{card.hint}</span>
                    </div>
                  ))}
                </div>
                <span>{homeTimelineDetailMetrics?.slotReason}</span>
                <span className="hint">
                  {homeTimelinePinnedIndex !== null
                    ? "Click the same row again to unlock. This is still advisory only."
                    : "This is an advisory expansion only. No override command is sent from Home."}
                </span>
              </div>
            ) : (
              <div className="home-override-detail motion-scene-card">
                <span className="mono">Timeline Drill-Down</span>
                <span>
                  Hover a slot to preview the rationale, or click a row to lock it in place. Use
                  “Show 12” for a longer horizon.
                </span>
              </div>
            )}
            </AnimatedSwitch>
          </div>
        </StaggerGroup>
      ) : (
        <div className="empty">Load live prices to generate the current override recommendation.</div>
      )}
    </AnimatedSection>
  );
}
import AnimatedSection from "./AnimatedSection";
import AnimatedSwitch from "./AnimatedSwitch";
import StaggerGroup from "./StaggerGroup";
