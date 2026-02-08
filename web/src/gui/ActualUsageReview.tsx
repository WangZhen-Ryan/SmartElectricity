import { useMemo, useState } from "react";

import { UsageInterval } from "../core/types";
import { formatProfit } from "../core/utils";
import { buildUsageSummaries, UsageWeekSummary } from "../engine/usage_review";

type Props = {
  usage: UsageInterval[] | null;
};

function UsageChart({ week }: { week: UsageWeekSummary }) {
  const width = 860;
  const height = 220;
  const padding = 28;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxKwh = Math.max(
    1,
    ...week.days.map((day) => Math.max(day.importKwh, day.exportKwh)),
  );
  const netValues = week.days.map((day) => day.netAud);
  const netMin = Math.min(...netValues, 0);
  const netMax = Math.max(...netValues, 0.01);
  const xStep = (width - padding * 2) / Math.max(1, week.days.length - 1);

  return (
    <div className="usage-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < week.days.length) setHoverIndex(index);
        }}
      >
        <defs>
          <linearGradient id="usageImport" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4cc9ff" />
            <stop offset="100%" stopColor="#1b6adf" />
          </linearGradient>
          <linearGradient id="usageExport" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ffcf5a" />
            <stop offset="100%" stopColor="#ff9f1a" />
          </linearGradient>
        </defs>
        {week.days.map((day, idx) => {
          const x = padding + idx * xStep;
          const importHeight = (day.importKwh / maxKwh) * (height - padding * 2);
          const exportHeight = (day.exportKwh / maxKwh) * (height - padding * 2);
          const importY = height - padding - importHeight;
          const exportY = height - padding - exportHeight;
          return (
            <g key={day.date}>
              <rect
                x={x - 16}
                y={importY}
                width={12}
                height={importHeight}
                rx={6}
                fill="url(#usageImport)"
              />
              <rect
                x={x + 4}
                y={exportY}
                width={12}
                height={exportHeight}
                rx={6}
                fill="url(#usageExport)"
              />
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill="rgba(148,163,184,0.9)"
              >
                {day.date.slice(5)}
              </text>
            </g>
          );
        })}
        {week.days.map((day, idx) => {
          const x = padding + idx * xStep;
          const y =
            height -
            padding -
            ((day.netAud - netMin) / Math.max(0.01, netMax - netMin)) * (height - padding * 2);
          return (
            <circle
              key={`${day.date}-net`}
              cx={x}
              cy={y}
              r={idx === hoverIndex ? 4 : 3}
              fill={day.netAud >= 0 ? "#3ad29f" : "#f87171"}
              opacity={0.85}
            />
          );
        })}
      </svg>
      {hoverIndex !== null ? (
        <div className="usage-tooltip" style={{ left: `${Math.min(hoverIndex * xStep + 40, 700)}px` }}>
          <div className="usage-tooltip-title">{week.days[hoverIndex].date}</div>
          <div className="usage-tooltip-row">Import: {week.days[hoverIndex].importKwh.toFixed(2)} kWh</div>
          <div className="usage-tooltip-row">Export: {week.days[hoverIndex].exportKwh.toFixed(2)} kWh</div>
          <div className="usage-tooltip-row">Cost: {formatProfit(-week.days[hoverIndex].costAud)}</div>
          <div className="usage-tooltip-row">Revenue: {formatProfit(week.days[hoverIndex].revenueAud)}</div>
          <div className="usage-tooltip-row">Net: {formatProfit(week.days[hoverIndex].netAud)}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function ActualUsageReview({ usage }: Props) {
  const weeks = useMemo(() => buildUsageSummaries(usage), [usage]);
  const [selected, setSelected] = useState(0);
  const active = weeks[selected] || null;

  if (!weeks.length) {
    return <div className="empty">Load Amber usage data to see actual daily/weekly history.</div>;
  }

  return (
    <div className="usage-review">
      <div className="panel-header">
        <h2>Actual Usage (Amber)</h2>
        <p className="hint">Weekly aggregates with daily import/export detail</p>
      </div>
      <div className="day-tabs">
        {weeks.map((week, idx) => (
          <button
            key={week.key}
            className={`ghost small ${idx === selected ? "active" : ""}`}
            onClick={() => setSelected(idx)}
          >
            {week.label}
          </button>
        ))}
      </div>
      {active ? (
        <>
          <div className="summary-grid">
            <div className="summary-card">
              <span className="mono">Import kWh</span>
              <strong>{active.totals.importKwh.toFixed(1)}</strong>
              <span>{active.startDate} → {active.endDate}</span>
            </div>
            <div className="summary-card">
              <span className="mono">Export kWh</span>
              <strong>{active.totals.exportKwh.toFixed(1)}</strong>
              <span>Feed-in total</span>
            </div>
            <div className="summary-card">
              <span className="mono">Cost</span>
              <strong>{formatProfit(-active.totals.costAud)}</strong>
              <span>Energy spend</span>
            </div>
            <div className="summary-card">
              <span className="mono">Revenue</span>
              <strong>{formatProfit(active.totals.revenueAud)}</strong>
              <span>Energy earned</span>
            </div>
            <div className="summary-card">
              <span className="mono">Net</span>
              <strong>{formatProfit(active.totals.netAud)}</strong>
              <span>Revenue minus cost</span>
            </div>
          </div>

          <UsageChart week={active} />

          <div className="usage-table">
            <div className="table-row head">
              <span>Date</span>
              <span>Import kWh</span>
              <span>Export kWh</span>
              <span>Cost</span>
              <span>Revenue</span>
              <span>Net</span>
            </div>
            {active.days.map((day) => (
              <div key={day.date} className="table-row">
                <span>{day.date}</span>
                <span>{day.importKwh.toFixed(2)}</span>
                <span>{day.exportKwh.toFixed(2)}</span>
                <span>{formatProfit(-day.costAud)}</span>
                <span>{formatProfit(day.revenueAud)}</span>
                <span>{formatProfit(day.netAud)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
