import { BacktestConfig, MonitorDecision } from "../core/types";
import { ForecastSignal, RlExplanation } from "./monitor";

export type StrategyPatch = Partial<
  Pick<
    BacktestConfig,
    "buyThreshold" | "sellThreshold" | "buyPercentile" | "sellPercentile" | "windowSize"
  >
>;

export type IterationRecommendation = {
  label: string;
  expected: string;
  patch: StrategyPatch;
};

export type ReviewTone = "good" | "warn" | "bad" | "neutral";

export type BacktestSelfReview = {
  score: number | null;
  tone: ReviewTone;
  verdict: string;
  rationale: string[];
  risks: string[];
  recommendation: IterationRecommendation | null;
};

export type MonitorSelfReview = {
  score: number | null;
  tone: ReviewTone;
  verdict: string;
  rationale: string[];
  recommendation: IterationRecommendation | null;
  alignment: "aligned" | "mismatch" | "pending";
};

export type BacktestSelfReviewInput = {
  config: BacktestConfig;
  metrics: {
    profit: number | null;
    baselineEdge: number | null;
    drawdown: number | null;
    winRate: number | null;
    coveragePct: number | null;
    qualityScore: number | null;
    endSoc: number | null;
    days: number | null;
  };
};

export type MonitorSelfReviewInput = {
  config: BacktestConfig;
  thresholds: {
    buy: number;
    sell: number;
  };
  currentBuy: number | null;
  currentSell: number | null;
  decision: MonitorDecision | null;
  forecast: ForecastSignal | null;
  rl: RlExplanation | null;
  battery: {
    socPct: number;
    reserveSocPct: number;
  };
};

const BUY_THRESHOLD_RANGE = { min: -200, max: 250 };
const SELL_THRESHOLD_RANGE = { min: -200, max: 250 };
const BUY_PERCENTILE_RANGE = { min: 0.05, max: 0.45 };
const SELL_PERCENTILE_RANGE = { min: 0.55, max: 0.95 };
const WINDOW_SIZE_RANGE = { min: 12, max: 336 };

export function buildBacktestSelfReview(input: BacktestSelfReviewInput): BacktestSelfReview {
  const { config, metrics } = input;
  if (
    metrics.profit === null ||
    metrics.winRate === null ||
    metrics.coveragePct === null ||
    metrics.qualityScore === null
  ) {
    return {
      score: null,
      tone: "neutral",
      verdict: "Backtest data is incomplete. Run a full replay before iterating.",
      rationale: ["Missing one or more required metrics: profit / winRate / coverage / quality."],
      risks: ["Automatic tuning with low sample depth can overfit."],
      recommendation: null,
    };
  }

  const profit = metrics.profit;
  const baselineEdge = metrics.baselineEdge ?? 0;
  const drawdown = metrics.drawdown ?? 0;
  const winRate = clamp(metrics.winRate, 0, 1);
  const coverage = clamp(metrics.coveragePct, 0, 1);
  const quality = clamp((metrics.qualityScore ?? 0) / 100, 0, 1);
  const endSoc = metrics.endSoc ?? 50;
  const days = metrics.days ?? 0;

  const profitScore = clamp((profit + 10) / 25, 0, 1);
  const edgeScore = clamp((baselineEdge + 5) / 10, 0, 1);
  const drawdownScore =
    profit > 0 ? clamp(1 - drawdown / Math.max(1, profit), 0, 1) : clamp(1 - drawdown / 15, 0, 1);
  const socBalanceScore = clamp(1 - Math.abs(endSoc - 50) / 50, 0, 1);
  const sampleScore = clamp(days / 7, 0, 1);

  const score = clamp(
    profitScore * 0.24 +
      edgeScore * 0.18 +
      drawdownScore * 0.16 +
      winRate * 0.14 +
      coverage * 0.12 +
      quality * 0.1 +
      socBalanceScore * 0.04 +
      sampleScore * 0.02,
    0,
    1,
  );

  const rationale = [
    `Profit ${profit.toFixed(2)}, edge vs baseline ${baselineEdge >= 0 ? "+" : ""}${baselineEdge.toFixed(2)}.`,
    `Drawdown ${drawdown.toFixed(2)}, win rate ${(winRate * 100).toFixed(1)}%.`,
    `Coverage ${(coverage * 100).toFixed(1)}%, quality ${(quality * 100).toFixed(1)}%.`,
    `End SOC ${endSoc.toFixed(1)}, sample window ${days} day(s).`,
  ];

  const risks: string[] = [];
  if (baselineEdge < 0) risks.push("Strategy is trailing baseline; live migration risk is high.");
  if (drawdownScore < 0.4) risks.push("Drawdown pressure is high; reduce risk before pushing return.");
  if (coverage < 0.9) risks.push("Data coverage is incomplete; fill gaps before tuning.");
  if (days < 3) risks.push("Sample depth is too short for stable parameter updates.");
  if (!risks.length) risks.push("Risk posture is acceptable for small-step iteration.");

  const recommendation = buildBacktestRecommendation(config, metrics);

  return {
    score,
    tone: score >= 0.72 ? "good" : score >= 0.52 ? "warn" : "bad",
    verdict:
      score >= 0.72
        ? "Strategy is rational overall; proceed with small-step iteration."
        : score >= 0.52
          ? "Strategy is usable but has clear gaps; apply one corrective iteration."
          : "Strategy rationality is weak; run a conservative iteration and revalidate.",
    rationale,
    risks,
    recommendation,
  };
}

