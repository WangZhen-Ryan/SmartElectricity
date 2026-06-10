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
          const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
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
  actualUsage,
  baselineLabel,
  actualUsageLabel,
  llmOverlay,
  llmResponse,
}: {
  left: StrategyResult;
  right: StrategyResult;
  winner: string;
  baseline?: BacktestPoint[];
  actualUsage?: BacktestPoint[] | null;
  baselineLabel?: string;
  actualUsageLabel?: string;
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
  const actualUsagePoints = actualUsage ? actualUsage.slice(0, maxLen) : null;
  const leftValues = leftPoints.map((p) => p.cumulativeProfit);
  const rightValues = rightPoints.map((p) => p.cumulativeProfit);
  const leftStats = movingStats(leftValues, 12);
  const rightStats = movingStats(rightValues, 12);
  const [min, max] = rangeValues([
    ...leftStats.lower,
    ...leftStats.upper,
    ...rightStats.lower,
    ...rightStats.upper,
    ...(baselinePoints ?? []).map((p) => p.cumulativeProfit),
    ...(actualUsagePoints ?? []).map((p) => p.cumulativeProfit),
  ]);
  const xStep = (width - padding * 2) / (maxLen - 1 || 1);
  const mid = (min + max) / 2;
  const yTop = scale(max, min, max, height - padding, padding);
  const yMid = scale(mid, min, max, height - padding, padding);
  const yBottom = scale(min, min, max, height - padding, padding);
  const leftPath = buildSeriesPath(leftStats.mean, min, max, width, height, padding);
  const rightPath = buildSeriesPath(rightStats.mean, min, max, width, height, padding);
  const leftBand = buildBandPath(leftStats.upper, leftStats.lower, min, max, width, height, padding);
  const rightBand = buildBandPath(rightStats.upper, rightStats.lower, min, max, width, height, padding);
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
  const actualUsagePath =
    actualUsagePoints && actualUsagePoints.length
      ? actualUsagePoints
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
        <line x1={padding} x2={width - padding} y1={yTop} y2={yTop} stroke="rgba(148, 163, 184, 0.18)" />
        <line x1={padding} x2={width - padding} y1={yMid} y2={yMid} stroke="rgba(148, 163, 184, 0.12)" />
        <line x1={padding} x2={width - padding} y1={yBottom} y2={yBottom} stroke="rgba(148, 163, 184, 0.18)" />
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
        {leftBand && <path d={leftBand} fill={withAlpha(leftColor, 0.18)} stroke="none" />}
        {rightBand && <path d={rightBand} fill={withAlpha(rightColor, 0.18)} stroke="none" />}
        <path d={leftPath} stroke={leftColor} strokeWidth="2.5" fill="none" />
        <path d={rightPath} stroke={rightColor} strokeWidth="2.5" fill="none" />
        {baselinePath && (
          <path d={baselinePath} stroke="#facc15" strokeWidth="2" fill="none" strokeDasharray="6 4" />
        )}
        {actualUsagePath && (
          <path
            d={actualUsagePath}
            stroke="#f43f5e"
            strokeWidth="2.4"
            fill="none"
            strokeDasharray="2 6"
          />
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
        <text x={8} y={yTop - 6} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={8} y={yMid - 6} fill="#94a3b8" fontSize="10">
          {mid.toFixed(2)}
        </text>
        <text x={8} y={yBottom - 6} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
        <text
          x={14}
          y={height / 2}
          fill="#67e8f9"
          fontSize="10"
          textAnchor="middle"
          transform={`rotate(-90 14 ${height / 2})`}
        >
          Profit (AUD)
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
        {actualUsagePath && (
          <span className="legend-item actual-usage">
            <i className="dot actual-usage" /> {actualUsageLabel || "Actual Usage"}
          </span>
        )}
      </div>
    </div>
  );
}

export function UsageLinesChart({
  days,
}: {
  days: Array<{ date: string; importKwh: number; exportKwh: number }>;
}) {
  if (!days?.length) {
    return <div className="empty">No daily usage data available.</div>;
  }
  const width = 860;
  const height = 200;
  const padding = 32;
  const importValues = days.map((d) => d.importKwh);
  const exportValues = days.map((d) => d.exportKwh);
  const values = [...importValues, ...exportValues];
  const [min, max] = rangeValues(values.length ? values : [0, 1]);
  const xStep = (width - padding * 2) / (days.length - 1 || 1);
  const mid = (min + max) / 2;
  const yTop = scale(max, min, max, height - padding, padding);
  const yMid = scale(mid, min, max, height - padding, padding);
  const yBottom = scale(min, min, max, height - padding, padding);
  const importPath = buildSeriesPath(importValues, min, max, width, height, padding);
  const exportPath = buildSeriesPath(exportValues, min, max, width, height, padding);
  return (
    <div className="usage-lines-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="16"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        <line x1={padding} x2={width - padding} y1={yTop} y2={yTop} stroke="rgba(148, 163, 184, 0.16)" />
        <line x1={padding} x2={width - padding} y1={yMid} y2={yMid} stroke="rgba(148, 163, 184, 0.12)" />
        <line x1={padding} x2={width - padding} y1={yBottom} y2={yBottom} stroke="rgba(148, 163, 184, 0.16)" />
        <path d={importPath} stroke="#38bdf8" strokeWidth="2.6" fill="none" />
        <path d={exportPath} stroke="#facc15" strokeWidth="2.6" fill="none" />
        <text x={8} y={yTop - 6} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={8} y={yMid - 6} fill="#94a3b8" fontSize="10">
          {mid.toFixed(2)}
        </text>
        <text x={8} y={yBottom - 6} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
        <text
          x={14}
          y={height / 2}
          fill="#67e8f9"
          fontSize="10"
          textAnchor="middle"
          transform={`rotate(-90 14 ${height / 2})`}
        >
          Energy (kWh)
        </text>
      </svg>
      <div className="legend">
        <span className="legend-item actual-usage">
          <i className="dot buy" /> Grid import
        </span>
        <span className="legend-item">
          <i className="dot baseline" /> Feed-in export
        </span>
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
  const stats = movingStats(values, 12);
  const [min, max] = rangeValues([...stats.lower, ...stats.upper]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const path = buildSeriesPath(stats.mean, min, max, width, height, padding);
  const bandPath = buildBandPath(stats.upper, stats.lower, min, max, width, height, padding);
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
        {bandPath && (
          <path d={bandPath} fill={withAlpha(color, 0.22)} stroke="none" />
        )}
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
  onRangeSelect,
  width = 420,
  height = 200,
}: {
  points: WeatherPoint[];
  label: string;
  overlay?: WeatherPoint[];
  overlayLabel?: string;
  shade?: WeatherPoint[];
  shadeLabel?: string;
  onRangeSelect?: (range: [number, number] | null) => void;
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
  const [dragStart, setDragStart] = useState<number | null>(null);
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
  const selection =
    dragStart !== null && hoverIndex !== null
      ? [Math.min(dragStart, hoverIndex), Math.max(dragStart, hoverIndex)]
      : null;
  const formatLabel = (time: string) =>
    new Date(time).toLocaleString("en-AU", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
        onMouseDown={(event) => {
          if (!onRangeSelect) return;
          const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setDragStart(index);
          }
        }}
        onMouseUp={() => {
          if (!onRangeSelect || dragStart === null || hoverIndex === null) return;
          const start = Math.min(dragStart, hoverIndex);
          const end = Math.max(dragStart, hoverIndex);
          onRangeSelect(start === end ? null : [start, end]);
          setDragStart(null);
        }}
        onDoubleClick={() => {
          if (onRangeSelect) onRangeSelect(null);
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
        {selection && (
          <rect
            x={padding + selection[0] * xStep}
            y={padding}
            width={(selection[1] - selection[0] + 1) * xStep}
            height={height - padding * 2}
            fill="rgba(56, 189, 248, 0.12)"
          />
        )}
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
        {points.length > 1 && (
          <>
            <text x={padding} y={height - 6} fill="#94a3b8" fontSize="10">
              {formatLabel(points[0].time)}
            </text>
            <text x={width / 2 - 40} y={height - 6} fill="#94a3b8" fontSize="10">
              {formatLabel(points[Math.floor(points.length / 2)].time)}
            </text>
            <text x={width - padding - 80} y={height - 6} fill="#94a3b8" fontSize="10">
              {formatLabel(points[points.length - 1].time)}
            </text>
          </>
        )}
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

export function SolarForecastHeroChart({
  actual,
  forecast,
  clearSky,
  providerLabel,
  trustLabel,
  markerIndex,
  width = 860,
  height = 280,
}: {
  actual: WeatherPoint[];
  forecast?: WeatherPoint[] | null;
  clearSky?: WeatherPoint[] | null;
  providerLabel: string;
  trustLabel: string;
  markerIndex?: number | null;
  width?: number;
  height?: number;
}) {
  const padding = 34;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  if (!actual.length) {
    return <div className="empty">Load solar inputs to render forecast band.</div>;
  }
  const seriesLen = actual.length;
  const safeForecast = forecast?.length ? forecast.slice(0, seriesLen) : [];
  const safeClearSky = clearSky?.length ? clearSky.slice(0, seriesLen) : [];
  const values = [
    ...actual.map((p) => p.value),
    ...safeForecast.map((p) => p.value),
    ...safeClearSky.map((p) => p.value),
  ];
  const [min, max] = rangeValues(values.length ? values : [0, 1]);
  const xStep = (width - padding * 2) / (seriesLen - 1 || 1);
  const yOf = (value: number) => scale(value, min, max, height - padding, padding);
  const actualPath = actual
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${padding + idx * xStep} ${yOf(point.value)}`)
    .join(" ");
  const forecastPath = safeForecast.length
    ? safeForecast
        .map((point, idx) => `${idx === 0 ? "M" : "L"} ${padding + idx * xStep} ${yOf(point.value)}`)
        .join(" ")
    : "";
  const upper = actual.map((point, idx) => {
    const base = safeForecast[idx]?.value ?? point.value;
    const clear = safeClearSky[idx]?.value ?? base;
    return Math.max(base, Math.min(clear, base + Math.max(0, clear - base) * 0.8));
  });
  const lower = actual.map((point, idx) => {
    const base = safeForecast[idx]?.value ?? point.value;
    return Math.max(0, base * 0.45);
  });
  const bandPath = upper.length
    ? [
        ...upper.map((value, idx) => `${idx === 0 ? "M" : "L"} ${padding + idx * xStep} ${yOf(value)}`),
        ...lower
          .map((value, idx) => {
            const revIdx = lower.length - 1 - idx;
            return `L ${padding + revIdx * xStep} ${yOf(lower[revIdx])}`;
          }),
        "Z",
      ].join(" ")
    : "";
  const safeMarkerIndex =
    markerIndex === null || markerIndex === undefined
      ? Math.max(0, actual.length - Math.min(12, actual.length))
      : Math.max(0, Math.min(actual.length - 1, markerIndex));
  const hoverPoint = hoverIndex !== null ? actual[hoverIndex] : null;
  const hoverForecast = hoverIndex !== null ? safeForecast[hoverIndex] : null;
  const hoverClear = hoverIndex !== null ? safeClearSky[hoverIndex] : null;
  const formatLabel = (time: string) =>
    new Date(time).toLocaleString("en-AU", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div className="mini-chart solar-hero-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < actual.length) setHoverIndex(index);
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
        <line
          x1={padding + safeMarkerIndex * xStep}
          x2={padding + safeMarkerIndex * xStep}
          y1={padding}
          y2={height - padding}
          stroke="rgba(148, 163, 184, 0.35)"
          strokeDasharray="4 4"
        />
        <text
          x={Math.max(60, padding + safeMarkerIndex * xStep - 24)}
          y={padding - 8}
          fill="rgba(148, 163, 184, 0.9)"
          fontSize="10"
        >
          Latest estimate
        </text>
        {bandPath ? <path d={bandPath} fill="rgba(226, 232, 240, 0.12)" stroke="none" /> : null}
        {safeClearSky.length ? (
          <path
            d={safeClearSky
              .map(
                (point, idx) =>
                  `${idx === 0 ? "M" : "L"} ${padding + idx * xStep} ${yOf(point.value)}`,
              )
              .join(" ")}
            stroke="rgba(226, 232, 240, 0.22)"
            strokeWidth="1.5"
            fill="none"
            strokeDasharray="3 5"
          />
        ) : null}
        <path d={actualPath} stroke="#f59e0b" strokeWidth="2.2" fill="none" />
        {forecastPath ? <path d={forecastPath} stroke="#fb923c" strokeWidth="1.7" fill="none" /> : null}
        {hoverIndex !== null ? (
          <circle
            cx={padding + hoverIndex * xStep}
            cy={yOf(actual[hoverIndex].value)}
            r={4}
            fill="#f59e0b"
          />
        ) : null}
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {max.toFixed(1)} kW
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          {min.toFixed(1)} kW
        </text>
        <text x={width - 160} y={18} fill="#f59e0b" fontSize="10">
          {providerLabel}
        </text>
        <text x={width - 160} y={32} fill="#94a3b8" fontSize="10">
          {trustLabel}
        </text>
      </svg>
      {(hoverPoint || hoverForecast || hoverClear) && (
        <div className="mini-tooltip">
          {hoverPoint ? <span className="mono">{formatLabel(hoverPoint.time)}</span> : null}
          {hoverPoint ? <span>Live/actual: {hoverPoint.value.toFixed(2)} kW</span> : null}
          {hoverForecast ? <span>Forecast: {hoverForecast.value.toFixed(2)} kW</span> : null}
          {hoverClear ? <span>Clear sky cap: {hoverClear.value.toFixed(2)} kW</span> : null}
        </div>
      )}
      <div className="legend">
        <span className="legend-item">
          <i className="dot" style={{ background: "#f59e0b" }} /> Live / simulated
        </span>
        <span className="legend-item">
          <i className="dot" style={{ background: "#fb923c" }} /> Forecast
        </span>
        <span className="legend-item">
          <i className="dot" style={{ background: "rgba(226, 232, 240, 0.5)" }} /> 90/10 band
        </span>
      </div>
    </div>
  );
}

export function SolarDailyChart({
  points,
  forecastLabel = "Forecast kWh/day",
  actualLabel = "Actual feed-in kWh/day",
  width = 420,
  height = 200,
}: {
  points: DailySolarPoint[];
  forecastLabel?: string;
  actualLabel?: string;
  width?: number;
  height?: number;
}) {
  const padding = 28;
  if (!points.length) {
    return <div className="empty">No solar data.</div>;
  }
  const isWide = width >= 700;
  const maxVal = Math.max(
    ...points.map((p) => Math.max(p.simulatedKwh, p.actualKwh ?? 0)),
    1,
  );
  const avgForecast =
    points.reduce((acc, point) => acc + point.simulatedKwh, 0) / points.length;
  const actualPoints = points.filter((point) => point.actualKwh !== null);
  const avgActual = actualPoints.length
    ? actualPoints.reduce((acc, point) => acc + (point.actualKwh ?? 0), 0) / actualPoints.length
    : null;
  const biasPct =
    avgActual !== null && avgForecast > 0 ? ((avgActual - avgForecast) / avgForecast) * 100 : null;
  const latestPoint = [...points].reverse().find((point) => point.actualKwh !== null) ?? points[points.length - 1];
  const latestDeltaPct =
    latestPoint.actualKwh !== null && latestPoint.simulatedKwh > 0
      ? ((latestPoint.actualKwh - latestPoint.simulatedKwh) / latestPoint.simulatedKwh) * 100
      : null;
  const peakForecastPoint = points.reduce((best, point) =>
    point.simulatedKwh > best.simulatedKwh ? point : best,
  );
  const peakActualPoint =
    actualPoints.length > 0
      ? actualPoints.reduce((best, point) =>
          (point.actualKwh ?? 0) > (best.actualKwh ?? 0) ? point : best,
        )
      : null;
  const barWidth = (width - padding * 2) / points.length;
  return (
    <div className={`mini-chart solar-daily-shell ${isWide ? "wide" : ""}`}>
      <div className="solar-daily-head">
        <div className="solar-daily-pill">
          <span className="mono">Forecast Avg</span>
          <strong>{avgForecast.toFixed(1)} kWh</strong>
        </div>
        <div className="solar-daily-pill">
          <span className="mono">Actual Avg</span>
          <strong>{avgActual !== null ? `${avgActual.toFixed(1)} kWh` : "—"}</strong>
        </div>
        <div className={`solar-daily-pill ${biasPct === null ? "" : biasPct >= 0 ? "good" : "bad"}`}>
          <span className="mono">Bias</span>
          <strong>
            {biasPct === null ? "—" : `${biasPct >= 0 ? "+" : ""}${biasPct.toFixed(0)}%`}
          </strong>
        </div>
      </div>
      <div className="solar-daily-layout">
        <div className="solar-daily-canvas">
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
            <line
              x1={padding}
              x2={width - padding}
              y1={height - padding - (avgForecast / maxVal) * (height - padding * 2)}
              y2={height - padding - (avgForecast / maxVal) * (height - padding * 2)}
              stroke="rgba(56, 189, 248, 0.3)"
              strokeDasharray="5 4"
            />
            {avgActual !== null ? (
              <line
                x1={padding}
                x2={width - padding}
                y1={height - padding - (avgActual / maxVal) * (height - padding * 2)}
                y2={height - padding - (avgActual / maxVal) * (height - padding * 2)}
                stroke="rgba(250, 204, 21, 0.28)"
                strokeDasharray="3 4"
              />
            ) : null}
            {points.map((point, i) => {
              const x = padding + i * barWidth + 4;
              const usableHeight = height - padding * 2;
              const simHeight = (point.simulatedKwh / maxVal) * usableHeight;
              const actHeight = point.actualKwh
                ? ((point.actualKwh ?? 0) / maxVal) * usableHeight
                : 0;
              const ySim = height - padding - simHeight;
              const yAct = height - padding - actHeight;
              const centerX = x + Math.max(8, barWidth * 0.48);
              const isLatest = point.date === latestPoint.date;
              return (
                <g key={point.date}>
                  <rect
                    x={x - 2}
                    y={padding}
                    width={Math.max(20, barWidth - 6)}
                    height={usableHeight}
                    fill={i % 2 === 0 ? "rgba(148, 163, 184, 0.02)" : "rgba(148, 163, 184, 0.04)"}
                    rx="8"
                  />
                  <rect
                    x={x}
                    y={ySim}
                    width={Math.max(6, barWidth * 0.42)}
                    height={simHeight}
                    fill={isLatest ? "rgba(34, 211, 238, 0.92)" : "rgba(34, 211, 238, 0.7)"}
                    rx="4"
                  />
                  {point.actualKwh !== null ? (
                    <rect
                      x={x + Math.max(8, barWidth * 0.5)}
                      y={yAct}
                      width={Math.max(6, barWidth * 0.42)}
                      height={actHeight}
                      fill={isLatest ? "rgba(250, 204, 21, 0.9)" : "rgba(250, 204, 21, 0.75)"}
                      rx="4"
                    />
                  ) : null}
                  {isLatest ? (
                    <circle
                      cx={centerX}
                      cy={Math.max(18, Math.min(ySim, yAct || ySim) - 8)}
                      r="4"
                      fill="#f8fafc"
                    />
                  ) : null}
                  <text
                    x={centerX}
                    y={height - 10}
                    fill="#94a3b8"
                    fontSize="9"
                    textAnchor="middle"
                  >
                    {new Date(point.date).toLocaleDateString("en-AU", {
                      month: "short",
                      day: "numeric",
                    })}
                  </text>
                </g>
              );
            })}
            <text x={10} y={16} fill="#94a3b8" fontSize="10">
              {maxVal.toFixed(1)} kWh
            </text>
            <text x={10} y={height - 6} fill="#94a3b8" fontSize="10">
              0.0
            </text>
          </svg>
        </div>
        <div className="solar-daily-side">
          <div className="solar-daily-side-card">
            <span className="mono">Latest Day</span>
            <strong>{new Date(latestPoint.date).toLocaleDateString("en-AU", { month: "short", day: "numeric" })}</strong>
            <span className="hint">
              F {latestPoint.simulatedKwh.toFixed(1)} kWh
              {latestPoint.actualKwh !== null ? ` · A ${latestPoint.actualKwh.toFixed(1)} kWh` : ""}
            </span>
          </div>
          <div className={`solar-daily-side-card ${latestDeltaPct === null ? "" : latestDeltaPct >= 0 ? "good" : "bad"}`}>
            <span className="mono">Latest Delta</span>
            <strong>
              {latestDeltaPct === null ? "—" : `${latestDeltaPct >= 0 ? "+" : ""}${latestDeltaPct.toFixed(0)}%`}
            </strong>
            <span className="hint">Actual versus forecast</span>
          </div>
          <div className="solar-daily-side-card">
            <span className="mono">Peak Forecast</span>
            <strong>{peakForecastPoint.simulatedKwh.toFixed(1)} kWh</strong>
            <span className="hint">
              {new Date(peakForecastPoint.date).toLocaleDateString("en-AU", { month: "short", day: "numeric" })}
            </span>
          </div>
          <div className="solar-daily-side-card">
            <span className="mono">Peak Actual</span>
            <strong>{peakActualPoint?.actualKwh !== null && peakActualPoint?.actualKwh !== undefined ? `${peakActualPoint.actualKwh.toFixed(1)} kWh` : "—"}</strong>
            <span className="hint">
              {peakActualPoint
                ? new Date(peakActualPoint.date).toLocaleDateString("en-AU", { month: "short", day: "numeric" })
                : "Awaiting Amber actuals"}
            </span>
          </div>
        </div>
      </div>
      <div className="legend">
        <span className="legend-item">
          <i className="dot" style={{ background: "#22d3ee" }} /> {forecastLabel}
        </span>
        <span className="legend-item">
          <i className="dot baseline" /> {actualLabel}
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

export function RewardCurveChart({ values }: { values: number[] }) {
  const width = 640;
  const height = 220;
  const padding = 32;
  if (!values.length) return <div className="empty">No reward data.</div>;
  const stats = movingStats(values, 10);
  const [min, max] = rangeValues([...stats.lower, ...stats.upper]);
  const linePath = buildSeriesPath(stats.mean, min, max, width, height, padding);
  const bandPath = buildBandPath(stats.upper, stats.lower, min, max, width, height, padding);
  const avg = values.reduce((acc, v) => acc + v, 0) / (values.length || 1);
  const best = Math.max(...values);
  const avgY = scale(avg, min, max, height - padding, padding);
  const bestY = scale(best, min, max, height - padding, padding);
  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="14"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {bandPath && <path d={bandPath} fill="rgba(56, 189, 248, 0.22)" stroke="none" />}
        <path d={linePath} stroke="#38bdf8" strokeWidth="2.5" fill="none" />
        <line
          x1={padding}
          x2={width - padding}
          y1={avgY}
          y2={avgY}
          stroke="rgba(148, 163, 184, 0.5)"
          strokeDasharray="6 6"
        />
        <line
          x1={padding}
          x2={width - padding}
          y1={bestY}
          y2={bestY}
          stroke="rgba(34, 197, 94, 0.7)"
          strokeDasharray="4 4"
        />
        <text x={width - padding - 80} y={avgY - 6} fill="#cbd5f5" fontSize="10">
          Avg
        </text>
        <text x={width - padding - 80} y={bestY - 6} fill="#34d399" fontSize="10">
          Best
        </text>
        <text x={10} y={18} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={10} y={height - 8} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
    </div>
  );
}

export function RewardStatsChart({ values }: { values: number[] }) {
  const avg = values.reduce((acc, v) => acc + v, 0) / (values.length || 1);
  const best = Math.max(...values);
  const worst = Math.min(...values);
  return (
    <div className="stats">
      <div>
        <span>Avg reward</span>
        <strong>{avg.toFixed(2)}</strong>
      </div>
      <div>
        <span>Best reward</span>
        <strong>{best.toFixed(2)}</strong>
      </div>
      <div>
        <span>Worst reward</span>
        <strong>{worst.toFixed(2)}</strong>
      </div>
    </div>
  );
}

export function RewardDistributionChart({ values }: { values: number[] }) {
  const stats = boxStats(values);
  const kde = kdeEstimate(values, 60);
  return (
    <div className="panel inset">
      <KDEChart points={kde} color="#38bdf8" />
      <BoxPlot stats={stats} color="#38bdf8" />
    </div>
  );
}

export function QTableHeatmap({ qTable }: { qTable: Record<string, number[]> }) {
  const priceBins = ["neg", "low", "mid", "high", "spike"];
  const socBins = ["empty", "low", "mid", "high", "full"];
  const grid = socBins.map(() => priceBins.map(() => 0));
  const counts = socBins.map(() => priceBins.map(() => 0));
  Object.entries(qTable).forEach(([key, values]) => {
    const [priceBin, socBin] = key.split("|");
    const x = priceBins.indexOf(priceBin);
    const y = socBins.indexOf(socBin);
    if (x === -1 || y === -1) return;
    const score = Math.max(...values);
    grid[y][x] += score;
    counts[y][x] += 1;
  });
  const averaged = grid.map((row, y) =>
    row.map((value, x) => (counts[y][x] ? value / counts[y][x] : 0)),
  );
  const flat = averaged.flat();
  const max = Math.max(...flat, 1);
  const width = 420;
  const height = 240;
  const padding = 40;
  const cellW = (width - padding * 2) / priceBins.length;
  const cellH = (height - padding * 2) / socBins.length;
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
      {averaged.map((row, y) =>
        row.map((value, x) => {
          const alpha = value / max;
          return (
            <rect
              key={`${x}-${y}`}
              x={padding + x * cellW}
              y={padding + y * cellH}
              width={cellW - 4}
              height={cellH - 4}
              rx="6"
              fill={`rgba(56, 189, 248, ${0.15 + alpha * 0.75})`}
            />
          );
        }),
      )}
      {priceBins.map((label, i) => (
        <text
          key={`x-${label}`}
          x={padding + i * cellW + cellW / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="10"
        >
          {label}
        </text>
      ))}
      {socBins.map((label, i) => (
        <text
          key={`y-${label}`}
          x={8}
          y={padding + i * cellH + cellH / 2 + 4}
          fill="#94a3b8"
          fontSize="10"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

export function RLReplayChart({
  points,
  actions,
}: {
  points: Array<{ time: string; soc: number; profit: number }>;
  actions: string[];
}) {
  const width = 860;
  const height = 240;
  const padding = 32;
  const profits = points.map((p) => p.profit);
  const socs = points.map((p) => p.soc);
  const [minProfit, maxProfit] = rangeValues(profits);
  const [minSoc, maxSoc] = rangeValues(socs);
  const profitPath = buildSeriesPath(profits, minProfit, maxProfit, width, height, padding);
  const socPath = buildSeriesPath(socs, minSoc, maxSoc, width, height, padding);
  const step = (width - padding * 2) / (points.length - 1 || 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="14"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      {actions.map((action, idx) => (
        <rect
          key={`${action}-${idx}`}
          x={padding + idx * step}
          y={padding}
          width={Math.max(1, step)}
          height={height - padding * 2}
          fill={actionColor(action, 0.12)}
        />
      ))}
      <path d={profitPath} stroke="#38bdf8" strokeWidth="2.5" fill="none" />
      <path d={socPath} stroke="#a3e635" strokeWidth="2" fill="none" />
      <text x={10} y={18} fill="#94a3b8" fontSize="10">
        Profit
      </text>
      <text x={70} y={18} fill="#94a3b8" fontSize="10">
        SOC
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

function movingStats(values: number[], window: number) {
  const mean: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  const size = Math.max(1, window);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - size + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((acc, v) => acc + v, 0) / (slice.length || 1);
    const variance =
      slice.reduce((acc, v) => acc + (v - avg) ** 2, 0) / (slice.length || 1);
    const std = Math.sqrt(variance);
    mean.push(avg);
    upper.push(avg + std);
    lower.push(avg - std);
  }
  return { mean, upper, lower };
}

function buildSeriesPath(
  values: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  padding: number,
) {
  const step = (width - padding * 2) / (values.length - 1 || 1);
  return values
    .map((value, i) => {
      const x = padding + i * step;
      const y = scale(value, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function buildBandPath(
  upper: number[],
  lower: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  padding: number,
) {
  if (!upper.length || !lower.length) return "";
  const step = (width - padding * 2) / (upper.length - 1 || 1);
  const top = upper
    .map((value, i) => {
      const x = padding + i * step;
      const y = scale(value, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const bottom = lower
    .slice()
    .reverse()
    .map((value, idx) => {
      const i = lower.length - 1 - idx;
      const x = padding + i * step;
      const y = scale(value, min, max, height - padding, padding);
      return `L ${x} ${y}`;
    })
    .join(" ");
  return `${top} ${bottom} Z`;
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
