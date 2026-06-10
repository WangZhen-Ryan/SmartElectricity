import { useMemo, useState } from "react";

import { BacktestPoint } from "../core/types";
import { formatProfit, formatTimestamp, rangeValues, scale } from "../core/utils";
import { buildDayReviews, DayReview } from "../engine/decision_review";

type Props = {
  points: BacktestPoint[] | null;
  resolutionMinutes: number;
};

function formatBlockedReason(reason: BacktestPoint["blockedReason"]) {
  if (reason === "soc-high") return "SOC high";
  if (reason === "soc-low") return "SOC low";
  if (reason === "power-limit") return "Power limit";
  return null;
}

function DailyChart({ day }: { day: DayReview }) {
  const width = 860;
  const height = 220;
  const padding = 28;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const buyValues = day.points.map((p) => p.buy);
  const sellValues = day.points.map((p) => p.sell);
  const profitValues = day.points.map((p) => p.cumulativeProfit);
  const [priceMin, priceMax] = rangeValues([...buyValues, ...sellValues]);
  const [profitMin, profitMax] = rangeValues(profitValues);
  const xStep = (width - padding * 2) / Math.max(1, day.points.length - 1);

  const buyPath = buildPath(day.points, (p) =>
    scale(p.buy, priceMin, priceMax, height - padding, padding),
  );
  const sellPath = buildPath(day.points, (p) =>
    scale(p.sell, priceMin, priceMax, height - padding, padding),
  );
  const profitPath = buildPath(day.points, (p) =>
    scale(p.cumulativeProfit, profitMin, profitMax, height - padding, padding),
  );

  const hoverPoint = hoverIndex !== null ? day.points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;

  return (
    <div className="decision-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < day.points.length) setHoverIndex(index);
        }}
      >
        <defs>
          <linearGradient id="buyGradient" x1="0" x2="1">
            <stop offset="0%" stopColor="#61e4ff" />
            <stop offset="100%" stopColor="#2b8dff" />
          </linearGradient>
          <linearGradient id="sellGradient" x1="0" x2="1">
            <stop offset="0%" stopColor="#ffd36b" />
            <stop offset="100%" stopColor="#ff6b4a" />
          </linearGradient>
          <linearGradient id="profitGradient" x1="0" x2="1">
            <stop offset="0%" stopColor="#9bff9c" />
            <stop offset="100%" stopColor="#21c98a" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        <path d={buyPath} fill="none" stroke="url(#buyGradient)" strokeWidth="2" />
        <path d={sellPath} fill="none" stroke="url(#sellGradient)" strokeWidth="2" />
        <path d={profitPath} fill="none" stroke="url(#profitGradient)" strokeWidth="2" opacity="0.7" />

        {day.points.map((point, idx) => {
          const x = padding + idx * xStep;
          const y = height - 18;
          const color =
            point.executedAction === "charge"
              ? "#38bdf8"
              : point.executedAction === "discharge"
                ? "#f59e0b"
                : "#64748b";
          return <rect key={`${point.time}-bar`} x={x - 2} y={y} width="4" height="12" fill={color} rx="2" />;
        })}

        {hoverPoint ? (
          <>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={padding}
              y2={height - padding}
              stroke="rgba(148, 163, 184, 0.4)"
              strokeDasharray="4 4"
            />
          </>
        ) : null}
      </svg>
      {hoverPoint ? (
        <div className="decision-tooltip" style={{ left: `${Math.min(hoverX + 12, 640)}px` }}>
          <div className="decision-tooltip-title">{formatTimestamp(hoverPoint.time)}</div>
          <div className="decision-tooltip-row">Signal: {hoverPoint.signalAction.toUpperCase()}</div>
          <div className="decision-tooltip-row">Executed: {hoverPoint.executedAction.toUpperCase()}</div>
          {hoverPoint.signalAction !== "hold" && hoverPoint.executedAction === "hold" ? (
            <div className="decision-tooltip-row">
              Blocked: {formatBlockedReason(hoverPoint.blockedReason) || "Unknown"}
            </div>
          ) : null}
          <div className="decision-tooltip-row">
            Buy (general): {Math.abs(hoverPoint.buy).toFixed(2)}c
            {hoverPoint.buy < 0 ? " (paid)" : " (cost)"}
          </div>
          <div className="decision-tooltip-row">
            Sell (feed-in): {Math.abs(hoverPoint.sell).toFixed(2)}c
            {hoverPoint.sell < 0 ? " (credit)" : " (credit)"}
          </div>
          <div className="decision-tooltip-row">SOC: {hoverPoint.soc.toFixed(1)}</div>
          <div className="decision-tooltip-row">
            Interval P/L: {formatProfit(hoverPoint.deltaProfit)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildPath(
  points: BacktestPoint[],
  y: (p: BacktestPoint) => number,
  padding = 28,
  width = 860,
) {
  const xStep = (width - padding * 2) / Math.max(1, points.length - 1);
  return points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${padding + idx * xStep} ${y(p)}`)
    .join(" ");
}

export default function DailyDecisionReview({ points, resolutionMinutes }: Props) {
  const reviews = useMemo(() => (points ? buildDayReviews(points) : []), [points]);
  const [selected, setSelected] = useState(0);
  const active = reviews[selected] || null;
  const avgBuyAbs = active ? Math.abs(active.summary.avgBuy) : 0;
  const avgSellAbs = active ? Math.abs(active.summary.avgSell) : 0;
  const spread = active ? avgBuyAbs - avgSellAbs : 0;

  if (!reviews.length) {
    return <div className="empty">Run a backtest to see daily decision review.</div>;
  }

  return (
    <div className="daily-review">
      <div className="day-tabs">
        {reviews.map((day, idx) => (
          <button
            key={day.date}
            className={`ghost small ${idx === selected ? "active" : ""}`}
            onClick={() => setSelected(idx)}
          >
            {day.date}
          </button>
        ))}
      </div>

      {active ? (
        <>
          <div className="summary-grid">
            <div className="summary-card">
              <span className="mono">Day P/L</span>
              <strong>{formatProfit(active.summary.profit)}</strong>
              <span>{resolutionMinutes} min resolution</span>
            </div>
            <div className="summary-card">
              <span className="mono">Max Drawdown</span>
              <strong>{formatProfit(-active.summary.maxDrawdown)}</strong>
              <span>Peak-to-trough</span>
            </div>
            <div className="summary-card">
              <span className="mono">Avg Buy / Sell</span>
              <strong>
                {avgBuyAbs.toFixed(1)}c / {avgSellAbs.toFixed(1)}c
              </strong>
              <span>General cost vs feed-in credit</span>
            </div>
            <div className="summary-card">
              <span className="mono">Avg SOC</span>
              <strong>{active.summary.avgSoc.toFixed(1)}</strong>
              <span>Battery level</span>
            </div>
            <div className="summary-card">
              <span className="mono">Daily Cost</span>
              <strong>{formatProfit(-active.summary.costAud)}</strong>
              <span>{active.summary.energyBoughtKwh.toFixed(2)} kWh charged</span>
            </div>
            <div className="summary-card">
              <span className="mono">Daily Revenue</span>
              <strong>{formatProfit(active.summary.revenueAud)}</strong>
              <span>{active.summary.energySoldKwh.toFixed(2)} kWh sold</span>
            </div>
            <div className="summary-card">
              <span className="mono">Net Energy P/L</span>
              <strong>{formatProfit(active.summary.netAud)}</strong>
              <span>Revenue minus cost</span>
            </div>
            <div className="summary-card">
              <span className="mono">Signals</span>
              <strong>
                C {active.summary.signalCounts.charge} · D {active.summary.signalCounts.discharge} · H {active.summary.signalCounts.hold}
              </strong>
              <span>Planned by strategy</span>
            </div>
            <div className="summary-card">
              <span className="mono">Executed</span>
              <strong>
                C {active.summary.executedCounts.charge} · D {active.summary.executedCounts.discharge} · H {active.summary.executedCounts.hold}
              </strong>
              <span>{active.summary.blockedSignals} blocked signals</span>
            </div>
            <div className="summary-card">
              <span className="mono">Blocked Reasons</span>
              <strong>
                High {active.summary.blockedBy.socHigh} · Low {active.summary.blockedBy.socLow} · Pwr {active.summary.blockedBy.powerLimit}
              </strong>
              <span>SOC high / SOC low / power limit</span>
            </div>
          </div>

          <DailyChart day={active} />

          <div className="review-notes">
            <h4>Daily Summary</h4>
            <ul>
              <li>
                {active.summary.signalCounts.discharge > active.summary.signalCounts.charge
                  ? "Signal was discharge-biased"
                  : "Signal was charge-biased"}{" "}
                with {active.summary.signalCounts.hold} hold signals.
              </li>
              <li>
                Executed C/D/H: {active.summary.executedCounts.charge}/{active.summary.executedCounts.discharge}/
                {active.summary.executedCounts.hold}, blocked signals: {active.summary.blockedSignals}.
              </li>
              <li>
                Blocked reasons: SOC high {active.summary.blockedBy.socHigh}, SOC low{" "}
                {active.summary.blockedBy.socLow}, power limit {active.summary.blockedBy.powerLimit}.
              </li>
              <li>Average buy {avgBuyAbs.toFixed(1)}c vs sell {avgSellAbs.toFixed(1)}c (spread {spread.toFixed(1)}c).</li>
              <li>General pricing includes grid fees, so buy is typically higher than sell.</li>
              {active.summary.executedCounts.charge === 0 &&
              active.summary.executedCounts.discharge === 0 ? (
                <li>
                  No executed trades this day. Common causes: conservative thresholds, full/empty
                  SOC constraints, or a baseline/no-trade strategy.
                </li>
              ) : null}
              <li>Daily cost {formatProfit(-active.summary.costAud)} vs revenue {formatProfit(active.summary.revenueAud)}.</li>
              <li>Max drawdown {formatProfit(-active.summary.maxDrawdown)} with daily P/L {formatProfit(active.summary.profit)}.</li>
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
