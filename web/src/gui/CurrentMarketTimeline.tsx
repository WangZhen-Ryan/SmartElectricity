import { useMemo } from "react";

import { formatAmberPrice, formatTimestamp } from "../core/utils";

type RawInterval = {
  startTime: string;
  perKwh: number;
  channelType: string;
};

type SeriesPoint = { time: string; value: number };

function buildSeries(rows: RawInterval[] | null, channelType: string): SeriesPoint[] {
  if (!rows?.length) return [];
  return rows
    .filter((item) => item.channelType === channelType)
    .map((item) => ({
      time: item.startTime,
      value: item.perKwh,
    }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export function CurrentMarketTimeline({
  title,
  rows,
  tone = "primary",
}: {
  title: string;
  rows: RawInterval[] | null;
  tone?: "primary" | "secondary";
}) {
  const buySeries = useMemo(() => buildSeries(rows, "general"), [rows]);
  const sellSeries = useMemo(() => buildSeries(rows, "feedIn"), [rows]);
  const panelTone = tone === "primary" ? "buy" : "sell";

  const renderBars = (points: SeriesPoint[], variant: "buy" | "sell") => {
    const width = 900;
    const height = 90;
    const padding = 26;
    const maxVal = Math.max(...points.map((p) => Math.abs(p.value)), 1);
    const barSpace = (width - padding * 2) / Math.max(points.length, 1);
    const barWidth = Math.max(10, barSpace * 0.6);
    const barGap = barSpace - barWidth;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <line
          x1={padding}
          x2={width - padding}
          y1={height - 24}
          y2={height - 24}
          stroke="rgba(148, 163, 184, 0.25)"
          strokeWidth="1"
        />
        {points.map((point, idx) => {
          const x = padding + idx * barSpace + barGap / 2;
          const barHeight = (Math.abs(point.value) / maxVal) * (height - 40);
          const y = height - 24 - barHeight;
          return (
            <g key={`${variant}-${point.time}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="6"
                className={`bar-rect ${variant} ${tone}`}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                className="bar-label"
              >
                {formatAmberPrice(point.value)}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                className="bar-time"
              >
                {formatTimestamp(point.time).split(",")[1]?.trim() || formatTimestamp(point.time)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <span className="timeline-title">{title}</span>
        <div className="timeline-legend">
          <span className="legend buy">Buy</span>
          <span className="legend sell">Sell</span>
        </div>
      </div>
      <div className="timeline-lanes">
        <div className="timeline-lane">
          <div className="lane-label">Buy (general)</div>
          <div className={`lane-chart ${panelTone}`}>{renderBars(buySeries, "buy")}</div>
        </div>
        <div className="timeline-lane">
          <div className="lane-label">Sell (feedIn)</div>
          <div className={`lane-chart ${panelTone}`}>{renderBars(sellSeries, "sell")}</div>
        </div>
      </div>
    </div>
  );
}
