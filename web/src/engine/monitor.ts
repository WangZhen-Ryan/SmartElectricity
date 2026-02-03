import { arimaForecast } from "./forecast";
import { MonitorDecision } from "../core/types";

export type BatteryStatus = {
  socPct: number;
  powerKw: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  reserveSocPct: number;
  updatedAt: string;
};

export type ForecastSignal = {
  horizon: number;
  buyForecast: number[];
  sellForecast: number[];
  buyMedian: number;
  sellMedian: number;
  spread: number;
  timeline: Array<{ time: string; buy: number; sell: number }>;
};

export type MonitorInputs = {
  currentBuy: number | null;
  currentSell: number | null;
  buySeries: number[];
  sellSeries: number[];
  lastTimeIso: string | null;
  resolutionMinutes: number;
  horizonHours: number;
  battery: BatteryStatus;
  thresholds: {
    buy: number;
    sell: number;
  };
  bestStrategyName?: string;
  bestStrategyNote?: string;
};

export function getMockBatteryStatus(prev?: BatteryStatus): BatteryStatus {
  const now = new Date();
  const baseSoc = prev?.socPct ?? 42;
  const drift = (Math.sin(now.getTime() / 300000) + 1) * 0.6 - 0.3;
  const socPct = clamp(baseSoc + drift, 15, 95);
  return {
    socPct,
    powerKw: prev?.powerKw ?? 1.8,
    maxChargeKw: prev?.maxChargeKw ?? 5,
    maxDischargeKw: prev?.maxDischargeKw ?? 5,
    reserveSocPct: prev?.reserveSocPct ?? 20,
    updatedAt: now.toISOString(),
  };
}

export function buildForecastSignal(inputs: {
  buySeries: number[];
  sellSeries: number[];
  lastTimeIso: string | null;
  horizonHours: number;
  resolutionMinutes: number;
}): ForecastSignal | null {
  const { buySeries, sellSeries, lastTimeIso, horizonHours, resolutionMinutes } = inputs;
  if (!buySeries.length && !sellSeries.length) return null;
  const horizon = Math.max(1, Math.min(12, horizonHours));
  const buyForecast = buySeries.length ? arimaForecast(buySeries, horizon) : new Array(horizon).fill(0);
  const sellForecast = sellSeries.length ? arimaForecast(sellSeries, horizon) : new Array(horizon).fill(0);
  const buyMedian = median(buyForecast);
  const sellMedian = median(sellForecast);
  const spread =
    (Math.max(...buyForecast, ...sellForecast) - Math.min(...buyForecast, ...sellForecast)) || 0;
  const start = lastTimeIso ? new Date(lastTimeIso) : new Date();
  const stepMs = resolutionMinutes * 60 * 1000;
  const timeline = buyForecast.map((buy, idx) => ({
    time: new Date(start.getTime() + stepMs * (idx + 1)).toISOString(),
    buy,
    sell: sellForecast[idx] ?? 0,
  }));
  return {
    horizon,
    buyForecast,
    sellForecast,
    buyMedian,
    sellMedian,
    spread,
    timeline,
  };
}

export function decideMonitorAction(
  inputs: MonitorInputs,
  forecast: ForecastSignal | null,
): MonitorDecision {
  const reserve = inputs.battery.reserveSocPct + 5;
  const socOkToCharge = inputs.battery.socPct < reserve + 20;
  const socOkToDischarge = inputs.battery.socPct > reserve + 5;
  const currentBuy = inputs.currentBuy ?? inputs.thresholds.buy;
  const currentSell = inputs.currentSell ?? inputs.thresholds.sell;
  const buyMedian = forecast?.buyMedian ?? inputs.thresholds.buy;
  const sellMedian = forecast?.sellMedian ?? inputs.thresholds.sell;

  let action: MonitorDecision["action"] = "hold";
  if (inputs.currentBuy !== null && currentBuy < buyMedian && socOkToCharge) {
    action = "charge";
  } else if (inputs.currentSell !== null && currentSell > sellMedian && socOkToDischarge) {
    action = "discharge";
  }

  const maxPower = Math.min(inputs.battery.maxChargeKw, inputs.battery.maxDischargeKw);
  const confidence = forecast ? clamp(1 - forecast.spread / 80, 0.35, 0.9) : 0.45;
  const powerKw = action === "hold" ? 0 : roundTo(maxPower * confidence, 0.1);

  const reasons = buildMonitorExplanation(inputs, forecast, action);
  return { action, powerKw, confidence, reasons };
}

export function buildMonitorExplanation(
  inputs: MonitorInputs,
  forecast: ForecastSignal | null,
  action: MonitorDecision["action"],
): string[] {
  const reasons: string[] = [];
  const currentBuy = inputs.currentBuy ?? inputs.thresholds.buy;
  const currentSell = inputs.currentSell ?? inputs.thresholds.sell;
  const buyMedian = forecast?.buyMedian ?? inputs.thresholds.buy;
  const sellMedian = forecast?.sellMedian ?? inputs.thresholds.sell;

  if (inputs.bestStrategyName) {
    reasons.push(`Best backtest strategy: ${inputs.bestStrategyName}.`);
  }
  if (inputs.bestStrategyNote) {
    reasons.push(inputs.bestStrategyNote);
  }

  if (action === "charge") {
    reasons.push(
      `Buy price ${currentBuy.toFixed(1)}c/kWh is below the forecast median ${buyMedian.toFixed(1)}c.`,
    );
  } else if (action === "discharge") {
    reasons.push(
      `Sell price ${currentSell.toFixed(1)}c/kWh is above the forecast median ${sellMedian.toFixed(1)}c.`,
    );
  } else {
    reasons.push("Current prices are near forecast medians, so we hold to avoid churn.");
  }

  reasons.push(
    `SOC ${inputs.battery.socPct.toFixed(0)}% with reserve ${inputs.battery.reserveSocPct}% keeps battery safe.`,
  );
  return reasons;
}

export function buildDecisionTimeline(
  forecast: ForecastSignal | null,
  inputs: MonitorInputs,
): Array<{ time: string; buy: number; sell: number; action: MonitorDecision["action"] }> {
  if (!forecast) return [];
  const reserve = inputs.battery.reserveSocPct + 5;
  const buyMedian = forecast.buyMedian;
  const sellMedian = forecast.sellMedian;
  return forecast.timeline.map((point) => {
    let action: MonitorDecision["action"] = "hold";
    if (point.buy < buyMedian * 0.95 && inputs.battery.socPct < reserve + 20) {
      action = "charge";
    } else if (point.sell > sellMedian * 1.05 && inputs.battery.socPct > reserve + 5) {
      action = "discharge";
    }
    return { ...point, action };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function roundTo(value: number, step: number) {
  if (!step) return value;
  return Math.round(value / step) * step;
}
