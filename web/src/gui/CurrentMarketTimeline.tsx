import { useMemo, useState } from "react";

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
  const [windowHours, setWindowHours] = useState(1);
  const buySeries = useMemo(() => buildSeries(rows, "general"), [rows]);
  const sellSeries = useMemo(() => buildSeries(rows, "feedIn"), [rows]);

  const sliceByWindow = (points: SeriesPoint[]) => {
    if (!points.length) return [];
    if (points.length < 2) return points;
    const first = new Date(points[0].time).getTime();
    const second = new Date(points[1].time).getTime();
    const stepMinutes = Math.max(5, Math.round((second - first) / 60000));
    const needed = Math.max(1, Math.round((windowHours * 60) / stepMinutes));
    return points.slice(-needed);
  };

  const renderBars = (points: SeriesPoint[], variant: "buy" | "sell") => {
    const sliced = sliceByWindow(points);
    const maxVal = Math.max(...sliced.map((p) => Math.abs(p.value)), 1);
    const trackWidth = Math.max(320, sliced.length * 90);
    return (
      <div className="lane-scroll">
        <div className="lane-track" style={{ width: trackWidth }}>
          {sliced.map((point) => {
            const height = Math.max(18, (Math.abs(point.value) / maxVal) * 70 + 14);
            return (
              <div key={`${variant}-${point.time}`} className="bar-item">
                <div className="bar-value">{formatAmberPrice(point.value)}</div>
                <div
                  className={`bar-rect ${variant} ${tone}`}
                  style={{ height }}
                  title={formatTimestamp(point.time)}
                />
                <div className="bar-time">
                  {formatTimestamp(point.time).split(",")[1]?.trim() || formatTimestamp(point.time)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <span className="timeline-title">{title}</span>
        <div className="timeline-actions">
          <button
            className={`ghost small ${windowHours === 1 ? "active" : ""}`}
            onClick={() => setWindowHours(1)}
          >
            1h
          </button>
          <button
            className={`ghost small ${windowHours === 4 ? "active" : ""}`}
            onClick={() => setWindowHours(4)}
          >
            4h
          </button>
          <button
            className={`ghost small ${windowHours === 24 ? "active" : ""}`}
            onClick={() => setWindowHours(24)}
          >
            24h
          </button>
        </div>
        <div className="timeline-legend">
          <span className="legend buy">Buy</span>
          <span className="legend sell">Sell</span>
        </div>
      </div>
      <div className="timeline-lanes">
        <div className="timeline-lane">
          <div className="lane-label">Buy (general)</div>
          <div className="lane-chart">{renderBars(buySeries, "buy")}</div>
        </div>
        <div className="timeline-lane">
          <div className="lane-label">Sell (feedIn)</div>
          <div className="lane-chart">{renderBars(sellSeries, "sell")}</div>
        </div>
      </div>
    </div>
  );
}
