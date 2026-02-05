import { useMemo, useRef, useState } from "react";

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
  const [hovered, setHovered] = useState<SeriesPoint | null>(null);
  const [hoverType, setHoverType] = useState<"buy" | "sell">("buy");
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0 });
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

  const currentTime = useMemo(() => {
    if (!rows?.length) return null;
    return rows.reduce((latest, item) => {
      if (!latest) return item.startTime;
      return new Date(item.startTime).getTime() > new Date(latest).getTime()
        ? item.startTime
        : latest;
    }, null as string | null);
  }, [rows]);

  const renderBars = (
    points: SeriesPoint[],
    variant: "buy" | "sell",
    current: string | null,
  ) => {
    const sliced = sliceByWindow(points);
    const maxVal = Math.max(...sliced.map((p) => Math.abs(p.value)), 1);
    const trackWidth = Math.max(320, sliced.length * 90);
    return (
      <div
        className="lane-scroll"
        onMouseDown={(event) => {
          dragState.current.active = true;
          dragState.current.startX = event.pageX;
          dragState.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        onMouseUp={() => {
          dragState.current.active = false;
        }}
        onMouseLeave={() => {
          dragState.current.active = false;
        }}
        onMouseMove={(event) => {
          if (!dragState.current.active) return;
          const delta = event.pageX - dragState.current.startX;
          event.currentTarget.scrollLeft = dragState.current.scrollLeft - delta;
        }}
      >
        <div className="lane-track" style={{ width: trackWidth }}>
          {sliced.map((point, index) => {
            const height = Math.max(18, (Math.abs(point.value) / maxVal) * 70 + 14);
            const prev = index > 0 ? sliced[index - 1] : null;
            const delta = prev ? point.value - prev.value : 0;
            const isCurrent = current ? point.time === current : index === 0;
            return (
              <div key={`${variant}-${point.time}`} className="bar-item">
                <div className="bar-value">{formatAmberPrice(point.value)}</div>
                <div
                  className={`bar-rect ${variant} ${tone}${isCurrent ? " current" : ""}`}
                  style={{ height }}
                  title={formatTimestamp(point.time)}
                  onMouseEnter={() => {
                    setHovered(point);
                    setHoverType(variant);
                  }}
                  onMouseLeave={() => setHovered(null)}
                />
                <div className="bar-time">
                  {formatTimestamp(point.time).split(",")[1]?.trim() || formatTimestamp(point.time)}
                </div>
                {hovered?.time === point.time && hoverType === variant ? (
                  <div className="bar-tooltip">
                    <div className="bar-tooltip-title">{formatTimestamp(point.time)}</div>
                    <div className={`bar-tooltip-row ${variant}`}>
                      {variant === "buy" ? "Buy" : "Sell"}: {formatAmberPrice(point.value)}
                    </div>
                    <div className="bar-tooltip-row">
                      Δ {delta >= 0 ? "+" : ""}{delta.toFixed(2)} c/kWh
                    </div>
                  </div>
                ) : null}
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
        <span className="timeline-hint">Drag to scroll</span>
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
          <div className="lane-chart">{renderBars(buySeries, "buy", currentTime)}</div>
        </div>
        <div className="timeline-lane">
          <div className="lane-label">Sell (feedIn)</div>
          <div className="lane-chart">{renderBars(sellSeries, "sell", currentTime)}</div>
        </div>
      </div>
    </div>
  );
}
