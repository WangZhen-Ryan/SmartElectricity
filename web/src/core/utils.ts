import { BacktestPoint, CustomRule } from "./types";

export function parseDsl(input: string): CustomRule[] {
  const rules: CustomRule[] = [];
  const parts = input.split(/;|\n/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(
      /(BUY|SELL)\s+when\s+(buy|sell|hour|solar|price)\s*(<=|>=|<|>)\s*([\d.]+)/i,
    );
    if (!match) continue;
    const rawField = match[2].toLowerCase();
    const field = (rawField === "price" ? "buy" : rawField) as CustomRule["field"];
    const op = match[3] as CustomRule["op"];
    const value = Number(match[4]);
    if (Number.isNaN(value)) continue;
    rules.push({ field, op, value });
  }
  return rules;
}

export function maxDrawdown(values: number[]) {
  let peak = values[0] || 0;
  let maxDd = 0;
  values.forEach((v) => {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  });
  return maxDd;
}

export function winRate(values: number[]) {
  if (values.length < 2) return 0;
  let wins = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] >= values[i - 1]) wins += 1;
  }
  return wins / (values.length - 1);
}

export function downsample(points: BacktestPoint[], maxPoints: number): BacktestPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const sampled: BacktestPoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    sampled.push(points[i]);
  }
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
}

export function rangeValues(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

export function scale(value: number, min: number, max: number, outMin: number, outMax: number) {
  if (max - min === 0) return (outMin + outMax) / 2;
  return outMax - ((value - min) / (max - min)) * (outMax - outMin);
}

export function formatProfit(value: number) {
  const abs = Math.abs(value).toFixed(2);
  return value >= 0 ? `+$${abs}` : `-$${abs}`;
}

export function formatAmberPrice(value: number) {
  const abs = Math.abs(value).toFixed(2);
  return value < 0 ? `+${abs} c/kWh` : `-${abs} c/kWh`;
}

export function formatJson(data: unknown) {
  if (!data) return "No data loaded.";
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return "Failed to render JSON.";
  }
}

export function formatTimestamp(value: string, timezone = "Australia/Canberra") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function strategyComment(profit: number, drawdown: number, winRateValue: number) {
  if (profit <= 0) return "Losing edge. Needs tuning.";
  if (drawdown > profit * 0.9) return "High risk. Consider tighter exits.";
  if (winRateValue > 0.6 && drawdown < profit * 0.4) return "Strong and stable performer.";
  if (winRateValue > 0.5) return "Solid but improvable.";
  return "Low consistency. Try different thresholds.";
}

export function countDays(points: BacktestPoint[]) {
  if (!points.length) return 0;
  const start = new Date(points[0].time);
  const end = new Date(points[points.length - 1].time);
  const startStamp = toDayStamp(start);
  const endStamp = toDayStamp(end);
  return dayDiff(startStamp, endStamp) + 1;
}

export function toDayStamp(date: Date | string | number) {
  const resolved = date instanceof Date ? date : new Date(date);
  return Date.UTC(resolved.getUTCFullYear(), resolved.getUTCMonth(), resolved.getUTCDate());
}

export function dayDiff(startStamp: number, endStamp: number) {
  const ms = endStamp - startStamp;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