export function buildMonitorSelfReview(input: MonitorSelfReviewInput): MonitorSelfReview {
  const { decision, forecast, rl, currentBuy, currentSell, battery, thresholds, config } = input;
  if (!decision) {
    return {
      score: null,
      tone: "neutral",
      verdict: "No live decision yet. Wait for current price + forecast.",
      rationale: ["Monitor decision is empty, so action rationality cannot be scored."],
      recommendation: null,
      alignment: "pending",
    };
  }

  const buyMedian = forecast?.buyMedian ?? thresholds.buy;
  const sellMedian = forecast?.sellMedian ?? thresholds.sell;
  const liveBuy = currentBuy ?? thresholds.buy;
  const liveSell = currentSell ?? thresholds.sell;
  const reserve = battery.reserveSocPct + 5;

  let edgeRaw = 0;
  if (decision.action === "charge") {
    edgeRaw = (buyMedian - liveBuy) / Math.max(6, Math.abs(buyMedian) * 0.25);
  } else if (decision.action === "discharge") {
    edgeRaw = (liveSell - sellMedian) / Math.max(6, Math.abs(sellMedian) * 0.25);
  } else {
    const buyGap = Math.abs(liveBuy - buyMedian);
    const sellGap = Math.abs(liveSell - sellMedian);
    edgeRaw = -((buyGap + sellGap) / 20);
  }
  const edgeScore = clamp(0.5 + edgeRaw * 0.5, 0, 1);

  const safetyScore = getSafetyScore(decision.action, battery.socPct, reserve);
  const confidenceScore = clamp(decision.confidence, 0, 1);
  const spreadScore = forecast ? clamp(1 - forecast.spread / 120, 0.2, 1) : 0.5;
  const rlAlignment = getRlAlignment(decision.action, rl);
  const alignmentScore =
    rlAlignment === "pending" ? 0.55 : rlAlignment === "aligned" ? 1 : 0.35;

  const score = clamp(
    edgeScore * 0.34 +
      safetyScore * 0.24 +
      confidenceScore * 0.18 +
      spreadScore * 0.12 +
      alignmentScore * 0.12,
    0,
    1,
  );

  const rationale = [
    `Action ${decision.action.toUpperCase()} with confidence ${(confidenceScore * 100).toFixed(0)}%.`,
    `Live buy/sell ${liveBuy.toFixed(2)} / ${liveSell.toFixed(2)} vs forecast median ${buyMedian.toFixed(2)} / ${sellMedian.toFixed(2)}.`,
    `SOC ${battery.socPct.toFixed(1)}% with reserve line ${reserve.toFixed(1)}%.`,
    rl
      ? `RL alignment: ${rlAlignment === "aligned" ? "yes" : "no"}.`
      : "RL alignment: no RL context available.",
  ];

  const recommendation = buildMonitorRecommendation({
    config,
    action: decision.action,
    edgeRaw,
    socPct: battery.socPct,
    reserveSoc: reserve,
    rlAlignment,
  });

  return {
    score,
    tone: score >= 0.74 ? "good" : score >= 0.54 ? "warn" : "bad",
    verdict:
      score >= 0.74
        ? "Current action is rational and can run on the live cadence."
        : score >= 0.54
          ? "Current action is partially rational; apply a small threshold adjustment and monitor."
          : "Current action rationality is weak; move to conservative iteration now.",
    rationale,
    recommendation,
    alignment: rlAlignment,
  };
}

