export type RawInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
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
