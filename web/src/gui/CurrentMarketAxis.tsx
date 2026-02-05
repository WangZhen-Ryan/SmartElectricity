import React from "react";

import { formatAmberPrice } from "../core/utils";

type RawInterval = {
  startTime: string;
  perKwh: number;
  channelType: string;
};

type AxisPoint = {
  time: string;
  value: number;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildSeries(rows: RawInterval[] | null, channelType: string): AxisPoint[] {
  if (!rows?.length) return [];
  return rows
    .filter((item) => item.channelType === channelType)
    .map((item) => ({ time: item.startTime, value: item.perKwh }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function AxisRow({
  label,
  points,
  variant,
}: {
  label: string;
  points: AxisPoint[];
  variant: "solid" | "ghost";
}) {
  if (!points.length) {
    return (
      <div className="axis-row">
        <div className="axis-label">{label}</div>
        <div className="axis-empty">No data</div>
      </div>
    );
  }
  const columns = `repeat(${points.length}, minmax(0, 1fr))`;
  return (
    <div className="axis-row">
      <div className="axis-label">{label}</div>
      <div className="axis-track" style={{ gridTemplateColumns: columns }}>
        {points.map((point) => (
          <div key={`${label}-${point.time}`} className="axis-slot">
            <div className={`axis-dot ${variant}`} title={`${point.time} · ${formatAmberPrice(point.value)}`}>
              <span className="axis-price">{formatAmberPrice(point.value)}</span>
            </div>
            <span className="axis-time">{formatTime(point.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CurrentMarketAxis({
  title,
  rows,
  variant = "solid",
}: {
  title: string;
  rows: RawInterval[] | null;
  variant?: "solid" | "ghost";
}) {
  const buy = buildSeries(rows, "general");
  const sell = buildSeries(rows, "feedIn");
  return (
    <div className="axis-panel">
      <div className="axis-title">{title}</div>
      <AxisRow label="Buy (general)" points={buy} variant={variant} />
      <AxisRow label="Sell (feedIn)" points={sell} variant={variant} />
    </div>
  );
}