export function applyStrategyPatch(config: BacktestConfig, patch: StrategyPatch): BacktestConfig {
  let next: BacktestConfig = { ...config };
  if (typeof patch.buyThreshold === "number") {
    next = {
      ...next,
      buyThreshold: round(clamp(patch.buyThreshold, BUY_THRESHOLD_RANGE.min, BUY_THRESHOLD_RANGE.max), 0.1),
    };
  }
  if (typeof patch.sellThreshold === "number") {
    next = {
      ...next,
      sellThreshold: round(
        clamp(patch.sellThreshold, SELL_THRESHOLD_RANGE.min, SELL_THRESHOLD_RANGE.max),
        0.1,
      ),
    };
  }
  if (typeof patch.buyPercentile === "number") {
    next = {
      ...next,
      buyPercentile: round(
        clamp(patch.buyPercentile, BUY_PERCENTILE_RANGE.min, BUY_PERCENTILE_RANGE.max),
        0.01,
      ),
    };
  }
  if (typeof patch.sellPercentile === "number") {
    next = {
      ...next,
      sellPercentile: round(
        clamp(patch.sellPercentile, SELL_PERCENTILE_RANGE.min, SELL_PERCENTILE_RANGE.max),
        0.01,
      ),
    };
  }
  if (typeof patch.windowSize === "number") {
    next = {
      ...next,
      windowSize: Math.round(clamp(patch.windowSize, WINDOW_SIZE_RANGE.min, WINDOW_SIZE_RANGE.max)),
    };
  }
  if (next.mode === "percentile" && next.sellPercentile - next.buyPercentile < 0.1) {
    const mid = (next.sellPercentile + next.buyPercentile) / 2;
    next = {
      ...next,
      buyPercentile: round(clamp(mid - 0.05, BUY_PERCENTILE_RANGE.min, BUY_PERCENTILE_RANGE.max), 0.01),
      sellPercentile: round(clamp(mid + 0.05, SELL_PERCENTILE_RANGE.min, SELL_PERCENTILE_RANGE.max), 0.01),
    };
  }
  return next;
}

function buildBacktestRecommendation(
  config: BacktestConfig,
  metrics: BacktestSelfReviewInput["metrics"],
): IterationRecommendation | null {
  const profit = metrics.profit ?? 0;
  const baselineEdge = metrics.baselineEdge ?? 0;
  const drawdown = metrics.drawdown ?? 0;
  const winRate = metrics.winRate ?? 0.5;
  const endSoc = metrics.endSoc ?? 50;

  if (baselineEdge < 0 || profit < 0) {
    if (config.mode === "threshold") {
      return {
        label: "Iteration-01: widen buy/sell spread",
        expected: "Reduce noisy trades and recover edge vs baseline first.",
        patch: {
          buyThreshold: config.buyThreshold - 2,
          sellThreshold: config.sellThreshold + 3,
        },
      };
    }
    return {
      label: "Iteration-01: tighten percentile triggers",
      expected: "Reduce low-quality triggers and stabilize net return.",
      patch: {
        buyPercentile: config.buyPercentile - 0.03,
        sellPercentile: config.sellPercentile + 0.03,
        windowSize: config.windowSize + 12,
      },
    };
  }

  if (drawdown > Math.max(8, profit * 0.8) || winRate < 0.5) {
    if (config.mode === "threshold") {
      return {
        label: "Iteration-02: drawdown control first",
        expected: "Reduce wrong entries/exits and lower drawdown pressure.",
        patch: {
          buyThreshold: config.buyThreshold - 1,
          sellThreshold: config.sellThreshold + 2,
        },
      };
    }
    return {
      label: "Iteration-02: raise trigger quality",
      expected: "Increase action quality and stabilize equity curve.",
      patch: {
        buyPercentile: config.buyPercentile - 0.02,
        sellPercentile: config.sellPercentile + 0.02,
        windowSize: config.windowSize + 6,
      },
    };
  }

  if (endSoc > 85) {
    if (config.mode === "threshold") {
      return {
        label: "Iteration-03: release stored energy",
        expected: "Avoid high-SOC stagnation and improve sell-window capture.",
        patch: {
          sellThreshold: config.sellThreshold - 2,
        },
      };
    }
    return {
      label: "Iteration-03: increase discharge triggers",
      expected: "Reduce energy pile-up and realize profit earlier.",
      patch: {
        sellPercentile: config.sellPercentile - 0.02,
      },
    };
  }

  if (endSoc < 20) {
    if (config.mode === "threshold") {
      return {
        label: "Iteration-04: raise energy safety margin",
        expected: "Avoid over-discharge and keep scheduling flexibility.",
        patch: {
          buyThreshold: config.buyThreshold + 2,
        },
      };
    }
    return {
      label: "Iteration-04: increase low-price refill frequency",
      expected: "Recover low SOC faster and improve continuity.",
      patch: {
        buyPercentile: config.buyPercentile + 0.02,
      },
    };
  }

  return null;
}

