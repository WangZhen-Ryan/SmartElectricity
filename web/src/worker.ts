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
};

type Summary = {
  profit: number;
  buyKwh: number;
  sellKwh: number;
  endSoc: number;
};

type WorkerResponse = {
  points: BacktestPoint[];
  summary: Summary;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { payload, config } = event.data;
  const market = buildMarket(payload);
  const points = runBacktest(market, config);
  const summary = summarize(points, config.dailyChargeAud);
  const response: WorkerResponse = { points, summary };
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

function runBacktest(market: MarketPoint[], config: BacktestConfig): BacktestPoint[] {
  let soc = config.startSoc;
  const buyWindow: number[] = [];
  const sellWindow: number[] = [];
  return market.map((m) => {
    const hours =
      (m.endTime.getTime() - m.startTime.getTime()) / (1000 * 60 * 60);
    const energyLimit = config.maxPowerKw * hours;

    let buySignal = false;
    let sellSignal = false;

    if (config.mode === "threshold") {
      buySignal = m.generalCents !== null && m.generalCents <= config.buyThreshold;
      sellSignal = m.feedinCents !== null && m.feedinCents >= config.sellThreshold;
    } else {
      if (m.generalCents !== null) pushWindow(buyWindow, m.generalCents, config.windowSize);
      if (m.feedinCents !== null) pushWindow(sellWindow, m.feedinCents, config.windowSize);
      const buyLevel = percentile(buyWindow, config.buyPercentile);
      const sellLevel = percentile(sellWindow, config.sellPercentile);
      buySignal = buyLevel !== null && m.generalCents !== null && m.generalCents <= buyLevel;
      sellSignal = sellLevel !== null && m.feedinCents !== null && m.feedinCents >= sellLevel;
    }

    if (sellSignal) {
      soc = Math.max(0, soc - energyLimit);
    } else if (buySignal) {
      soc = Math.min(config.capacityKwh, soc + energyLimit);
    }

    return {
      time: m.startTime.toISOString(),
      soc,
      buy: m.generalCents ?? 0,
      sell: m.feedinCents ?? 0,
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
  const profit =
    -dailyCharge +
    (sellKwh * average(points.map((p) => p.sell)) -
      buyKwh * average(points.map((p) => p.buy))) /
      100;
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
