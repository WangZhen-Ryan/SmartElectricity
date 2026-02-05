import { BacktestPoint } from "../core/types";

export type ActionType = "charge" | "discharge" | "hold";

export type ReviewedPoint = BacktestPoint & {
  action: ActionType;
  deltaProfit: number;
};

export type DaySummary = {
  date: string;
  profit: number;
  maxDrawdown: number;
  avgBuy: number;
  avgSell: number;
  avgSoc: number;
  actionCounts: Record<ActionType, number>;
};

export type DayReview = {
  date: string;
  points: ReviewedPoint[];
  summary: DaySummary;
};

function dateKey(value: string) {
  return value.slice(0, 10);
}

function inferAction(prev: BacktestPoint | null, current: BacktestPoint): ActionType {
  if (!prev) return "hold";
  const delta = current.soc - prev.soc;
  if (delta > 0.01) return "charge";
  if (delta < -0.01) return "discharge";
  return "hold";
}

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 0;
  let drawdown = 0;
  values.forEach((v) => {
    if (v > peak) peak = v;
    drawdown = Math.max(drawdown, peak - v);
  });
  return drawdown;
}

export function buildDayReviews(points: BacktestPoint[]): DayReview[] {
  if (!points.length) return [];
  const groups = new Map<string, ReviewedPoint[]>();
  const sorted = [...points].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  let prev: BacktestPoint | null = null;
  sorted.forEach((point) => {
    const action = inferAction(prev, point);
    const deltaProfit = prev ? point.cumulativeProfit - prev.cumulativeProfit : 0;
    const reviewed: ReviewedPoint = { ...point, action, deltaProfit };
    const key = dateKey(point.time);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(reviewed);
    prev = point;
  });

  const reviews: DayReview[] = [];
  groups.forEach((dayPoints, key) => {
    const profits = dayPoints.map((p) => p.cumulativeProfit);
    const profit = profits.length ? profits[profits.length - 1] - profits[0] : 0;
    const avgBuy =
      dayPoints.reduce((acc, p) => acc + p.buy, 0) / Math.max(1, dayPoints.length);
    const avgSell =
      dayPoints.reduce((acc, p) => acc + p.sell, 0) / Math.max(1, dayPoints.length);
    const avgSoc =
      dayPoints.reduce((acc, p) => acc + p.soc, 0) / Math.max(1, dayPoints.length);
    const actionCounts: Record<ActionType, number> = {
      charge: 0,
      discharge: 0,
      hold: 0,
    };
    dayPoints.forEach((p) => {
      actionCounts[p.action] += 1;
    });
    reviews.push({
      date: key,
      points: dayPoints,
      summary: {
        date: key,
        profit,
        maxDrawdown: maxDrawdown(profits),
        avgBuy,
        avgSell,
        avgSoc,
        actionCounts,
      },
    });
  });

  return reviews.sort((a, b) => (a.date > b.date ? 1 : -1));
}
