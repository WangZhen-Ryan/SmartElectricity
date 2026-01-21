import { useState } from "react";
import {
  BacktestPoint,
  DailySolarPoint,
  StrategyResult,
  WeatherPoint,
} from "../core/types";
import { rangeValues, scale } from "../core/utils";
import { actionColor, buildActionSegments } from "../engine/llm";

export function Chart({
  points,
  ranges,
  baseline,
  llmOverlay,
  llmResponse,
}: {
  points: BacktestPoint[];
  ranges: {
    buy: [number, number];
    sell: [number, number];
    soc: [number, number];
    profit: [number, number];
    baseline: [number, number];
  };
  baseline?: BacktestPoint[];
  llmOverlay?: {
    enabled: boolean;
    bands: boolean;
    arrows: boolean;
    opacity: number;
  };
  llmResponse?: string;
}) {
  const width = 860;
  const height = 280;
  const padding = 32;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const [buyMin, buyMax] = ranges.buy;
  const [sellMin, sellMax] = ranges.sell;
  const [socMin, socMax] = ranges.soc;
  const [profitMin, profitMax] = ranges.profit;
  const [baseMin, baseMax] = ranges.baseline;

  const buyPath = buildPath(points, (p) =>
    scale(p.buy, buyMin, buyMax, height - padding, padding),
    padding,
    xStep,
  );
  const sellPath = buildPath(points, (p) =>
    scale(p.sell, sellMin, sellMax, height - padding, padding),
    padding,
    xStep,
  );
  const socPath = buildPath(points, (p) =>
    scale(p.soc, socMin, socMax, height - padding, padding),
    padding,
    xStep,
  );
  const profitPath = buildPath(points, (p) =>
    scale(p.cumulativeProfit, profitMin, profitMax, height - padding, padding),
    padding,
    xStep,
  );
  const baselinePath =
    baseline && baseline.length
      ? buildPath(baseline, (p) =>
          scale(p.cumulativeProfit, baseMin, baseMax, height - padding, padding),
        padding,
        xStep,
      )
      : "";

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX =
    hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  const overlaySegments = llmOverlay?.enabled
    ? buildActionSegments(points, llmResponse)
    : [];

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <defs>
          <linearGradient id="buyLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#61e4ff" />
            <stop offset="100%" stopColor="#2b8dff" />
          </linearGradient>
          <linearGradient id="sellLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#ffd36b" />
            <stop offset="100%" stopColor="#ff6b4a" />
          </linearGradient>
          <linearGradient id="socLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#d4ff80" />
            <stop offset="100%" stopColor="#21c98a" />
          </linearGradient>
          <linearGradient id="profitLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#f472b6" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="18"
          fill="rgba(15, 23, 42, 0.3)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {llmOverlay?.enabled &&
          llmOverlay.bands &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep;
            const w = Math.max(1, (seg.end - seg.start + 1) * xStep);
            return (
              <rect
                key={`band-${idx}`}
                x={x}
                y={padding}
                width={w}
                height={height - padding * 2}
                fill={actionColor(seg.action, llmOverlay.opacity)}
              />
            );
          })}
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.45)"
            strokeDasharray="4 6"
          />
        )}
        <path d={buyPath} stroke="url(#buyLine)" strokeWidth="2" fill="none" />
        <path d={sellPath} stroke="url(#sellLine)" strokeWidth="2" fill="none" />
        <path d={socPath} stroke="url(#socLine)" strokeWidth="2" fill="none" />
        <path d={profitPath} stroke="url(#profitLine)" strokeWidth="2" fill="none" />
        {baselinePath && (
          <path d={baselinePath} stroke="#facc15" strokeWidth="2" fill="none" strokeDasharray="6 4" />
        )}
        {llmOverlay?.enabled &&
          llmOverlay.arrows &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep + 6;
            const y = padding + 12;
            return (
              <text
                key={`arrow-${idx}`}
                x={x}
                y={y}
                fill={actionColor(seg.action, 1)}
                fontSize="12"
              >
                {seg.action === "buy" ? "▲" : seg.action === "sell" ? "▼" : "•"}
              </text>
            );
          })}
      </svg>
      <div className="legend">
        <span className="legend-item">
          <i className="dot buy" /> Buy price
        </span>
        <span className="legend-item">
          <i className="dot sell" /> Sell price
        </span>
        <span className="legend-item">
          <i className="dot soc" /> SOC
        </span>
        <span className="legend-item">
          <i className="dot profit" /> Profit
        </span>
        {baselinePath && (
          <span className="legend-item">
            <i className="dot baseline" /> Baseline
          </span>
        )}
      </div>
      {hoverPoint && (
        <div className="tooltip">
          <span className="mono">{new Date(hoverPoint.time).toISOString()}</span>
          <span>Buy: {hoverPoint.buy.toFixed(2)} c</span>
          <span>Sell: {hoverPoint.sell.toFixed(2)} c</span>
          <span>SOC: {hoverPoint.soc.toFixed(2)} kWh</span>
          <span>P/L: {hoverPoint.cumulativeProfit.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

export function CompareChart({
  left,
  right,
  winner,
  baseline,
  baselineLabel,
  llmOverlay,
  llmResponse,
}: {
  left: StrategyResult;
  right: StrategyResult;
  winner: string;
  baseline?: BacktestPoint[];
  baselineLabel?: string;
  llmOverlay?: {
    enabled: boolean;
    bands: boolean;
    arrows: boolean;
    opacity: number;
  };
  llmResponse?: string;
}) {
  const width = 860;
  const height = 260;
  const padding = 32;
  const maxLen = Math.min(left.points.length, right.points.length);
  const leftPoints = left.points.slice(0, maxLen);
  const rightPoints = right.points.slice(0, maxLen);
  const baselinePoints = baseline ? baseline.slice(0, maxLen) : null;
  const values = [
    ...leftPoints,
    ...rightPoints,
    ...(baselinePoints ?? []),
  ].map((p) => p.cumulativeProfit);
  const [min, max] = rangeValues(values);
  const xStep = (width - padding * 2) / (maxLen - 1 || 1);
  const leftPath = leftPoints
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.cumulativeProfit, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const rightPath = rightPoints
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.cumulativeProfit, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const leftColor = left.name === winner ? "#34d399" : "#60a5fa";
  const rightColor = right.name === winner ? "#34d399" : "#f97316";
  const baselinePath =
    baselinePoints && baselinePoints.length
      ? baselinePoints
          .map((p, i) => {
            const x = padding + i * xStep;
            const y = scale(p.cumulativeProfit, min, max, height - padding, padding);
            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
          })
          .join(" ")
      : "";
  const overlaySegments = llmOverlay?.enabled
    ? buildActionSegments(leftPoints, llmResponse)
    : [];
  return (
    <div className="chart compare-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="18"
          fill="rgba(15, 23, 42, 0.3)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {llmOverlay?.enabled &&
          llmOverlay.bands &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep;
            const w = Math.max(1, (seg.end - seg.start + 1) * xStep);
            return (
              <rect
                key={`cmp-band-${idx}`}
                x={x}
                y={padding}
                width={w}
                height={height - padding * 2}
                fill={actionColor(seg.action, llmOverlay.opacity)}
              />
            );
          })}
        <path d={leftPath} stroke={leftColor} strokeWidth="2.5" fill="none" />
        <path d={rightPath} stroke={rightColor} strokeWidth="2.5" fill="none" />
        {baselinePath && (
          <path d={baselinePath} stroke="#facc15" strokeWidth="2" fill="none" strokeDasharray="6 4" />
        )}
        {llmOverlay?.enabled &&
          llmOverlay.arrows &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep + 6;
            const y = padding + 12;
            return (
              <text
                key={`cmp-arrow-${idx}`}
                x={x}
                y={y}
                fill={actionColor(seg.action, 1)}
                fontSize="12"
              >
                {seg.action === "buy" ? "▲" : seg.action === "sell" ? "▼" : "•"}
              </text>
            );
          })}
        <text x={12} y={16} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={12} y={height - 8} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      <div className="legend">
        <span className="legend-item">
          <i className="dot" style={{ background: leftColor }} /> {left.name}
        </span>
        <span className="legend-item">
          <i className="dot" style={{ background: rightColor }} /> {right.name}
        </span>
        {baselinePath && (
          <span className="legend-item">
            <i className="dot baseline" /> {baselineLabel || "Baseline"}
          </span>
        )}
      </div>
    </div>
  );
}