function buildMonitorRecommendation(input: {
  config: BacktestConfig;
  action: MonitorDecision["action"];
  edgeRaw: number;
  socPct: number;
  reserveSoc: number;
  rlAlignment: "aligned" | "mismatch" | "pending";
}): IterationRecommendation | null {
  const { config, action, edgeRaw, socPct, reserveSoc, rlAlignment } = input;

  if (action === "charge" && socPct > 85) {
    if (config.mode === "threshold") {
      return {
        label: "Live iteration: reduce high-SOC charge triggers",
        expected: "Lower overcharge risk and cut low-value charging.",
        patch: { buyThreshold: config.buyThreshold - 1 },
      };
    }
    return {
      label: "Live iteration: lower charge sensitivity",
      expected: "Reduce charging actions while SOC is high.",
      patch: { buyPercentile: config.buyPercentile - 0.02 },
    };
  }

  if (action === "discharge" && socPct < reserveSoc + 6) {
    if (config.mode === "threshold") {
      return {
        label: "Live iteration: protect low SOC",
        expected: "Avoid over-discharge and preserve emergency reserve.",
        patch: { sellThreshold: config.sellThreshold + 2 },
      };
    }
    return {
      label: "Live iteration: raise discharge threshold",
      expected: "Reduce discharge actions at low SOC.",
      patch: { sellPercentile: config.sellPercentile + 0.02 },
    };
  }

  if (action === "hold" && edgeRaw > 0.2) {
    if (config.mode === "threshold") {
      return {
        label: "Live iteration: reduce missed opportunities",
        expected: "Trigger faster when edge is clearly positive.",
        patch: {
          buyThreshold: config.buyThreshold + 1,
          sellThreshold: config.sellThreshold - 1,
        },
      };
    }
    return {
      label: "Live iteration: improve edge sensitivity",
      expected: "Reduce HOLD under clear spread opportunities.",
      patch: {
        buyPercentile: config.buyPercentile + 0.02,
        sellPercentile: config.sellPercentile - 0.02,
      },
    };
  }

  if (rlAlignment === "mismatch") {
    if (config.mode === "threshold") {
      return {
        label: "Live iteration: align with RL feedback",
        expected: "Reduce rule-policy divergence and improve consistency.",
        patch: {
          buyThreshold: config.buyThreshold + 0.5,
          sellThreshold: config.sellThreshold - 0.5,
        },
      };
    }
    return {
      label: "Live iteration: shrink rule-RL mismatch",
      expected: "Improve real-time action consistency.",
      patch: {
        buyPercentile: config.buyPercentile + 0.01,
        sellPercentile: config.sellPercentile - 0.01,
      },
    };
  }

  return null;
}

function getSafetyScore(action: MonitorDecision["action"], socPct: number, reserveSoc: number) {
  if (action === "charge") return socPct <= 88 ? 1 : socPct <= 93 ? 0.6 : 0.2;
  if (action === "discharge") return socPct >= reserveSoc + 8 ? 1 : socPct >= reserveSoc + 3 ? 0.6 : 0.2;
  return socPct >= reserveSoc ? 1 : 0.6;
}

function getRlAlignment(
  action: MonitorDecision["action"],
  rl: RlExplanation | null,
): "aligned" | "mismatch" | "pending" {
  if (!rl) return "pending";
  const entries: Array<{ action: MonitorDecision["action"]; score: number }> = [
    { action: "charge", score: rl.qValues.charge },
    { action: "discharge", score: rl.qValues.discharge },
    { action: "hold", score: rl.qValues.hold },
  ];
  const top = entries.reduce((best, current) => (current.score > best.score ? current : best), entries[0]);
  return top.action === action ? "aligned" : "mismatch";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, step: number) {
  if (!step) return value;
  return Math.round(value / step) * step;
}
