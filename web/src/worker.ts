type RawInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
};

type MarketPoint = {
  startTime: Date;
  endTime: Date;
  generalCents: number | null;
  feedinCents: number | null;
};

type BacktestPoint = {
  time: string;
  soc: number;
  buy: number;
  sell: number;
  cash: number;
  cumulativeProfit: number;
};

type StrategyMode = "threshold" | "percentile";

type BacktestConfig = {
  capacityKwh: number;
  maxPowerKw: number;
  dailyChargeAud: number;
  startSoc: number;
  buyThreshold: number;
  sellThreshold: number;
  windowSize: number;
  buyPercentile: number;
  sellPercentile: number;
  mode: StrategyMode;
};

type WorkerRequest = {
  payload: RawInterval[];
  config: BacktestConfig;
  solar: number[];
};

type Summary = {
  profit: number;
  buyKwh: number;
  sellKwh: number;
  endSoc: number;
};

type StrategyResult = {
  name: string;
  config: BacktestConfig;
  points: BacktestPoint[];
  summary: Summary;
};

type WorkerResponse = {
  strategies: StrategyResult[];
};

type StrategyDecision = (input: {
  market: MarketPoint;
  index: number;
  solarKw: number;
}) => { buy: boolean; sell: boolean };

type StrategyDefinition = {
  name: string;
  config: BacktestConfig;
  decide: StrategyDecision;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { payload, config, solar } = event.data;
  const market = buildMarket(payload);
  const strategies = buildStrategies(config);
  const results = strategies.map((entry) => {
    const points = runBacktest(market, entry.config, entry.decide, solar);
    const summary = summarize(points, entry.config.dailyChargeAud);
    return { name: entry.name, config: entry.config, points, summary };
  });
  const response: WorkerResponse = { strategies: results };
  self.postMessage(response);
};

function buildMarket(data: RawInterval[]): MarketPoint[] {
  const buckets = new Map<string, MarketPoint>();
  data.forEach((item) => {
    const start = new Date(item.startTime);
    const end = new Date(item.endTime);
    const key = item.startTime;
    if (!buckets.has(key)) {
      buckets.set(key, {
        startTime: start,
        endTime: end,
        generalCents: null,
        feedinCents: null,
      });
    }
    const entry = buckets.get(key)!;
    if (item.channelType === "general") {
      entry.generalCents = item.perKwh;
    } else {
      entry.feedinCents = item.perKwh;
    }
  });
  return Array.from(buckets.values()).sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
}

function buildStrategies(config: BacktestConfig): StrategyDefinition[] {
  const thresholdConfig = { ...config, mode: "threshold" as const };
  const percentileConfig = { ...config, mode: "percentile" as const };

  const meanWindow: number[] = [];
  const meanFeedWindow: number[] = [];
  const momentumWindow: number[] = [];
  const momentumSellWindow: number[] = [];
  const percentileBuyWindow: number[] = [];
  const percentileSellWindow: number[] = [];

  return [
    {
      name: "Threshold",
      config: thresholdConfig,
      decide: ({ market }) => ({
        buy: market.generalCents !== null && market.generalCents <= thresholdConfig.buyThreshold,
        sell: market.feedinCents !== null && market.feedinCents >= thresholdConfig.sellThreshold,
      }),
    },
    {
      name: "Percentile",
      config: percentileConfig,
      decide: ({ market }) => {
        if (market.generalCents !== null) {
          pushWindow(percentileBuyWindow, market.generalCents, percentileConfig.windowSize);
        }
        if (market.feedinCents !== null) {
          pushWindow(percentileSellWindow, market.feedinCents, percentileConfig.windowSize);
        }
        const buyLevel = percentile(percentileBuyWindow, percentileConfig.buyPercentile);
        const sellLevel = percentile(percentileSellWindow, percentileConfig.sellPercentile);
        return {
          buy: buyLevel !== null && market.generalCents !== null && market.generalCents <= buyLevel,
          sell: sellLevel !== null && market.feedinCents !== null && market.feedinCents >= sellLevel,
        };
      },
    },
    {
      name: "Mean Reversion",
      config: percentileConfig,
      decide: ({ market }) => {
        if (market.generalCents !== null) pushWindow(meanWindow, market.generalCents, percentileConfig.windowSize);
        if (market.feedinCents !== null) pushWindow(meanFeedWindow, market.feedinCents, percentileConfig.windowSize);
        const meanBuy = average(meanWindow);
        const stdBuy = stddev(meanWindow, meanBuy);
        const meanSell = average(meanFeedWindow);
        const stdSell = stddev(meanFeedWindow, meanSell);
        return {
          buy: market.generalCents !== null && market.generalCents <= meanBuy - stdBuy * 0.5,
          sell: market.feedinCents !== null && market.feedinCents >= meanSell + stdSell * 0.5,
        };
      },
    },
    {
      name: "Momentum",
      config: percentileConfig,
      decide: ({ market }) => {
        if (market.generalCents !== null) pushWindow(momentumWindow, market.generalCents, percentileConfig.windowSize);
        if (market.feedinCents !== null) pushWindow(momentumSellWindow, market.feedinCents, percentileConfig.windowSize);
        const buySlope = slope(momentumWindow);
        const sellSlope = slope(momentumSellWindow);
        return {
          buy: buySlope < 0 && market.generalCents !== null,
          sell: sellSlope > 0 && market.feedinCents !== null,
        };
      },
    },
    {
      name: "Time Window",
      config: percentileConfig,
      decide: ({ market }) => {
        const hour = market.startTime.getHours();
        return {
          buy: hour >= 0 && hour < 6,
          sell: hour >= 17 && hour < 21,
        };
      },
    },
    {
      name: "Solar Assist",
      config: percentileConfig,
      decide: ({ market, solarKw }) => {
        const buy = solarKw < 2 && market.generalCents !== null && market.generalCents <= percentileConfig.buyThreshold;
        const sell = market.feedinCents !== null && market.feedinCents >= percentileConfig.sellThreshold;
        return { buy, sell };
      },
    },
  ];
}

