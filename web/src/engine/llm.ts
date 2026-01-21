import { BacktestConfig, BacktestPoint } from "../core/types";
import { countDays } from "../core/utils";

export type LlmAction = {
  time: string;
  action: string;
  confidence?: number | null;
  reason?: string;
};

export function summarizeLlm(raw: string) {
  const empty = { action: "", confidence: null as number | null, reason: "" };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    const content =
      parsed?.choices?.[0]?.message?.content ??
      parsed?.choices?.[0]?.delta?.content ??
      parsed?.content ??
      parsed;
    if (typeof content === "string") {
      try {
        const inner = JSON.parse(content);
        if (Array.isArray(inner.actions)) {
          return summarizeActions(inner.actions);
        }
        return {
          action: String(inner.action || "").toUpperCase(),
          confidence: Number.isFinite(inner.confidence) ? Number(inner.confidence) : null,
          reason: inner.reason ? String(inner.reason) : "",
        };
      } catch {
        return { ...empty, reason: content };
      }
    }
    if (Array.isArray(content?.actions)) {
      return summarizeActions(content.actions);
    }
    return {
      action: String(content?.action || "").toUpperCase(),
      confidence: Number.isFinite(content?.confidence) ? Number(content?.confidence) : null,
      reason: content?.reason ? String(content?.reason) : "",
    };
  } catch {
    return { ...empty, reason: raw };
  }
}

function summarizeActions(actions: Array<{ action?: string; confidence?: number }>) {
  const counts = actions.reduce((acc: Record<string, number>, item) => {
    const key = (item.action || "hold").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "hold";
  const avgConfidence =
    actions.reduce(
      (acc: number, item: { confidence?: number }) =>
        acc + (Number.isFinite(item.confidence) ? Number(item.confidence) : 0),
      0,
    ) / (actions.length || 1);
  return {
    action: `${top.toUpperCase()} (hourly)`,
    confidence: Number.isFinite(avgConfidence) ? avgConfidence : null,
    reason: "Per-hour action plan from LLM.",
  };
}

export function actionColor(action: string, opacity: number) {
  const alpha = Math.min(1, Math.max(0, opacity));
  if (action === "buy") return `rgba(34, 197, 94, ${alpha})`;
  if (action === "sell") return `rgba(239, 68, 68, ${alpha})`;
  return `rgba(148, 163, 184, ${alpha})`;
}

export function parseLlmTimeline(raw: string): LlmAction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const content =
      parsed?.choices?.[0]?.message?.content ??
      parsed?.content ??
      parsed;
    const maybeJson = typeof content === "string" ? safeJson(content) : content;
    if (!maybeJson) return [];
    if (Array.isArray(maybeJson.actions)) {
      return maybeJson.actions
        .filter((item: any) => item && item.time && item.action)
        .map((item: any) => ({
          time: String(item.time),
          action: String(item.action).toLowerCase(),
          confidence: Number.isFinite(item.confidence) ? Number(item.confidence) : null,
          reason: item.reason ? String(item.reason) : "",
        }));
    }
    if (maybeJson.action) {
      return [{ time: "", action: String(maybeJson.action).toLowerCase() }];
    }
    return [];
  } catch {
    return [];
  }
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function buildActionSegments(points: BacktestPoint[], raw: string | undefined) {
  if (!points.length) return [];
  const timeline = parseLlmTimeline(raw || "");
  const hourlyFallback = timeline.length === 1 ? timeline[0].action : "hold";
  const sortedTimeline = timeline
    .filter((item) => item.time)
    .map((item) => ({ ...item, ts: new Date(item.time).getTime() }))
    .filter((item) => Number.isFinite(item.ts))
    .sort((a, b) => a.ts - b.ts);
  let cursor = 0;
  const actions = points.map((point) => {
    const ts = new Date(point.time).getTime();
    while (cursor + 1 < sortedTimeline.length && ts >= sortedTimeline[cursor + 1].ts) {
      cursor += 1;
    }
    return sortedTimeline.length ? sortedTimeline[cursor].action : hourlyFallback;
  });
  const segments: Array<{ start: number; end: number; action: string }> = [];
  let current = { start: 0, end: 0, action: actions[0] };
  for (let i = 1; i < actions.length; i += 1) {
    if (actions[i] === current.action) {
      current.end = i;
    } else {
      segments.push(current);
      current = { start: i, end: i, action: actions[i] };
    }
  }
  segments.push(current);
  return segments;
}

export function buildActionTimeline(points: BacktestPoint[], raw: string | undefined) {
  if (!points.length) return [];
  const timeline = parseLlmTimeline(raw || "");
  const sortedTimeline = timeline
    .filter((item) => item.time)
    .map((item) => ({ ...item, ts: new Date(item.time).getTime() }))
    .filter((item) => Number.isFinite(item.ts))
    .sort((a, b) => a.ts - b.ts);
  let cursor = 0;
  const fallback = timeline.length === 1 ? timeline[0] : { action: "hold", confidence: null, reason: "" };
  return points.map((point) => {
    const ts = new Date(point.time).getTime();
    while (cursor + 1 < sortedTimeline.length && ts >= sortedTimeline[cursor + 1].ts) {
      cursor += 1;
    }
    const choice = sortedTimeline.length ? sortedTimeline[cursor] : fallback;
    return {
      time: point.time,
      action: (choice.action || "hold").toLowerCase(),
      confidence: choice.confidence ?? null,
      reason: choice.reason,
    };
  });
}

export function simulatePlanProfit(
  points: BacktestPoint[],
  config: BacktestConfig,
  actions: string[],
  resolutionMinutes: number,
) {
  if (!points.length) return 0;
  const intervalHours =
    points.length > 1
      ? Math.abs(
          (new Date(points[1].time).getTime() - new Date(points[0].time).getTime()) /
            (1000 * 60 * 60),
        )
      : resolutionMinutes / 60;
  const maxPower = Math.min(config.maxPowerKw, config.inverterMaxKw);
  const energyLimit = maxPower * intervalHours;
  let soc = config.startSoc;
  let cash = 0;
  points.forEach((point, idx) => {
    const action = actions[idx] || "hold";
    if (action === "buy") {
      const charge = Math.min(energyLimit, config.capacityKwh - soc);
      soc += charge;
      cash -= charge * point.buy / 100;
    } else if (action === "sell") {
      const discharge = Math.min(energyLimit, soc);
      soc -= discharge;
      cash += discharge * point.sell / 100;
    }
  });
  const days = countDays(points);
  return cash - config.dailyChargeAud * days;
}