export function LineChart({
  points,
  dataKey,
  color,
  label,
}: {
  points: BacktestPoint[];
  dataKey: "cumulativeProfit" | "soc";
  color: string;
  label: string;
}) {
  const width = 420;
  const height = 220;
  const padding = 32;
  const values = points.map((p) => p[dataKey]);
  const [min, max] = rangeValues(values);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p[dataKey], min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="14"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.5)"
            strokeDasharray="4 6"
          />
        )}
        <path d={path} stroke={color} strokeWidth="2.5" fill="none" />
        <text x={10} y={18} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={10} y={height - 8} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      {hoverPoint && (
        <div className="mini-tooltip">
          <span className="mono">{hoverPoint.time}</span>
          <span>{label}: {hoverPoint[dataKey].toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

type KDEPoint = { x: number; y: number };

type BoxStats = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
};

export function KdeBoxPlot({ buy, sell }: { buy: number[]; sell: number[] }) {
  const buyStats = boxStats(buy);
  const sellStats = boxStats(sell);
  const buyKde = kdeEstimate(buy, 60);
  const sellKde = kdeEstimate(sell, 60);
  return (
    <div className="kde-grid">
      <div className="panel inset">
        <h4>Buy distribution</h4>
        <KDEChart points={buyKde} color="#38bdf8" />
        <BoxPlot stats={buyStats} color="#38bdf8" />
      </div>
      <div className="panel inset">
        <h4>Sell distribution</h4>
        <KDEChart points={sellKde} color="#facc15" />
        <BoxPlot stats={sellStats} color="#facc15" />
      </div>
    </div>
  );
}

function KDEChart({ points, color }: { points: KDEPoint[]; color: string }) {
  const width = 320;
  const height = 120;
  const padding = 18;
  const values = points.map((p) => p.y);
  const [minY, maxY] = rangeValues(values.length ? values : [0, 1]);
  const path = points
    .map((point, idx) => {
      const x = padding + (idx / (points.length - 1 || 1)) * (width - padding * 2);
      const y = scale(point.y, minY, maxY, height - padding, padding);
      return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="120">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="12"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      <path d={path} stroke={color} strokeWidth="2" fill="none" />
    </svg>
  );
}

function BoxPlot({ stats, color }: { stats: BoxStats; color: string }) {
  const width = 320;
  const height = 70;
  const padding = 18;
  const [min, max] = rangeValues([stats.min, stats.max]);
  const scaleX = (value: number) => scale(value, min, max, padding, width - padding);
  const x1 = scaleX(stats.min);
  const x2 = scaleX(stats.max);
  const boxStart = scaleX(stats.q1);
  const boxEnd = scaleX(stats.q3);
  const median = scaleX(stats.median);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="70">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="12"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      <line x1={x1} x2={x2} y1={height / 2} y2={height / 2} stroke={color} strokeWidth="2" />
      <rect
        x={boxStart}
        y={height / 2 - 12}
        width={Math.max(2, boxEnd - boxStart)}
        height={24}
        fill={`${color}33`}
        stroke={color}
        strokeWidth="1.5"
      />
      <line x1={median} x2={median} y1={height / 2 - 14} y2={height / 2 + 14} stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function ForecastPanel({ forecasts }: { forecasts: { buy: number[]; sell: number[]; profit: number[] } }) {
  const width = 420;
  const height = 180;
  const padding = 24;
  const values = forecasts.profit;
  if (!values.length) return <div className="empty">No forecast data.</div>;
  const [min, max] = rangeValues(values);
  const xStep = (width - padding * 2) / (values.length - 1 || 1);
  const path = values
    .map((value, i) => {
      const x = padding + i * xStep;
      const y = scale(value, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        <path d={path} stroke="#38bdf8" strokeWidth="2" fill="none" />
      </svg>
    </div>
  );
}

export function WeatherChart({
  points,
  label,
  overlay,
  overlayLabel,
  shade,
  shadeLabel,
  width = 420,
  height = 200,
}: {
  points: WeatherPoint[];
  label: string;
  overlay?: WeatherPoint[];
  overlayLabel?: string;
  shade?: WeatherPoint[];
  shadeLabel?: string;
  width?: number;
  height?: number;
}) {
  const padding = 24;
  const temps = points.map((p) => p.value);
  const overlayTemps = overlay ? overlay.map((p) => p.value) : [];
  const allTemps = temps.concat(overlayTemps);
  const [min, max] = rangeValues(allTemps.length ? allTemps : temps);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.value, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const overlayPath =
    overlay && overlay.length
      ? overlay
          .map((p, i) => {
            const x = padding + i * xStep;
            const y = scale(p.value, min, max, height - padding, padding);
            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
          })
          .join(" ")
      : "";
  const shadeValues = shade ? shade.map((p) => p.value) : [];
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverOverlay = hoverIndex !== null && overlay ? overlay[hoverIndex] : null;
  const hoverShade = hoverIndex !== null && shade ? shade[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {shadeValues.length > 0 &&
          shadeValues.map((value, idx) => {
            const x = padding + idx * xStep;
            const w = Math.max(1, xStep + 0.5);
            const alpha = Math.min(0.6, Math.max(0, value * 0.6));
            return (
              <rect
                key={`shade-${idx}`}
                x={x}
                y={padding}
                width={w}
                height={height - padding * 2}
                fill={`rgba(56, 189, 248, ${alpha})`}
              />
            );
          })}
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.45)"
            strokeDasharray="4 6"
          />
        )}
        <path d={path} stroke="#22d3ee" strokeWidth="2" fill="none" />
        {overlayPath && (
          <path
            d={overlayPath}
            stroke="#facc15"
            strokeWidth="2"
            fill="none"
            strokeDasharray="5 4"
          />
        )}
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      {hoverPoint && (
        <div className="mini-tooltip">
          <span className="mono">{hoverPoint.time}</span>
          <span>{label}: {hoverPoint.value.toFixed(2)}</span>
          {hoverOverlay && overlayLabel && (
            <span>{overlayLabel}: {hoverOverlay.value.toFixed(2)}</span>
          )}
          {hoverShade && (
            <span>Cloud cover: {(hoverShade.value * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
      {shadeLabel && shadeValues.length > 0 && (
        <div className="legend">
          <span className="legend-item">
            <i className="dot" style={{ background: "rgba(56, 189, 248, 0.7)" }} /> {shadeLabel}
          </span>
        </div>
      )}
    </div>
  );
}

export function SolarDailyChart({
  points,
  width = 420,
  height = 200,
}: {
  points: DailySolarPoint[];
  width?: number;
  height?: number;
}) {
  const padding = 28;
  if (!points.length) {
    return <div className="empty">No solar data.</div>;
  }
  const maxVal = Math.max(
    ...points.map((p) => Math.max(p.simulatedKwh, p.actualKwh ?? 0)),
    1,
  );
  const barWidth = (width - padding * 2) / points.length;
  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {points.map((point, i) => {
          const x = padding + i * barWidth + 4;
          const simHeight = (point.simulatedKwh / maxVal) * (height - padding * 2);
          const actHeight = point.actualKwh
            ? (point.actualKwh / maxVal) * (height - padding * 2)
            : 0;
          const ySim = height - padding - simHeight;
          const yAct = height - padding - actHeight;
          return (
            <g key={point.date}>
              <rect
                x={x}
                y={ySim}
                width={Math.max(6, barWidth * 0.45)}
                height={simHeight}
                fill="rgba(34, 211, 238, 0.7)"
                rx="4"
              />
              {point.actualKwh !== null && (
                <rect
                  x={x + Math.max(8, barWidth * 0.5)}
                  y={yAct}
                  width={Math.max(6, barWidth * 0.45)}
                  height={actHeight}
                  fill="rgba(250, 204, 21, 0.75)"
                  rx="4"
                />
              )}
            </g>
          );
        })}
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {maxVal.toFixed(1)} kWh
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          0
        </text>
      </svg>
      <div className="legend">
        <span className="legend-item">
          <i className="dot" style={{ background: "#22d3ee" }} /> Simulated kWh/day
        </span>
        <span className="legend-item">
          <i className="dot baseline" /> Actual feed-in kWh/day
        </span>
      </div>
    </div>
  );
}

export function ActionTimelineChart({ points }: { points: Array<{ time: string; action: string }> }) {
  const width = 420;
  const height = 80;
  const padding = 10;
  const step = (width - padding * 2) / (points.length || 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="12"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      {points.map((point, idx) => (
        <rect
          key={`${point.time}-${idx}`}
          x={padding + idx * step}
          y={padding}
          width={Math.max(2, step)}
          height={height - padding * 2}
          fill={actionColor(point.action, 0.45)}
        />
      ))}
    </svg>
  );
}

export function ActionPieChart({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((acc, v) => acc + v, 0) || 1;
  const entries = [
    { key: "buy", color: actionColor("buy", 0.8) },
    { key: "sell", color: actionColor("sell", 0.8) },
    { key: "hold", color: actionColor("hold", 0.8) },
  ].map((entry) => ({ ...entry, value: counts[entry.key] || 0 }));
  let start = 0;
  const cx = 70;
  const cy = 70;
  const r = 52;
  const paths = entries.map((entry) => {
    const angle = (entry.value / total) * Math.PI * 2;
    const end = start + angle;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    start = end;
    return { d, color: entry.color };
  });
  return (
    <div className="pie-wrap">
      <svg viewBox="0 0 140 140" width="100%" height="140">
        {paths.map((path, idx) => (
          <path key={idx} d={path.d} fill={path.color} />
        ))}
      </svg>
      <div className="legend">
        {entries.map((entry) => (
          <span key={entry.key} className="legend-item">
            <i className="dot" style={{ background: entry.color }} /> {entry.key}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ConfidenceChart({ values }: { values: Array<number | null> }) {
  const width = 420;
  const height = 140;
  const padding = 18;
  const filled = values.filter((v): v is number => v !== null);
  if (!filled.length) {
    return <div className="empty">No confidence data.</div>;
  }
  const xStep = (width - padding * 2) / (values.length - 1 || 1);
  const path = values
    .map((value, idx) => {
      const v = value ?? 0;
      const x = padding + idx * xStep;
      const y = height - padding - v * (height - padding * 2);
      return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="12"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      <path d={path} stroke="#38bdf8" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function ProfitCompareChart({
  llmProfit,
  baseProfit,
}: {
  llmProfit: number;
  baseProfit: number;
}) {
  const width = 420;
  const height = 140;
  const padding = 24;
  const maxVal = Math.max(Math.abs(llmProfit), Math.abs(baseProfit), 1);
  const barWidth = 120;
  const llmHeight = (Math.abs(llmProfit) / maxVal) * (height - padding * 2);
  const baseHeight = (Math.abs(baseProfit) / maxVal) * (height - padding * 2);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="12"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      <rect
        x={padding + 40}
        y={height - padding - llmHeight}
        width={barWidth}
        height={llmHeight}
        fill="rgba(34, 197, 94, 0.7)"
        rx="6"
      />
      <rect
        x={padding + 200}
        y={height - padding - baseHeight}
        width={barWidth}
        height={baseHeight}
        fill="rgba(148, 163, 184, 0.6)"
        rx="6"
      />
      <text x={padding + 60} y={height - 6} fill="#cbd5f5" fontSize="10">
        LLM
      </text>
      <text x={padding + 220} y={height - 6} fill="#cbd5f5" fontSize="10">
        Base
      </text>
      <text x={padding + 55} y={padding + 12} fill="#cbd5f5" fontSize="10">
        {llmProfit.toFixed(2)}
      </text>
      <text x={padding + 215} y={padding + 12} fill="#cbd5f5" fontSize="10">
        {baseProfit.toFixed(2)}
      </text>
    </svg>
  );
}

function kdeEstimate(values: number[], steps: number): KDEPoint[] {
  if (!values.length) return [];
  const [min, max] = rangeValues(values);
  const bandwidth = (max - min || 1) / 10;
  const points: KDEPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const x = min + ((max - min) * i) / (steps - 1 || 1);
    const y =
      values.reduce((acc, v) => acc + gaussian((x - v) / bandwidth), 0) /
      (values.length * bandwidth);
    points.push({ x, y });
  }
  return points;
}

function gaussian(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function boxStats(values: number[]): BoxStats {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx] ?? 0;
  };
  return {
    min: sorted[0] ?? 0,
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function buildPath(
  points: BacktestPoint[],
  calcY: (point: BacktestPoint) => number,
  padding: number,
  step: number,
) {
  return points
    .map((point, i) => {
      const x = padding + i * step;
      const y = calcY(point);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}
