export type RawInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
  renewables?: number;
};

export type UsageInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
  kwh: number;
  cost: number;
  nemTime?: string;
  date?: string;
  renewables?: number;
};

export type WeatherPoint = {
  time: string;
  value: number;
};

export type BacktestPoint = {
  time: string;
  soc: number;
  buy: number;
  sell: number;
  cash: number;
  cumulativeProfit: number;
};

export type Summary = {
  profit: number;
  buyKwh: number;
  sellKwh: number;
  endSoc: number;
};

export type StrategyResult = {
  name: string;
  config: BacktestConfig;
  points: BacktestPoint[];
  summary: Summary;
};

export type CustomRule = {
  field: "buy" | "sell" | "hour" | "solar";
  op: "<" | "<=" | ">" | ">=";
  value: number;
};

export type CacheEntry = {
  name: string;
  modified: number;
  size: number;
  source?: "local" | "server";
  kind?: "prices" | "usage";
};

export type DailySolarPoint = {
  date: string;
  simulatedKwh: number;
  actualKwh: number | null;
};

export type BacktestConfig = {
  capacityKwh: number;
  maxPowerKw: number;
  inverterMaxKw: number;
  dailyChargeAud: number;
  startSoc: number;
  buyThreshold: number;
  sellThreshold: number;
  windowSize: number;
  buyPercentile: number;
  sellPercentile: number;
  mode: "threshold" | "percentile";
  resolution?: number;
};

export type MonitorDecision = {
  action: "charge" | "discharge" | "hold";
  powerKw: number;
  confidence: number;
  reasons: string[];
};