function runBacktest(
  market: MarketPoint[],
  config: BacktestConfig,
  decide: StrategyDecision,
  solar: number[],
): BacktestPoint[] {
  let soc = config.startSoc;
  let cash = 0;
  return market.map((m, index) => {
    const hours =
      (m.endTime.getTime() - m.startTime.getTime()) / (1000 * 60 * 60);
    const energyLimit = config.maxPowerKw * hours;

    const solarKw = solar[index] || 0;
    if (solarKw > 0) {
      const solarCharge = Math.min(config.capacityKwh - soc, solarKw * hours);
      soc += Math.max(0, solarCharge);
    }

    const decision = decide({ market: m, index, solarKw });

    if (decision.sell) {
      const discharge = Math.min(energyLimit, soc);
      soc -= discharge;
      cash += discharge * (m.feedinCents ?? 0) / 100;
    } else if (decision.buy) {
      const charge = Math.min(energyLimit, config.capacityKwh - soc);
      soc += charge;
      cash -= charge * (m.generalCents ?? 0) / 100;
    }

    return {
      time: m.startTime.toISOString(),
      soc,
      buy: m.generalCents ?? 0,
      sell: m.feedinCents ?? 0,
      cash,
      cumulativeProfit: cash - config.dailyChargeAud,
    };
  });
}

function summarize(points: BacktestPoint[], dailyCharge: number): Summary {
  const buyKwh = points.reduce((acc, _p, idx) => {
    if (idx === 0) return acc;
    return acc + Math.max(0, points[idx].soc - points[idx - 1].soc);
  }, 0);
  const sellKwh = points.reduce((acc, _p, idx) => {
    if (idx === 0) return acc;
    return acc + Math.max(0, points[idx - 1].soc - points[idx].soc);
  }, 0);
  const profit = points.length ? points[points.length - 1].cash - dailyCharge : 0;
  const endSoc = points.length ? points[points.length - 1].soc : 0;
  return { profit, buyKwh, sellKwh, endSoc };
}

function pushWindow(values: number[], value: number, limit: number) {
  values.push(value);
  if (values.length > limit) values.shift();
}

function percentile(values: number[], pct: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * pct);
  return sorted[idx];
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function stddev(values: number[], mean: number) {
  if (!values.length) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function slope(values: number[]) {
  if (values.length < 2) return 0;
  const xs = values.map((_, i) => i);
  const xMean = average(xs);
  const yMean = average(values);
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - xMean) * (values[i] - yMean);
    den += (x - xMean) ** 2;
  });
  return den === 0 ? 0 : num / den;
}
