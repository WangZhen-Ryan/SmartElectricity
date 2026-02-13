import { useEffect, useMemo, useRef, useState } from "react";
import RLPanel from "./gui/RLPanel";
import {
  BacktestConfig,
  BacktestPoint,
  CacheEntry,
  CustomRule,
  MonitorDecision,
  RawInterval,
  StrategyResult,
  UsageInterval,
  WeatherPoint,
} from "./core/types";
import {
  countDays,
  dayDiff,
  downsample,
  formatAmberPrice,
  formatJson,
  formatProfit,
  formatTimestamp,
  maxDrawdown,
  parseDsl,
  rangeValues,
  strategyComment,
  toDayStamp,
  winRate,
} from "./core/utils";
import {
  fetchCacheFile,
  fetchCurrent,
  fetchPricesWithFallback,
  fetchServerCaches,
  fetchSites,
  fetchUsage,
  buildAmberHeaders,
} from "./data/amber";
import {
  readLocalCacheData,
  readLocalCacheList,
  saveLocalCache as storeLocalCache,
  writeLocalCacheList,
} from "./data/cache";
import { fetchCloudCover } from "./data/weather";
import {
  applyCloudCover,
  buildSolarDaily,
  SolarProfile,
  solarForTime,
} from "./engine/solar";
import { simulateCloudCover } from "./engine/weather";
import {
  predictSolar,
  predictSolarAttenuation,
  trainSolarAttenuation,
  trainSolarRegression,
} from "./engine/solar_model";
import {
  buildActionTimeline,
  parseLlmTimeline,
  summarizeLlm,
  simulatePlanProfit,
} from "./engine/llm";
import { arimaForecast, prophetForecast } from "./engine/forecast";
import {
  BatteryStatus,
  buildDecisionTimeline,
  buildForecastSignal,
  buildRlExplanation,
  decideMonitorAction,
  getMockBatteryStatus,
} from "./engine/monitor";
import {
  ActionPieChart,
  ActionTimelineChart,
  Chart,
  CompareChart,
  ConfidenceChart,
  ForecastPanel,
  KdeBoxPlot,
  LineChart,
  ProfitCompareChart,
  SolarDailyChart,
  UsageLinesChart,
  WeatherChart,
} from "./gui/charts";
import DailyDecisionReview from "./gui/DailyDecisionReview";
import { CurrentMarketTimeline } from "./gui/CurrentMarketTimeline";
import ActualUsageReview from "./gui/ActualUsageReview";

const defaultConfig: BacktestConfig = {
  capacityKwh: 40,
  maxPowerKw: 10,
  inverterMaxKw: 10,
  dailyChargeAud: 0.98,
  startSoc: 100,
  buyThreshold: 15,
  sellThreshold: 60,
  windowSize: 48,
  buyPercentile: 0.2,
  sellPercentile: 0.8,
  mode: "threshold",
};

const defaultRange = {
  start: "2026-01-20",
  end: "2026-01-22",
  resolution: 30,
};

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function weightedAverage(values: number[], weights: number[]) {
  if (!values.length || !weights.length) return 0;
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const weight = weights[i] ?? 0;
    sum += values[i] * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return 0;
  return sum / weightSum;
}

function stdDev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((v) => Math.pow(v - mean, 2)));
  return Math.sqrt(variance);
}

function correlation(valuesA: number[], valuesB: number[]) {
  const n = Math.min(valuesA.length, valuesB.length);
  if (n < 2) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += valuesA[i];
    sumB += valuesB[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = valuesA[i] - meanA;
    const db = valuesB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  if (denom === 0) return 0;
  return cov / denom;
}

function linearSlope(values: number[]) {
  if (values.length < 2) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = average(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  if (den === 0) return 0;
  return num / den;
}

function smoothSeries(values: number[], windowSize = 2) {
  if (!values.length) return [];
  return values.map((value, idx) => {
    const start = Math.max(0, idx - windowSize);
    const end = Math.min(values.length - 1, idx + windowSize);
    return average(values.slice(start, end + 1));
  });
}

function normalizedEntropy(values: number[]) {
  if (!values.length) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (sum <= 0) return 0;
  const base = Math.log(values.length);
  let entropy = 0;
  values.forEach((value) => {
    const p = value / sum;
    if (p <= 0) return;
    entropy -= p * Math.log(p);
  });
  return base ? entropy / base : 0;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function weightedLinearRegression(xs: number[], ys: number[], weights: number[]) {
  const n = Math.min(xs.length, ys.length, weights.length);
  if (n < 2) return null;
  let weightSum = 0;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i += 1) {
    const w = weights[i] ?? 0;
    weightSum += w;
    meanX += xs[i] * w;
    meanY += ys[i] * w;
  }
  if (weightSum <= 0) return null;
  meanX /= weightSum;
  meanY /= weightSum;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const w = weights[i] ?? 0;
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += w * dx * dy;
    den += w * dx * dx;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const w = weights[i] ?? 0;
    const pred = intercept + slope * xs[i];
    const diff = ys[i] - pred;
    ssRes += w * diff * diff;
    const dev = ys[i] - meanY;
    ssTot += w * dev * dev;
  }
  const r2 = ssTot <= 0 ? 0 : clampNumber(1 - ssRes / ssTot, 0, 1);
  return { slope, intercept, r2 };
}

function smoothWeather(points: WeatherPoint[], windowSize = 2) {
  if (!points.length) return [];
  const values = points.map((point) => point.value);
  return points.map((point, idx) => {
    const start = Math.max(0, idx - windowSize);
    const end = Math.min(points.length - 1, idx + windowSize);
    const slice = values.slice(start, end + 1);
    return {
      ...point,
      value: average(slice),
    };
  });
}

function blendForecastSeries(
  baseline: number[],
  primary: number[] | null,
  secondary: number[] | null,
  dataStrength: number,
) {
  if (!primary && !secondary) return baseline;
  if (!secondary) return primary || baseline;
  if (!primary) return secondary || baseline;
  const strength = Math.max(0, Math.min(1, dataStrength));
  const weight = 0.55 + 0.25 * strength;
  return primary.map((value, idx) => {
    const other = secondary[idx] ?? value;
    return value * weight + other * (1 - weight);
  });
}

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const currentAutoRef = useRef(false);
  const currentIntervalRef = useRef<number | null>(null);
  const currentFetchAtRef = useRef(0);
  const loadingRef = useRef({ fetch: false, current: false, cache: false, crunch: false });
  const apiBase = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const customDomain = import.meta.env.VITE_CUSTOM_DOMAIN as string | undefined;
  const apiPath = (path: string) => `${apiBase}${path}`;
  const [siteId, setSiteId] = useState("");
  const [token, setToken] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [config, setConfig] = useState(defaultConfig);
  const [payload, setPayload] = useState<RawInterval[] | null>(null);
  const [status, setStatus] = useState("Load data to begin.");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"backtest" | "monitor">("backtest");
  const [loading, setLoading] = useState({
    fetch: false,
    current: false,
    cache: false,
    crunch: false,
  });
  const [serverCaches, setServerCaches] = useState<CacheEntry[]>([]);
  const [localCaches, setLocalCaches] = useState<CacheEntry[]>([]);
  const [selectedCache, setSelectedCache] = useState("");
  const [strategies, setStrategies] = useState<StrategyResult[]>([]);
  const [activeStrategy, setActiveStrategy] = useState("Threshold");
  const [compareA, setCompareA] = useState("Threshold");
  const [compareB, setCompareB] = useState("Percentile");
  const [customName, setCustomName] = useState("Custom-01");
  const [customRules, setCustomRules] = useState<CustomRule[]>([
    { field: "buy", op: "<=", value: 12 },
    { field: "sell", op: ">=", value: 60 },
  ]);
  const [dslInput, setDslInput] = useState("BUY when buy <= 12; SELL when sell >= 60");
  const [dslStatus, setDslStatus] = useState("");
  const [windowStart, setWindowStart] = useState(0);
  const [windowSize, setWindowSize] = useState(240);
  const [maxPoints, setMaxPoints] = useState(400);
  const [currentPrice, setCurrentPrice] = useState<RawInterval[] | null>(null);
  const [currentPrice30, setCurrentPrice30] = useState<RawInterval[] | null>(null);
  const [usagePayload, setUsagePayload] = useState<UsageInterval[] | null>(null);
  const autoFetchRef = useRef("");
  const [apiSnapshots, setApiSnapshots] = useState({
    sites: null as unknown,
    prices: null as unknown,
    current: null as unknown,
    current30: null as unknown,
    usage: null as unknown,
  });
  const [solarProfile, setSolarProfile] = useState<SolarProfile>({
    sunrise: 6,
    peak: 12,
    evening: 17,
    sunset: 20,
    morningKw: 3.5,
    peakKw: 8.0,
    eveningKw: 4.5,
  });
  const [clearSkyCurve, setClearSkyCurve] = useState<WeatherPoint[]>([]);
  const [solarCurve, setSolarCurve] = useState<WeatherPoint[]>([]);
  const [solarForecast, setSolarForecast] = useState({
    enabled: true,
    mode: "multiplier",
    multiplier: 0.9,
  });
  const [cloudCover, setCloudCover] = useState<WeatherPoint[]>([]);
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [weatherStatus, setWeatherStatus] = useState("Idle");
  const [llmConfig, setLlmConfig] = useState({
    enabled: false,
    model: "deepseek/deepseek-r1-0528:free",
    cadence: "per-hour",
    outputFormat:
      `{"actions":[{"time":"ISO-hour","action":"buy|sell|hold","confidence":0.0,"reason":"..."}]}`,
    horizonHours: 48,
    maxTokens: 2000,
  });
  const [llmResponse, setLlmResponse] = useState<string>("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmShowRaw, setLlmShowRaw] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [solarModalOpen, setSolarModalOpen] = useState(false);
  const [solarZoom, setSolarZoom] = useState<[number, number] | null>(null);
  const intervalHours = useMemo(() => {
    if (payload && payload.length > 1) {
      return Math.abs(
        (new Date(payload[1].startTime).getTime() - new Date(payload[0].startTime).getTime()) /
          (1000 * 60 * 60),
      );
    }
    return range.resolution / 60;
  }, [payload, range.resolution]);
  const cloudCoverSmoothed = useMemo(() => smoothWeather(cloudCover, 2), [cloudCover]);
  const cloudCoverByHour = useMemo(() => {
    const map = new Map<string, number>();
    cloudCoverSmoothed.forEach((point) => {
      map.set(point.time.slice(0, 13), point.value);
    });
    return map;
  }, [cloudCoverSmoothed]);
  const clearSkyByHour = useMemo(() => {
    const map = new Map<string, number>();
    clearSkyCurve.forEach((point) => {
      map.set(point.time.slice(0, 13), point.value);
    });
    return map;
  }, [clearSkyCurve]);
  const solarHourlyProfile = useMemo(() => {
    if (!usagePayload?.length || !clearSkyCurve.length) return null;
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const buckets = new Map<number, { sum: number; weight: number; count: number }>();
    usagePayload
      .filter((row) => row.channelType === "feedIn")
      .forEach((row) => {
        const hour = new Date(row.startTime).getHours();
        const baseline = clearSkyByHour.get(row.startTime.slice(0, 13)) ?? 0;
        if (baseline <= daylightThreshold) return;
        const actualKw = Math.max(0, row.kwh / intervalHours);
        const ratio = clampNumber(actualKw / Math.max(0.1, baseline), 0.2, 1.4);
        const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
        const entry = buckets.get(hour) ?? { sum: 0, weight: 0, count: 0 };
        entry.sum += ratio * weight;
        entry.weight += weight;
        entry.count += 1;
        buckets.set(hour, entry);
      });
    if (!buckets.size) return null;
    const byHour = new Map<number, { value: number; count: number }>();
    let totalWeight = 0;
    let sampleCount = 0;
    buckets.forEach((entry, hour) => {
      const value = entry.weight ? entry.sum / entry.weight : 1;
      byHour.set(hour, { value, count: entry.count });
      totalWeight += entry.weight;
      sampleCount += entry.count;
    });
    const coverage = buckets.size / 24;
    const density = clampNumber(totalWeight / 24, 0, 1);
    const strength = clampNumber(coverage * 0.55 + density * 0.45, 0, 1);
    const label =
      strength >= 0.7 ? "Strong diurnal fit" : strength >= 0.45 ? "Moderate diurnal fit" : "Weak diurnal fit";
    return { byHour, strength, coverage, label, sampleCount };
  }, [usagePayload, clearSkyCurve, clearSkyByHour, intervalHours]);

  const solarClearIndex = useMemo(() => {
    if (!usagePayload?.length || !clearSkyCurve.length) return null;
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const daily = new Map<string, { baseline: number; actual: number; weight: number }>();
    usagePayload
      .filter((row) => row.channelType === "feedIn")
      .forEach((row) => {
        const hourKey = row.startTime.slice(0, 13);
        const baseline = clearSkyByHour.get(hourKey) ?? 0;
        if (baseline <= daylightThreshold) return;
        const actualKw = Math.max(0, row.kwh / intervalHours);
        const dayKey = row.startTime.slice(0, 10);
        const entry = daily.get(dayKey) ?? { baseline: 0, actual: 0, weight: 0 };
        entry.baseline += baseline;
        entry.actual += actualKw;
        entry.weight += clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
        daily.set(dayKey, entry);
      });
    if (!daily.size) return null;
    const days = Array.from(daily.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const recentDays = days.slice(-3);
    const ratios: number[] = [];
    const weights: number[] = [];
    recentDays.forEach(([, entry]) => {
      if (entry.baseline <= 0) return;
      const ratio = clampNumber(entry.actual / entry.baseline, 0.6, 1.2);
      ratios.push(ratio);
      weights.push(Math.max(0.1, entry.weight));
    });
    if (!weights.length) return null;
    const index = clampNumber(weightedAverage(ratios, weights), 0.65, 1.15);
    const label =
      index >= 1.05
        ? "Above clear-sky"
        : index >= 0.9
          ? "Near clear-sky"
          : index >= 0.75
            ? "Below clear-sky"
            : "Weak solar output";
    return { index, label, dayCount: recentDays.length, sampleCount: weights.length };
  }, [usagePayload, clearSkyCurve, clearSkyByHour, intervalHours]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  const [rlEval, setRlEval] = useState<{
    profit: number;
    endSoc: number;
    algorithm: string;
    at: number;
  } | null>(null);
  const [llmOverlay, setLlmOverlay] = useState({
    enabled: true,
    bands: true,
    arrows: true,
    opacity: 0.18,
  });
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus>(() => getMockBatteryStatus());
  const [monitorStatus, setMonitorStatus] = useState("Waiting for live data.");
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState("");

  function downloadJson(filename: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function cacheId(entry: CacheEntry) {
    return `${entry.source || "server"}:${entry.name}`;
  }

  function applyTuningPreset(preset: "conservative" | "balanced" | "aggressive") {
    if (config.mode === "threshold") {
      if (preset === "conservative") {
        setConfig({ ...config, buyThreshold: 10, sellThreshold: 70 });
      } else if (preset === "aggressive") {
        setConfig({ ...config, buyThreshold: 22, sellThreshold: 45 });
      } else {
        setConfig({ ...config, buyThreshold: 15, sellThreshold: 60 });
      }
      return;
    }
    if (preset === "conservative") {
      setConfig({ ...config, buyPercentile: 0.15, sellPercentile: 0.85, windowSize: 72 });
    } else if (preset === "aggressive") {
      setConfig({ ...config, buyPercentile: 0.3, sellPercentile: 0.7, windowSize: 24 });
    } else {
      setConfig({ ...config, buyPercentile: 0.2, sellPercentile: 0.8, windowSize: 48 });
    }
  }

  function saveLocalCache(kind: "prices" | "usage", data: unknown) {
    const entry = storeLocalCache(kind, data, range, localCaches);
    if (!entry) return;
    const next = [entry, ...localCaches];
    setLocalCaches(next);
    writeLocalCacheList(next);
    setSelectedCache(cacheId(entry));
  }

  async function copyJson(data: unknown) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard unavailable in this browser.");
    }
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  }

  function scrollToSection(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function buildSeries(data: RawInterval[]) {
    const buy: number[] = [];
    const sell: number[] = [];
    let lastTime: string | null = null;
    data.forEach((item) => {
      lastTime = item.startTime;
      if (item.channelType === "general") {
        buy.push(item.perKwh);
      } else {
        sell.push(Math.abs(item.perKwh));
      }
    });
    return { buy, sell, lastTime };
  }

  function normalizeDateInput(value: string) {
    if (!value) return "";
    const candidate = value.replace(/\//g, "-");
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toISOString().slice(0, 10);
  }

  useEffect(() => {
    workerRef.current = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    setBatteryStatus(getMockBatteryStatus());
    const timer = window.setInterval(
      () => setBatteryStatus((prev) => getMockBatteryStatus(prev)),
      30000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!apiBase) {
      setError("Missing VITE_SUPABASE_FUNCTIONS_URL.");
      return;
    }
    fetch(apiPath("/config"), {
      headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
    })
      .then((resp) => resp.json())
      .then((data) => {
        if (data.siteId) setSiteId(data.siteId);
      })
      .catch(() => null);
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase || !siteId || currentAutoRef.current) return;
    currentAutoRef.current = true;
    handleCurrent().catch((err) => setError(err.message));
  }, [apiBase, siteId]);

  useEffect(() => {
    if (!apiBase || !siteId) return;
    const signature = [
      normalizeDateInput(range.start),
      normalizeDateInput(range.end),
      range.resolution,
      siteId,
      token ? "token" : "no-token",
      anonKey ? "anon" : "no-anon",
    ].join("|");
    if (autoFetchRef.current === signature) return;
    const timer = window.setTimeout(() => {
      autoFetchRef.current = signature;
      handleFetch().catch((err) => setError(err.message));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [apiBase, siteId, range.start, range.end, range.resolution, token, anonKey]);

  useEffect(() => {
    if (!apiBase || !siteId) return;
    if (currentIntervalRef.current !== null) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (loadingRef.current.current) return;
      const now = Date.now();
      if (now - currentFetchAtRef.current < 110000) return;
      currentFetchAtRef.current = now;
      handleCurrent().catch((err) => setError(err.message));
    }, 120000);
    currentIntervalRef.current = interval;
    return () => {
      if (currentIntervalRef.current !== null) {
        window.clearInterval(currentIntervalRef.current);
        currentIntervalRef.current = null;
      }
    };
  }, [apiBase, siteId]);

  useEffect(() => {
    if (!apiBase) return;
    setLocalCaches(readLocalCacheList());
    if (apiBase.includes("functions.supabase.co")) return;
    fetchServerCaches(apiBase, anonKey)
      .then((list) => setServerCaches(list))
      .catch(() => setServerCaches([]));
  }, [apiBase, anonKey]);

  useEffect(() => {
    const combined = [...localCaches, ...serverCaches];
    if (!combined.length) return;
    setSelectedCache((prev) => prev || cacheId(combined[0]));
  }, [localCaches, serverCaches]);

  useEffect(() => {
    if (!payload) return;
    const base = payload.map((item) => ({
      time: item.startTime,
      value: solarForTime(new Date(item.startTime), solarProfile),
    }));
    setClearSkyCurve(base);
    const adjusted = weatherEnabled ? applyCloudCover(base, cloudCoverSmoothed) : base;
    setSolarCurve(adjusted);
  }, [payload, solarProfile, cloudCoverSmoothed, weatherEnabled]);

  useEffect(() => {
    if (!payload || !weatherEnabled) return;
    setWeatherStatus("Fetching weather...");
    const startDate = normalizeDateInput(range.start);
    const endDate = normalizeDateInput(range.end);
    if (!startDate || !endDate) {
      setWeatherStatus("Weather disabled: missing date range");
      return;
    }
    const finalStart = startDate <= endDate ? startDate : endDate;
    const finalEnd = startDate <= endDate ? endDate : startDate;
    fetchCloudCover(apiBase, anonKey, {
      startDate: finalStart,
      endDate: finalEnd,
      latitude: -35.2809,
      longitude: 149.13,
      timezone: "Australia/Canberra",
    })
      .then((data) => {
        if (!data.length) {
          const simulated = simulateCloudCover(payload.map((item) => item.startTime));
          setCloudCover(simulated);
          setWeatherStatus("Weather unavailable → using simulated cloud cover");
          return;
        }
        setCloudCover(data);
        setWeatherStatus(`Cloud cover loaded (${data.length} hrs)`);
      })
      .catch((err) => {
        const simulated = simulateCloudCover(payload.map((item) => item.startTime));
        setCloudCover(simulated);
        setWeatherStatus("Weather fetch failed → using simulated cloud cover");
        setError(err.message);
      });
  }, [apiBase, anonKey, payload, range.start, range.end, weatherEnabled]);

  const solarForecastCurve = useMemo(() => {
    if (!solarCurve.length || !solarForecast.enabled) return null;
    const temps = solarCurve.map((point) => point.value);
    let forecastTemps = temps;
    let dataStrength = 0.5;
    let modelBlend = 0.55;
    if (solarForecast.mode === "arima") {
      forecastTemps = arimaForecast(temps, temps.length);
      dataStrength = 0.4;
      modelBlend = 0.5;
    } else if (solarForecast.mode === "prophet") {
      forecastTemps = prophetForecast(temps, temps.length, 24);
      dataStrength = 0.55;
      modelBlend = 0.6;
    } else if (solarForecast.mode === "regression") {
      if (!usagePayload?.length || !cloudCover.length || !clearSkyCurve.length) {
        forecastTemps = temps;
      } else {
        const samples = usagePayload
          .filter((row) => row.channelType === "feedIn")
          .map((row) => ({
            time: row.startTime,
            cloudCover: cloudCoverByHour.get(row.startTime.slice(0, 13)) ?? 0,
            solarKw: row.kwh / intervalHours,
          }));
        const attenuationSamples = usagePayload
          .filter((row) => row.channelType === "feedIn")
          .map((row) => ({
            time: row.startTime,
            cloudCover: cloudCoverByHour.get(row.startTime.slice(0, 13)) ?? 0,
            baselineKw: clearSkyByHour.get(row.startTime.slice(0, 13)) ?? 0,
            solarKw: row.kwh / intervalHours,
          }));
        const model = trainSolarRegression(samples);
        const attenuationModel = trainSolarAttenuation(attenuationSamples);
        const regressionForecast = model
          ? predictSolar(model, solarCurve.map((point) => point.time), cloudCoverSmoothed)
          : null;
        const attenuationForecast = attenuationModel
          ? predictSolarAttenuation(attenuationModel, clearSkyCurve, cloudCoverSmoothed).map(
              (point) => point.value,
            )
          : null;
        dataStrength = clampNumber(samples.length / 96, 0, 1);
        forecastTemps = blendForecastSeries(temps, regressionForecast, attenuationForecast, dataStrength);
      }
      modelBlend = clampNumber(0.45 + 0.35 * dataStrength, 0.35, 0.85);
    } else {
      forecastTemps = temps.map((value) => value * solarForecast.multiplier);
      dataStrength = 0.35;
      modelBlend = 0.45;
    }
    if (!forecastTemps.length) return null;
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const cloudValues = cloudCoverSmoothed.map((point) => point.value);
    const cloudVolatility = cloudValues.length ? stdDev(cloudValues) : 0;
    const cloudDeltas = cloudValues.slice(1).map((value, idx) => Math.abs(value - cloudValues[idx]));
    const cloudChaos = cloudDeltas.length ? clampNumber(average(cloudDeltas) / 0.35, 0, 1) : 0;
    let cloudAttenModel: { slope: number; intercept: number; strength: number } | null = null;
    if (usagePayload?.length && clearSkyCurve.length) {
      const xs: number[] = [];
      const ys: number[] = [];
      const weights: number[] = [];
      usagePayload
        .filter((row) => row.channelType === "feedIn")
        .forEach((row) => {
          const hour = row.startTime.slice(0, 13);
          const baseline = clearSkyByHour.get(hour) ?? 0;
          if (baseline <= daylightThreshold) return;
          const cover = cloudCoverByHour.get(hour);
          if (cover === undefined || cover === null) return;
          const actualKw = Math.max(0, row.kwh / intervalHours);
          const ratio = clampNumber(actualKw / Math.max(0.1, baseline), 0.05, 1.2);
          const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
          xs.push(cover);
          ys.push(ratio);
          weights.push(weight);
        });
      const model = weightedLinearRegression(xs, ys, weights);
      if (model) {
        const slope = clampNumber(model.slope, -1.2, 0.2);
        const intercept = clampNumber(model.intercept, 0.25, 1.25);
        const directionPenalty = slope > 0 ? 0.4 : 1;
        const strength = clampNumber((weights.length / 48) * model.r2 * directionPenalty, 0, 1);
        cloudAttenModel = { slope, intercept, strength };
      }
    }
    const baselineTemps = solarCurve.map((point) => {
      const hour = point.time.slice(0, 13);
      const baseline = clearSkyByHour.get(hour) ?? 0;
      const cover = cloudCoverByHour.get(hour) ?? 0;
      const baseAtten = weatherEnabled ? clampNumber(1 - cover * 0.85, 0.08, 1) : 1;
      if (!weatherEnabled || !cloudAttenModel) {
        return baseline * baseAtten;
      }
      const modelAtten = clampNumber(
        cloudAttenModel.intercept + cloudAttenModel.slope * cover,
        0.05,
        1.05,
      );
      const blend = clampNumber(0.35 + 0.5 * cloudAttenModel.strength, 0.35, 0.85);
      const atten = baseAtten * (1 - blend) + modelAtten * blend;
      return baseline * atten;
    });
    const blendedForecast = forecastTemps.map((value, idx) => {
      const baseline = baselineTemps[idx] ?? value;
      const blend = clampNumber(modelBlend - cloudChaos * 0.2, 0.35, 0.85);
      return value * blend + baseline * (1 - blend);
    });
    let calibration = 1;
    if (usagePayload?.length) {
      const forecastByHour = new Map<string, number>();
      solarCurve.forEach((point, idx) => {
        forecastByHour.set(point.time.slice(0, 13), blendedForecast[idx] ?? point.value);
      });
      const ratios: number[] = [];
      const weights: number[] = [];
      usagePayload
        .filter((row) => row.channelType === "feedIn")
        .forEach((row) => {
          const hour = row.startTime.slice(0, 13);
          const baseline = clearSkyByHour.get(hour) ?? 0;
          if (baseline <= daylightThreshold) return;
          const forecast = forecastByHour.get(hour);
          if (!forecast || forecast <= 0.05) return;
          const actualKw = Math.max(0, row.kwh / intervalHours);
          const ratio = clampNumber(actualKw / forecast, 0.5, 1.6);
          const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
          ratios.push(ratio);
          weights.push(weight);
        });
      if (weights.length) {
        calibration = clampNumber(weightedAverage(ratios, weights), 0.7, 1.25);
      }
    }
    const calibratedTemps = blendedForecast.map((value) => value * calibration);
    let trackingAdjust = 1;
    let trackingStrength = 0;
    if (usagePayload?.length) {
      const forecastByHour = new Map<string, number>();
      solarCurve.forEach((point, idx) => {
        forecastByHour.set(point.time.slice(0, 13), calibratedTemps[idx] ?? point.value);
      });
      const actuals = usagePayload
        .filter((row) => row.channelType === "feedIn")
        .slice()
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      const lastTime = actuals.length
        ? new Date(actuals[actuals.length - 1].startTime).getTime()
        : null;
      const cutoff = lastTime ? lastTime - 24 * 60 * 60 * 1000 : null;
      const recentActuals = cutoff
        ? actuals.filter((row) => new Date(row.startTime).getTime() >= cutoff)
        : actuals;
      const ratios: number[] = [];
      const weights: number[] = [];
      recentActuals.forEach((row) => {
        const hour = row.startTime.slice(0, 13);
        const baseline = clearSkyByHour.get(hour) ?? 0;
        if (baseline <= daylightThreshold) return;
        const forecast = forecastByHour.get(hour);
        if (!forecast || forecast <= 0.05) return;
        const actualKw = Math.max(0, row.kwh / intervalHours);
        const ratio = clampNumber(actualKw / forecast, 0.7, 1.3);
        const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.2, 1);
        ratios.push(ratio);
        weights.push(weight);
      });
      if (weights.length) {
        trackingAdjust = clampNumber(weightedAverage(ratios, weights), 0.85, 1.15);
        trackingStrength = clampNumber(weights.length / 24, 0, 1);
      }
    }
    const trackingBlend = clampNumber(0.2 + 0.4 * trackingStrength, 0.2, 0.6);
    const trackingAdjustedTemps = calibratedTemps.map(
      (value) => value * (1 + (trackingAdjust - 1) * trackingBlend),
    );
    const hourlyBlend = solarHourlyProfile
      ? clampNumber(0.25 + 0.55 * solarHourlyProfile.strength, 0.25, 0.7)
      : 0;
    const hourlyAdjustedTemps = trackingAdjustedTemps.map((value, idx) => {
      if (!solarHourlyProfile) return value;
      const hour = new Date(solarCurve[idx].time).getHours();
      const entry = solarHourlyProfile.byHour.get(hour);
      if (!entry) return value;
      return value * (1 + (entry.value - 1) * hourlyBlend);
    });
    let hourBiasBlend = 0;
    const hourBiasByHour = new Map<number, number>();
    if (usagePayload?.length) {
      const forecastByHour = new Map<string, number>();
      solarCurve.forEach((point, idx) => {
        forecastByHour.set(point.time.slice(0, 13), trackingAdjustedTemps[idx] ?? point.value);
      });
      const actuals = usagePayload
        .filter((row) => row.channelType === "feedIn")
        .slice()
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      const lastTime = actuals.length
        ? new Date(actuals[actuals.length - 1].startTime).getTime()
        : null;
      const cutoff = lastTime ? lastTime - 48 * 60 * 60 * 1000 : null;
      const recentActuals = cutoff
        ? actuals.filter((row) => new Date(row.startTime).getTime() >= cutoff)
        : actuals;
      const buckets = new Map<number, { sum: number; weight: number }>();
      recentActuals.forEach((row) => {
        const hourKey = row.startTime.slice(0, 13);
        const baseline = clearSkyByHour.get(hourKey) ?? 0;
        if (baseline <= daylightThreshold) return;
        const forecast = forecastByHour.get(hourKey);
        if (!forecast || forecast <= 0.05) return;
        const actualKw = Math.max(0, row.kwh / intervalHours);
        const ratio = clampNumber(actualKw / forecast, 0.7, 1.3);
        const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
        const hour = new Date(row.startTime).getHours();
        const entry = buckets.get(hour) ?? { sum: 0, weight: 0 };
        entry.sum += ratio * weight;
        entry.weight += weight;
        buckets.set(hour, entry);
      });
      if (buckets.size) {
        let totalWeight = 0;
        buckets.forEach((entry) => {
          totalWeight += entry.weight;
        });
        const strength = clampNumber(totalWeight / 24, 0, 1);
        hourBiasBlend = clampNumber(0.15 + 0.45 * strength, 0.15, 0.6);
        buckets.forEach((entry, hour) => {
          const ratio = entry.weight ? entry.sum / entry.weight : 1;
          hourBiasByHour.set(hour, clampNumber(ratio, 0.75, 1.25));
        });
      }
    }
    const hourBiasAdjustedTemps = hourlyAdjustedTemps.map((value, idx) => {
      if (!hourBiasByHour.size) return value;
      const hour = new Date(solarCurve[idx].time).getHours();
      const ratio = hourBiasByHour.get(hour);
      if (!ratio) return value;
      return value * (1 + (ratio - 1) * hourBiasBlend);
    });
    const clearIndexBlend = solarClearIndex
      ? clampNumber(0.15 + 0.35 * clampNumber(solarClearIndex.sampleCount / 24, 0, 1), 0.15, 0.5)
      : 0;
    const clearIndexFactor =
      solarClearIndex && solarClearIndex.index !== null
        ? 1 + (solarClearIndex.index - 1) * clearIndexBlend
        : 1;
    const clearIndexAdjustedTemps = hourBiasAdjustedTemps.map((value, idx) => {
      const baseline = clearSkyByHour.get(solarCurve[idx].time.slice(0, 13)) ?? 0;
      if (baseline <= daylightThreshold) return 0;
      return value * clearIndexFactor;
    });
    const smoothWindow = clampNumber(
      Math.round((dataStrength >= 0.75 ? 1 : dataStrength >= 0.45 ? 2 : 3) + cloudChaos * 2),
      1,
      5,
    );
    const smoothedForecast = smoothSeries(clearIndexAdjustedTemps, smoothWindow);
    const padded = smoothedForecast.length < temps.length
      ? temps.slice(0, temps.length - smoothedForecast.length).concat(smoothedForecast)
      : smoothedForecast.slice(0, temps.length);
    return solarCurve.map((point, idx) => {
      const adjusted = padded[idx] ?? point.value;
      const baseline = clearSkyByHour.get(point.time.slice(0, 13)) ?? 0;
      if (baseline <= daylightThreshold) {
        return { time: point.time, value: 0 };
      }
      const cap = baseline * (1.02 + 0.1 * (1 - cloudVolatility));
      const floor = baseline * 0.1;
      const capped = cap ? Math.min(adjusted, cap) : adjusted;
      const floored = Math.max(floor, capped);
      return {
        time: point.time,
        value: Math.max(0, floored),
      };
    });
  }, [
    solarCurve,
    clearSkyCurve,
    solarForecast,
    usagePayload,
    intervalHours,
    cloudCoverByHour,
    cloudCoverSmoothed,
    cloudCover.length,
    clearSkyByHour,
    solarHourlyProfile,
    solarClearIndex,
    weatherEnabled,
  ]);

  const cloudCoverCurve = useMemo(() => cloudCoverSmoothed, [cloudCoverSmoothed]);
  const solarZoomed = useMemo(
    () => (solarZoom ? solarCurve.slice(solarZoom[0], solarZoom[1] + 1) : solarCurve),
    [solarCurve, solarZoom],
  );
  const solarForecastZoomed = useMemo(
    () =>
      solarForecastCurve && solarZoom
        ? solarForecastCurve.slice(solarZoom[0], solarZoom[1] + 1)
        : solarForecastCurve,
    [solarForecastCurve, solarZoom],
  );
  const cloudCoverZoomed = useMemo(
    () => (solarZoom ? cloudCoverCurve.slice(solarZoom[0], solarZoom[1] + 1) : cloudCoverCurve),
    [cloudCoverCurve, solarZoom],
  );

  const solarDaily = useMemo(() => {
    if (!solarCurve.length) return [];
    return buildSolarDaily(solarCurve, payload, usagePayload, range.resolution);
  }, [solarCurve, payload, usagePayload, range.resolution]);
  const latestSolarDay = useMemo(
    () => (solarDaily.length ? solarDaily[solarDaily.length - 1] : null),
    [solarDaily],
  );

  const weatherSummary = useMemo(() => {
    if (!cloudCoverSmoothed.length) {
      return {
        avg: null as number | null,
        peak: null as number | null,
        trend: "—",
        sampleCount: 0,
      };
    }
    const values = cloudCoverSmoothed.map((point) => point.value);
    const avg = average(values);
    const peak = Math.max(...values);
    const bucket = Math.max(1, Math.floor(values.length / 3));
    const firstAvg = average(values.slice(0, bucket));
    const lastAvg = average(values.slice(-bucket));
    const delta = lastAvg - firstAvg;
    const trend =
      Math.abs(delta) < 0.05 ? "Stable" : delta > 0 ? "Thickening" : "Clearing";
    return { avg, peak, trend, sampleCount: values.length };
  }, [cloudCoverSmoothed]);

  const solarForecastMetrics = useMemo(() => {
    if (!usagePayload?.length || !solarForecastCurve?.length) return null;
    const forecastByHour = new Map<string, number>();
    solarForecastCurve.forEach((point) => {
      forecastByHour.set(point.time.slice(0, 13), point.value);
    });
    const clearSkyByHour = new Map<string, number>();
    clearSkyCurve.forEach((point) => {
      clearSkyByHour.set(point.time.slice(0, 13), point.value);
    });
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const absErrors: number[] = [];
    const signed: number[] = [];
    const pctErrors: number[] = [];
    const actualValues: number[] = [];
    const weights: number[] = [];
    const actuals = usagePayload.filter((row) => row.channelType === "feedIn");
    let eligible = 0;
    actuals.forEach((row) => {
      const hour = row.startTime.slice(0, 13);
      const forecast = forecastByHour.get(hour);
      if (forecast === undefined) return;
      const baseline = clearSkyByHour.get(hour) ?? 0;
      if (baseline <= daylightThreshold) return;
      eligible += 1;
      const actualKw = Math.max(0, row.kwh / intervalHours);
      const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
      if (weight <= 0) return;
      const err = forecast - actualKw;
      absErrors.push(Math.abs(err));
      signed.push(err);
      pctErrors.push(Math.abs(err) / Math.max(0.25, actualKw));
      actualValues.push(actualKw);
      weights.push(weight);
    });
    if (!weights.length) return null;
    const mae = weightedAverage(absErrors, weights);
    const mape = weightedAverage(pctErrors, weights);
    const bias = weightedAverage(signed, weights);
    const rmse = Math.sqrt(weightedAverage(signed.map((err) => err * err), weights));
    const actualMean = weightedAverage(actualValues, weights);
    const ssTot = weightedAverage(actualValues.map((v) => Math.pow(v - actualMean, 2)), weights);
    const ssRes = weightedAverage(signed.map((err) => err * err), weights);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
    const biasPct = actualMean !== 0 ? bias / actualMean : null;
    const coverage = eligible > 0 ? weights.length / eligible : weights.length / Math.max(1, actuals.length);
    const skill = clampNumber(1 - mape / 0.55, 0, 1);
    const skillLabel =
      skill >= 0.72 ? "Strong skill" : skill >= 0.5 ? "Moderate skill" : "Low skill";
    return {
      mae,
      mape,
      bias,
      biasPct,
      rmse,
      r2,
      coverage,
      skill,
      skillLabel,
      sampleCount: weights.length,
      daylightCount: eligible,
      clearMax,
    };
  }, [usagePayload, solarForecastCurve, clearSkyCurve, intervalHours]);

  const solarForecastDiagnostics = useMemo(() => {
    if (!usagePayload?.length || !solarForecastCurve?.length || !clearSkyCurve.length) {
      return {
        trackingScore: null as number | null,
        trackingLabel: "Tracking pending",
        trackingNote: "Awaiting tracking samples",
        biasPct: null as number | null,
        recentBiasLabel: "Bias pending",
        mae: null as number | null,
        mape: null as number | null,
        corr: null as number | null,
        sampleCount: 0,
        windowLabel: "Window pending",
      };
    }
    const forecastByHour = new Map<string, number>();
    solarForecastCurve.forEach((point) => {
      forecastByHour.set(point.time.slice(0, 13), point.value);
    });
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const actuals = usagePayload
      .filter((row) => row.channelType === "feedIn")
      .slice()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    if (!actuals.length) {
      return {
        trackingScore: null as number | null,
        trackingLabel: "Tracking pending",
        trackingNote: "Awaiting tracking samples",
        biasPct: null as number | null,
        recentBiasLabel: "Bias pending",
        mae: null as number | null,
        mape: null as number | null,
        corr: null as number | null,
        sampleCount: 0,
        windowLabel: "Window pending",
      };
    }
    const lastTime = new Date(actuals[actuals.length - 1].startTime).getTime();
    const cutoff = lastTime - 24 * 60 * 60 * 1000;
    const recentActuals = actuals.filter(
      (row) => new Date(row.startTime).getTime() >= cutoff,
    );
    const usingRecent = recentActuals.length >= 6;
    const source = usingRecent ? recentActuals : actuals;
    const absErrors: number[] = [];
    const signed: number[] = [];
    const pctErrors: number[] = [];
    const actualValues: number[] = [];
    const forecastValues: number[] = [];
    const weights: number[] = [];
    source.forEach((row) => {
      const hour = row.startTime.slice(0, 13);
      const baseline = clearSkyByHour.get(hour) ?? 0;
      if (baseline <= daylightThreshold) return;
      const forecast = forecastByHour.get(hour);
      if (forecast === undefined) return;
      const actualKw = Math.max(0, row.kwh / intervalHours);
      const err = forecast - actualKw;
      absErrors.push(Math.abs(err));
      signed.push(err);
      pctErrors.push(Math.abs(err) / Math.max(0.25, actualKw));
      actualValues.push(actualKw);
      forecastValues.push(forecast);
      const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
      weights.push(weight);
    });
    if (!weights.length) {
      return {
        trackingScore: null as number | null,
        trackingLabel: "Tracking pending",
        trackingNote: "Awaiting tracking samples",
        biasPct: null as number | null,
        recentBiasLabel: "Bias pending",
        mae: null as number | null,
        mape: null as number | null,
        corr: null as number | null,
        sampleCount: 0,
        windowLabel: usingRecent ? "Last 24h" : "All samples",
      };
    }
    const mae = weightedAverage(absErrors, weights);
    const mape = weightedAverage(pctErrors, weights);
    const bias = weightedAverage(signed, weights);
    const actualMean = weightedAverage(actualValues, weights);
    const biasPct = actualMean !== 0 ? bias / actualMean : null;
    const corr = actualValues.length >= 6 ? correlation(actualValues, forecastValues) : null;
    const trackingScore = clampNumber(1 - mape / 0.6, 0, 1);
    const trackingLabel =
      trackingScore >= 0.7 ? "Tracking strong" : trackingScore >= 0.45 ? "Tracking mixed" : "Tracking weak";
    const recentBiasLabel =
      biasPct === null
        ? "Bias pending"
        : biasPct > 0.08
          ? "Recent over-forecast"
          : biasPct < -0.08
            ? "Recent under-forecast"
            : "Recent bias balanced";
    const trackingNote = `MAPE ${Math.round(mape * 100)}% · Corr ${corr === null ? "—" : corr.toFixed(2)}`;
    return {
      trackingScore,
      trackingLabel,
      trackingNote,
      biasPct,
      recentBiasLabel,
      mae,
      mape,
      corr,
      sampleCount: weights.length,
      windowLabel: usingRecent ? "Last 24h" : "All samples",
    };
  }, [
    usagePayload,
    solarForecastCurve,
    clearSkyCurve,
    clearSkyByHour,
    intervalHours,
  ]);

  const solarCalibration = useMemo(() => {
    if (!usagePayload?.length || !solarForecastCurve?.length || !clearSkyCurve.length) return null;
    const forecastByHour = new Map<string, number>();
    solarForecastCurve.forEach((point) => {
      forecastByHour.set(point.time.slice(0, 13), point.value);
    });
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const ratios: number[] = [];
    const weights: number[] = [];
    usagePayload
      .filter((row) => row.channelType === "feedIn")
      .forEach((row) => {
        const hour = row.startTime.slice(0, 13);
        const baseline = clearSkyByHour.get(hour) ?? 0;
        if (baseline <= daylightThreshold) return;
        const forecast = forecastByHour.get(hour);
        if (!forecast || forecast <= 0.05) return;
        const actualKw = Math.max(0, row.kwh / intervalHours);
        const ratio = clampNumber(actualKw / forecast, 0.5, 1.6);
        const weight = clampNumber(baseline / Math.max(0.35, clearMax), 0.15, 1);
        ratios.push(ratio);
        weights.push(weight);
      });
    if (!weights.length) return null;
    const factor = clampNumber(weightedAverage(ratios, weights), 0.7, 1.25);
    const label = factor > 1.08 ? "Under-forecasting" : factor < 0.92 ? "Over-forecasting" : "Calibrated";
    return { factor, label, sampleCount: weights.length };
  }, [usagePayload, solarForecastCurve, clearSkyCurve, intervalHours, clearSkyByHour]);

  const weatherImpact = useMemo(() => {
    if (!cloudCoverSmoothed.length) {
      return {
        avg: null as number | null,
        variance: null as number | null,
        clearHours: 0,
        impactScore: null as number | null,
        impactLabel: "Awaiting weather feed",
        impactSummary: "Awaiting weather feed",
        impactNote: "Load weather + solar to score impact",
        variabilityLabel: "—",
        cloudLossPct: null as number | null,
        solarLossPct: null as number | null,
        solarLossLabel: "Loss pending",
        confidence: null as number | null,
        confidenceLabel: "Awaiting forecast",
        persistence: null as number | null,
        persistenceLabel: "Awaiting weather feed",
        morningAvg: null as number | null,
        afternoonAvg: null as number | null,
        diurnalBias: null as number | null,
        diurnalLabel: "Awaiting weather feed",
        skill: solarForecastMetrics?.skill ?? null,
        skillLabel: solarForecastMetrics?.skillLabel ?? "Awaiting model fit",
        forecastQualityScore: null as number | null,
        forecastQualityLabel: "Forecast pending",
        forecastQualityNote: "Awaiting solar samples",
        clearSkyIndex: null as number | null,
        clearSkyLabel: "Clear-sky index pending",
        solarOutlookLabel: "Solar outlook pending",
        solarOutlookNote: "Awaiting feed-in data",
        biasLabel: "Bias pending",
        signalCorrelation: null as number | null,
        signalLabel: "Signal pending",
        signalStrengthLabel: "Signal pending",
        reliabilityScore: null as number | null,
        reliabilityLabel: "Reliability pending",
        rampRiskScore: null as number | null,
        rampLabel: "Ramp risk pending",
        trackingScore: solarForecastDiagnostics?.trackingScore ?? null,
        trackingLabel: solarForecastDiagnostics?.trackingLabel ?? "Tracking pending",
        trackingNote: solarForecastDiagnostics?.trackingNote ?? "Awaiting tracking samples",
        trackingWindow: solarForecastDiagnostics?.windowLabel ?? "Window pending",
        recentBiasLabel: solarForecastDiagnostics?.recentBiasLabel ?? "Bias pending",
        bestWindowLabel: "Window pending",
        bestWindowNote: "Awaiting weather feed",
        hourlyFitScore: solarHourlyProfile?.strength ?? null,
        hourlyFitLabel: solarHourlyProfile?.label ?? "Diurnal fit pending",
        hourlyCoverage: solarHourlyProfile?.coverage ?? null,
        daylightCoverage: null as number | null,
        sampleCount: 0,
        changeRate: null as number | null,
      };
    }
    const values = cloudCoverSmoothed.map((point) => point.value);
    const avg = average(values);
    const variance = stdDev(values);
    const clearHours = values.filter((value) => value < 0.35).length;
    const deltas = values.slice(1).map((value, idx) => Math.abs(value - values[idx]));
    const changeRate = deltas.length ? average(deltas) : 0;
    const persistence = clampNumber(1 - changeRate / 0.35, 0, 1);
    const persistenceLabel =
      persistence >= 0.7 ? "Stable pattern" : persistence >= 0.45 ? "Mixed pattern" : "Choppy pattern";
    const phases = cloudCoverSmoothed.reduce(
      (acc, point) => {
        const hour = new Date(point.time).getHours();
        if (hour >= 6 && hour < 12) acc.morning.push(point.value);
        if (hour >= 12 && hour < 18) acc.afternoon.push(point.value);
        if (hour >= 18 && hour < 23) acc.evening.push(point.value);
        return acc;
      },
      { morning: [] as number[], afternoon: [] as number[], evening: [] as number[] },
    );
    const morningAvg = phases.morning.length ? average(phases.morning) : null;
    const afternoonAvg = phases.afternoon.length ? average(phases.afternoon) : null;
    const diurnalBias =
      morningAvg !== null && afternoonAvg !== null ? afternoonAvg - morningAvg : null;
    const diurnalLabel =
      diurnalBias === null
        ? "Diurnal balance pending"
        : Math.abs(diurnalBias) < 0.05
          ? "Balanced cloud cover"
          : diurnalBias > 0
            ? "Cloudier afternoons"
            : "Cloudier mornings";
    const clearSkyIndex = solarClearIndex?.index ?? null;
    const clearSkyLabel =
      clearSkyIndex === null
        ? "Clear-sky index pending"
        : clearSkyIndex >= 1.05
          ? "Above clear-sky"
          : clearSkyIndex >= 0.9
            ? "Near clear-sky"
            : clearSkyIndex >= 0.75
              ? "Below clear-sky"
              : "Weak solar output";
    const solarOutlookLabel =
      clearSkyIndex === null
        ? "Solar outlook pending"
        : clearSkyIndex >= 0.95
          ? "Solar holding"
          : clearSkyIndex >= 0.8
            ? "Solar softened"
            : "Solar weak";
    const solarOutlookNote =
      clearSkyIndex === null
        ? "Awaiting feed-in data"
        : `Clear-sky index ${(clearSkyIndex * 100).toFixed(0)}%`;
    let cloudLossPct: number | null = null;
    let solarLossPct: number | null = null;
    const clearSkyByHour = new Map<string, number>();
    clearSkyCurve.forEach((point) => {
      clearSkyByHour.set(point.time.slice(0, 13), point.value);
    });
    if (clearSkyCurve.length && solarCurve.length) {
      const clearTotal = clearSkyCurve.reduce((acc, point) => acc + point.value, 0);
      const adjustedTotal = solarCurve.reduce((acc, point) => acc + point.value, 0);
      if (clearTotal > 0) {
        cloudLossPct = clampNumber((clearTotal - adjustedTotal) / clearTotal, 0, 1);
      }
    }
    let baselineTotal = 0;
    let actualTotal = 0;
    const ratioSeries: number[] = [];
    const coverSeries: number[] = [];
    const clearValues = clearSkyCurve.map((point) => point.value);
    const clearMax = clearValues.length ? Math.max(...clearValues) : 0;
    const daylightThreshold = clearMax * 0.12;
    const actuals = usagePayload?.filter((row) => row.channelType === "feedIn") ?? [];
    actuals.forEach((row) => {
      const hour = row.startTime.slice(0, 13);
      const baseline = clearSkyByHour.get(hour) ?? 0;
      if (baseline <= daylightThreshold) return;
      const actualKw = Math.max(0, row.kwh / intervalHours);
      baselineTotal += baseline;
      actualTotal += actualKw;
      const ratio = clampNumber(actualKw / Math.max(0.1, baseline), 0, 1.5);
      ratioSeries.push(ratio);
      coverSeries.push(cloudCoverByHour.get(hour) ?? 0);
    });
    if (baselineTotal > 0) {
      solarLossPct = clampNumber((baselineTotal - actualTotal) / baselineTotal, 0, 1);
    }
    const signalCorrelation =
      ratioSeries.length >= 6 ? correlation(coverSeries, ratioSeries) : null;
    const signalStrength =
      signalCorrelation === null ? 0 : clampNumber(Math.abs(signalCorrelation), 0, 1);
    const signalLabel =
      signalCorrelation === null
        ? "Signal pending"
        : signalStrength >= 0.6
          ? signalCorrelation < 0
            ? "Strong inverse"
            : "Strong direct"
          : signalStrength >= 0.35
            ? signalCorrelation < 0
              ? "Moderate inverse"
              : "Moderate direct"
            : "Weak link";
    const signalStrengthLabel =
      signalCorrelation === null
        ? "Signal pending"
        : signalStrength >= 0.6
          ? "Strong link"
          : signalStrength >= 0.35
            ? "Moderate link"
            : "Weak link";
    const signalDirection =
      signalCorrelation === null
        ? 0
        : signalCorrelation < -0.05
          ? 1
          : signalCorrelation > 0.05
            ? 0.35
            : 0.7;
    const signalQuality = clampNumber(signalStrength * signalDirection, 0, 1);
    const diurnalFactor =
      diurnalBias === null ? 0 : Math.min(0.25, Math.abs(diurnalBias) * 0.6);
    const lossAnchor = solarLossPct ?? cloudLossPct ?? 0;
    const clearIndexPenalty = clearSkyIndex === null ? 0 : clampNumber(1 - clearSkyIndex, 0, 1);
    const impactScore = clampNumber(
      avg * 0.22 +
        variance * 0.14 +
        lossAnchor * 0.32 +
        diurnalFactor * 0.08 +
        (1 - persistence) * 0.1 +
        signalQuality * 0.07 +
        clearIndexPenalty * 0.07,
      0,
      1,
    );
    const impactLabel =
      impactScore > 0.6 ? "High cloud impact" : impactScore > 0.35 ? "Moderate cloud impact" : "Low cloud impact";
    const solarLossLabel =
      solarLossPct === null ? "Loss pending" : `${Math.round(solarLossPct * 100)}% loss vs clear sky`;
    const variabilityLabel =
      variance > 0.18 ? "Volatile cover" : variance > 0.1 ? "Mixed cover" : "Stable cover";
    const biasPct = solarForecastMetrics?.biasPct ?? solarForecastDiagnostics?.biasPct ?? null;
    const biasLabel =
      biasPct === null
        ? "Bias pending"
        : biasPct > 0.08
          ? "Over-forecasting"
          : biasPct < -0.08
            ? "Under-forecasting"
            : "Bias balanced";
    const biasPenalty = biasPct === null ? 0.3 : clampNumber(Math.abs(biasPct) / 0.35, 0, 1);
    const signalPenalty = signalCorrelation !== null && signalCorrelation > 0.15
      ? clampNumber(signalCorrelation, 0, 1)
      : 0;
    const sampleStrength = solarForecastMetrics
      ? clampNumber(solarForecastMetrics.sampleCount / 64, 0, 1)
      : 0;
    const hourlyStrength = solarHourlyProfile?.strength ?? 0;
    const trackingScore = solarForecastDiagnostics?.trackingScore ?? null;
    const forecastQualityScore = solarForecastMetrics
      ? clampNumber(
          0.45 * solarForecastMetrics.skill +
            0.2 * solarForecastMetrics.coverage +
            0.12 * (1 - biasPenalty) +
            0.18 * (trackingScore ?? 0) +
            0.1 * sampleStrength +
            0.1 * signalQuality -
            0.08 * signalPenalty +
            0.08 * hourlyStrength,
          0,
          1,
        )
      : trackingScore !== null
        ? clampNumber(0.6 * trackingScore + 0.3 * (1 - biasPenalty) + 0.1 * hourlyStrength, 0, 1)
        : null;
    const reliabilityScore = solarForecastMetrics
      ? clampNumber(
          0.3 * solarForecastMetrics.skill +
            0.2 * solarForecastMetrics.coverage +
            0.18 * (1 - biasPenalty) +
            0.12 * sampleStrength +
            0.12 * (trackingScore ?? 0) +
            0.1 * signalQuality -
            0.08 * signalPenalty +
            0.08 * hourlyStrength,
          0,
          1,
        )
      : trackingScore !== null
        ? clampNumber(0.65 * trackingScore + 0.25 * (1 - biasPenalty) + 0.1 * hourlyStrength, 0, 1)
        : null;
    const reliabilityLabel =
      reliabilityScore === null
        ? "Reliability pending"
        : reliabilityScore >= 0.7
          ? "High reliability"
          : reliabilityScore >= 0.45
            ? "Medium reliability"
            : "Low reliability";
    const forecastQualityLabel =
      forecastQualityScore === null
        ? "Forecast pending"
        : forecastQualityScore >= 0.7
          ? "High forecast quality"
          : forecastQualityScore >= 0.45
            ? "Medium forecast quality"
            : "Low forecast quality";
    const forecastQualityNote = solarForecastMetrics
      ? `MAPE ${Math.round(solarForecastMetrics.mape * 100)}% · MAE ${solarForecastMetrics.mae.toFixed(2)} kW`
      : solarForecastDiagnostics?.trackingNote ?? "Awaiting solar samples";
    const impactSummary = impactLabel;
    const impactNote = `${variabilityLabel} · ${solarLossLabel}`;
    const rampRiskScore = clampNumber(changeRate * 0.65 + variance * 0.35, 0, 1);
    const rampLabel =
      rampRiskScore >= 0.6 ? "Fast ramps" : rampRiskScore >= 0.35 ? "Moderate ramps" : "Slow ramps";
    const bestWindowLabel =
      diurnalBias === null
        ? "Window pending"
        : diurnalBias > 0.05
          ? "Morning window"
          : diurnalBias < -0.05
            ? "Afternoon window"
            : "Balanced window";
    const bestWindowNote =
      clearHours >= 6
        ? `Clear slots ${clearHours} hrs`
        : clearHours >= 3
          ? `Limited clear slots ${clearHours} hrs`
          : "Cloud cover heavy";
    const confidenceBase = solarForecastMetrics
      ? clampNumber(1 - solarForecastMetrics.mape / 0.55, 0, 1)
      : trackingScore !== null
        ? clampNumber(trackingScore, 0, 1)
        : null;
    const coverageFactor = solarForecastMetrics
      ? clampNumber(0.65 + 0.35 * solarForecastMetrics.coverage, 0, 1)
      : 0.7;
    const trackingFactor = trackingScore === null ? 1 : clampNumber(0.7 + 0.3 * trackingScore, 0.7, 1);
    const confidence = solarForecastMetrics
      ? clampNumber(
          (confidenceBase ?? 0) *
            coverageFactor *
            clampNumber(0.7 + 0.3 * persistence, 0, 1) *
            clampNumber(0.7 + 0.3 * signalQuality, 0, 1) *
            trackingFactor,
          0,
          1,
        )
      : trackingScore !== null
        ? clampNumber(
            (confidenceBase ?? 0) *
              clampNumber(0.7 + 0.3 * persistence, 0, 1) *
              trackingFactor,
            0,
            1,
          )
        : null;
    const confidenceLabel =
      confidence === null
        ? "Awaiting forecast"
        : confidence >= 0.7
          ? "High confidence"
          : confidence >= 0.45
            ? "Medium confidence"
            : "Low confidence";
    return {
      avg,
      variance,
      clearHours,
      impactScore,
      impactLabel,
      impactSummary,
      impactNote,
      variabilityLabel,
      cloudLossPct,
      solarLossPct,
      solarLossLabel,
      confidence,
      confidenceLabel,
      persistence,
      persistenceLabel,
      morningAvg,
      afternoonAvg,
      diurnalBias,
      diurnalLabel,
      skill: solarForecastMetrics?.skill ?? null,
      skillLabel: solarForecastMetrics?.skillLabel ?? "Awaiting model fit",
      forecastQualityScore,
      forecastQualityLabel,
      forecastQualityNote,
      clearSkyIndex,
      clearSkyLabel,
      solarOutlookLabel,
      solarOutlookNote,
      biasLabel,
      signalCorrelation,
      signalLabel,
      signalStrengthLabel,
      reliabilityScore,
      reliabilityLabel,
      rampRiskScore,
      rampLabel,
      trackingScore,
      trackingLabel: solarForecastDiagnostics?.trackingLabel ?? "Tracking pending",
      trackingNote: solarForecastDiagnostics?.trackingNote ?? "Awaiting tracking samples",
      trackingWindow: solarForecastDiagnostics?.windowLabel ?? "Window pending",
      recentBiasLabel: solarForecastDiagnostics?.recentBiasLabel ?? biasLabel,
      bestWindowLabel,
      bestWindowNote,
      hourlyFitScore: solarHourlyProfile?.strength ?? null,
      hourlyFitLabel: solarHourlyProfile?.label ?? "Diurnal fit pending",
      hourlyCoverage: solarHourlyProfile?.coverage ?? null,
      daylightCoverage: actuals.length ? ratioSeries.length / actuals.length : null,
      sampleCount: ratioSeries.length,
      changeRate,
    };
  }, [
    cloudCoverSmoothed,
    solarForecastMetrics,
    solarForecastDiagnostics,
    clearSkyCurve,
    solarCurve,
    usagePayload,
    intervalHours,
    cloudCoverByHour,
    solarHourlyProfile,
    solarClearIndex,
  ]);

  useEffect(() => {
    if (!payload || !workerRef.current) return;
    setStatus("Crunching backtest...");
    setLoading((prev) => ({ ...prev, crunch: true }));
    workerRef.current.onmessage = (event) => {
      setStrategies(event.data.strategies);
      if (event.data.strategies.length) {
        setActiveStrategy(event.data.strategies[0].name);
        setCompareA(event.data.strategies[0].name);
        setCompareB(event.data.strategies[1]?.name || event.data.strategies[0].name);
      }
      setWindowStart(0);
      setStatus(`Loaded ${event.data.strategies[0]?.points.length || 0} intervals.`);
      setLoading((prev) => ({ ...prev, crunch: false }));
    };
    const solar = payload.map((item) =>
      solarForTime(new Date(item.startTime), solarProfile),
    );
    workerRef.current.postMessage({ payload, config, solar, custom: { name: customName, rules: customRules } });
  }, [payload, config, solarProfile, customName, customRules]);

  const active = useMemo(
    () => strategies.find((s) => s.name === activeStrategy) || strategies[0],
    [strategies, activeStrategy],
  );

  useEffect(() => {
    if (!active?.points.length) return;
    const maxStart = Math.max(0, active.points.length - windowSize);
    setWindowStart((prev) => Math.min(prev, maxStart));
  }, [active?.points.length, windowSize]);
  const usageBaseline = useMemo(() => {
    if (!usagePayload?.length) return null;
    const sorted = [...usagePayload].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    let runningCostAud = 0;
    const startStamp = toDayStamp(new Date(sorted[0].startTime));
    const points: BacktestPoint[] = sorted.map((row) => {
      const start = new Date(row.startTime);
      const dayIndex = Math.max(0, dayDiff(startStamp, toDayStamp(start)));
      const costAud = row.cost / 100;
      runningCostAud += costAud;
      return {
        time: row.startTime,
        soc: config.startSoc,
        buy: row.channelType === "general" ? row.perKwh : 0,
        sell: row.channelType === "feedIn" ? row.perKwh : 0,
        cash: -runningCostAud,
        cumulativeProfit: -(runningCostAud + config.dailyChargeAud * (dayIndex + 1)),
      };
    });
    const buyKwh = sorted
      .filter((row) => row.channelType === "general")
      .reduce((acc, row) => acc + row.kwh, 0);
    const sellKwh = sorted
      .filter((row) => row.channelType === "feedIn")
      .reduce((acc, row) => acc + row.kwh, 0);
    const days = countDays(points);
    const profit = points.length
      ? points[points.length - 1].cash - config.dailyChargeAud * days
      : 0;
    const summary = { profit, buyKwh, sellKwh, endSoc: config.startSoc };
    return { name: "Baseline (Actual Usage)", points, summary };
  }, [usagePayload, config.dailyChargeAud, config.startSoc]);

  const usageDailySeries = useMemo(() => {
    if (!usagePayload?.length) return null;
    const daily = new Map<
      string,
      { date: string; importKwh: number; exportKwh: number }
    >();
    usagePayload.forEach((row) => {
      const day = row.date || row.startTime.slice(0, 10);
      if (!daily.has(day)) {
        daily.set(day, { date: day, importKwh: 0, exportKwh: 0 });
      }
      const entry = daily.get(day)!;
      const kwh = Math.abs(row.kwh || 0);
      if (row.channelType === "general") {
        entry.importKwh += kwh;
      } else if (row.channelType === "feedIn") {
        entry.exportKwh += kwh;
      }
    });
    return Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [usagePayload]);

  const baseline = useMemo(
    () => usageBaseline ?? strategies.find((s) => s.name === "Baseline (No Trades)"),
    [usageBaseline, strategies],
  );

  const compareLeft = useMemo(
    () => strategies.find((s) => s.name === compareA) || strategies[0],
    [strategies, compareA],
  );
  const compareRight = useMemo(
    () => strategies.find((s) => s.name === compareB) || strategies[1] || strategies[0],
    [strategies, compareB],
  );
  const compareWinner =
    compareLeft && compareRight
      ? compareLeft.summary.profit >= compareRight.summary.profit
        ? compareLeft.name
        : compareRight.name
      : "";
  const baselineName = baseline?.name || "Baseline";
  const strategyNotes = useMemo(
    () => ({
      "Baseline (Actual Usage)": "Historical usage + daily charge. No trading actions.",
      "Baseline (Fees Only)": "Daily supply charge only.",
      "Baseline (Solar Export)": "Solar exports only. No battery trades.",
      "Baseline (No Trades)": "No buy/sell. Solar can charge battery.",
      Threshold: "Buy below threshold, sell above threshold.",
      Percentile: "Use rolling percentiles for buy/sell triggers.",
      "Mean Reversion": "Buy below mean-std, sell above mean+std.",
      Momentum: "Follow short-term slope direction.",
      "Time Window": "Charge overnight, sell at evening peak window.",
      "Solar Assist": "Buy when solar is low, sell on high feed-in.",
      "Spike Avoider": "Avoid buying during spikes, sell on high prices.",
      "Low Price Capture": "Aggressive low-price charging, standard sells.",
      "Peak Sell": "Prioritize evening/peak sell windows.",
      "Negative Price Fill": "Charge on negative prices, sell on high prices.",
      Custom: "User-defined rule set from DSL/controls.",
    }),
    [],
  );
  const noteForStrategy = (name: string) =>
    strategyNotes[name] || (name.startsWith("Custom") ? "User-defined rule set." : "Strategy ruleset.");
  const cacheList = useMemo(() => {
    const combined = [...localCaches, ...serverCaches];
    return combined.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
  }, [localCaches, serverCaches]);
  const llmSummary = useMemo(() => summarizeLlm(llmResponse), [llmResponse]);
  const llmTimeline = useMemo(
    () => buildActionTimeline(active?.points || [], llmResponse),
    [active?.points, llmResponse],
  );
  const llmActionCount = useMemo(
    () => parseLlmTimeline(llmResponse).length,
    [llmResponse],
  );
  const llmMetrics = useMemo(() => {
    if (!active?.points?.length) return null;
    const actions = llmTimeline.map((item) => item.action);
    const counts = actions.reduce(
      (acc: Record<string, number>, action) => {
        acc[action] = (acc[action] || 0) + 1;
        return acc;
      },
      {},
    );
    const confidences = llmTimeline.map((item) => item.confidence ?? null);
    const llmProfit = simulatePlanProfit(active.points, config, actions, range.resolution);
    return {
      counts,
      confidences,
      llmProfit,
      baseProfit: active.summary.profit,
    };
  }, [active, llmTimeline, config, range.resolution]);

  const leaderboard = useMemo(() => {
    const rows = strategies.map((s) => ({
      name: s.name,
      profit: s.summary.profit,
      drawdown: maxDrawdown(s.points.map((p) => p.cumulativeProfit)),
      winRate: winRate(s.points.map((p) => p.cumulativeProfit)),
      source: "strategy",
    }));
    if (rlEval) {
      rows.push({
        name: `RL (${rlEval.algorithm})`,
        profit: rlEval.profit,
        drawdown: 0,
        winRate: 0,
        source: "rl",
      });
    }
    return rows
      .map((row) => {
        const score = row.profit - row.drawdown * 0.5 + row.winRate * 10;
        const comment =
          row.source === "rl"
            ? "RL eval result (profit only)."
            : strategyComment(row.profit, row.drawdown, row.winRate);
        return { ...row, score, comment };
      })
      .sort((a, b) => b.score - a.score);
  }, [strategies, rlEval]);
  const bestLeaderboard = leaderboard[0]?.name || "";
  const activeDiagnostics = useMemo(() => {
    if (!active?.points?.length) return null;
    const points = active.points;
    const profit = active.summary.profit;
    const drawdown = maxDrawdown(points.map((p) => p.cumulativeProfit));
    const winRateValue = winRate(points.map((p) => p.cumulativeProfit));
    const days = countDays(points);
    const avgDailyProfit = days > 0 ? profit / days : 0;
    const intervalCount = points.length;
    const first = new Date(points[0].time).getTime();
    const last = new Date(points[points.length - 1].time).getTime();
    const resolutionMs = range.resolution * 60 * 1000;
    const expectedIntervals =
      Number.isFinite(first) && Number.isFinite(last) && resolutionMs > 0
        ? Math.round((last - first) / resolutionMs) + 1
        : intervalCount;
    const boundedExpected = expectedIntervals > 0 ? expectedIntervals : intervalCount;
    const missingIntervals = Math.max(0, boundedExpected - intervalCount);
    const coveragePct = boundedExpected > 0 ? intervalCount / boundedExpected : 1;
    const edge = baseline ? profit - baseline.summary.profit : null;
    const throughputKwh = active.summary.buyKwh + active.summary.sellKwh;
    const profitPerKwh = throughputKwh > 0 ? profit / throughputKwh : 0;
    const utilizationPct =
      days > 0 && config.capacityKwh > 0
        ? active.summary.buyKwh / (config.capacityKwh * days)
        : 0;
    const cycleCount =
      config.capacityKwh > 0 ? throughputKwh / config.capacityKwh : 0;
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    const drawdownPenalty =
      profit > 0 && drawdown > 0 ? Math.min((drawdown / profit) * 20, 20) : 5;
    const coveragePenalty = (1 - coveragePct) * 60;
    const winRatePenalty = winRateValue < 0.5 ? (0.5 - winRateValue) * 80 : 0;
    const daysPenalty = days < 2 ? 12 : days < 5 ? 6 : 0;
    const profitBonus = profit > 0 ? 6 : -6;
    const qualityScore = clamp(
      100 - drawdownPenalty - coveragePenalty - winRatePenalty - daysPenalty + profitBonus,
    );
    return {
      profit,
      drawdown,
      winRateValue,
      days,
      avgDailyProfit,
      intervalCount,
      expectedIntervals: boundedExpected,
      missingIntervals,
      coveragePct,
      edge,
      profitPerKwh,
      utilizationPct,
      cycleCount,
      qualityScore,
    };
  }, [active, baseline, range.resolution, config.capacityKwh]);
  const comparisonRows = useMemo(() => {
    const rows = strategies.map((strategy) => ({
      name: strategy.name,
      profit: strategy.summary.profit,
      buyKwh: strategy.summary.buyKwh,
      sellKwh: strategy.summary.sellKwh,
      endSoc: strategy.summary.endSoc,
      note: noteForStrategy(strategy.name),
    }));
    if (rlEval) {
      rows.push({
        name: `RL (${rlEval.algorithm})`,
        profit: rlEval.profit,
        buyKwh: null,
        sellKwh: null,
        endSoc: rlEval.endSoc,
        note: "RL eval result (profit only).",
      });
    }
    return rows;
  }, [strategies, rlEval, noteForStrategy]);
  const bestComparison = useMemo(() => {
    if (!comparisonRows.length) return "";
    return comparisonRows.reduce((best, row) => (row.profit > best.profit ? row : best)).name;
  }, [comparisonRows]);
  const baselineEdge = useMemo(() => {
    if (!activeDiagnostics || !baseline) return null;
    return activeDiagnostics.profit - baseline.summary.profit;
  }, [activeDiagnostics, baseline]);
  const efficiencyMetrics = useMemo(() => {
    if (!active || !activeDiagnostics) return null;
    const buyKwh = active.summary.buyKwh ?? 0;
    const sellKwh = active.summary.sellKwh ?? 0;
    const throughput = buyKwh + sellKwh;
    const profitPerKwh = throughput > 0 ? activeDiagnostics.profit / throughput : 0;
    const cycles = config.capacityKwh > 0 ? throughput / config.capacityKwh : 0;
    const utilization =
      activeDiagnostics.days > 0 && config.capacityKwh > 0
        ? Math.min(1, throughput / (config.capacityKwh * activeDiagnostics.days * 2))
        : null;
    return {
      buyKwh,
      sellKwh,
      throughput,
      profitPerKwh,
      cycles,
      utilization,
    };
  }, [active, activeDiagnostics, config.capacityKwh]);
  const dailyPerformance = useMemo(() => {
    if (!active?.points?.length) return null;
    const points = active.points;
    const toKey = (time: string) => {
      const date = new Date(time);
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, "0");
      const day = `${date.getDate()}`.padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    let currentKey = "";
    let dayStart = 0;
    let dayEnd = 0;
    const daily: number[] = [];
    points.forEach((point) => {
      const key = toKey(point.time);
      if (!currentKey) {
        currentKey = key;
        dayStart = point.cumulativeProfit;
        dayEnd = point.cumulativeProfit;
        return;
      }
      if (key !== currentKey) {
        daily.push(dayEnd - dayStart);
        currentKey = key;
        dayStart = point.cumulativeProfit;
        dayEnd = point.cumulativeProfit;
        return;
      }
      dayEnd = point.cumulativeProfit;
    });
    if (currentKey) {
      daily.push(dayEnd - dayStart);
    }
    if (!daily.length) return null;
    const sorted = [...daily].sort((a, b) => a - b);
    const sum = daily.reduce((acc, value) => acc + value, 0);
    const avg = sum / daily.length;
    const variance =
      daily.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / daily.length;
    const std = Math.sqrt(variance);
    const percentile = (p: number) => {
      const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
      return sorted[idx];
    };
    return {
      count: daily.length,
      avg,
      best: sorted[sorted.length - 1],
      worst: sorted[0],
      std,
      p10: percentile(0.1),
      p90: percentile(0.9),
    };
  }, [active]);
  const healthStatus = useMemo(() => {
    if (!activeDiagnostics) return null;
    const { days, coveragePct, missingIntervals, profit, drawdown, winRateValue } = activeDiagnostics;
    if (profit <= 0) {
      return {
        label: "Unprofitable",
        className: "bad",
        detail: "Strategy lost money in this window.",
      };
    }
    if (days < 2) {
      return {
        label: "Thin sample",
        className: "warn",
        detail: `Only ${days} day${days === 1 ? "" : "s"} of data.`,
      };
    }
    if (coveragePct < 0.95 || missingIntervals > 0) {
      return {
        label: "Gapped data",
        className: "warn",
        detail: `Missing ${missingIntervals} intervals (${Math.round((1 - coveragePct) * 100)}% gap).`,
      };
    }
    if (drawdown > profit * 0.8) {
      return {
        label: "Volatile",
        className: "warn",
        detail: "Drawdown is close to total profit.",
      };
    }
    if (winRateValue < 0.5) {
      return {
        label: "Inconsistent",
        className: "warn",
        detail: "Win rate below 50%.",
      };
    }
    return {
      label: "Healthy",
      className: "good",
      detail: "Coverage and profit look stable.",
    };
  }, [activeDiagnostics]);
  const backtestReadiness = useMemo(() => {
    const intervalCount = payload?.length ?? 0;
    const usageCount = usagePayload?.length ?? 0;
    const dataLoaded = intervalCount > 0;
    const usageLoaded = usageCount > 0;
    const dataNote = dataLoaded
      ? `${range.start} → ${range.end} · ${range.resolution} min`
      : "Load JSON or refresh data to begin.";
    const usageNote = usageLoaded ? `${usageCount} usage rows loaded` : "Usage payload not loaded.";
    const strategySummary =
      config.mode === "threshold"
        ? `Buy ≤ ${config.buyThreshold}c · Sell ≥ ${config.sellThreshold}c`
        : `Buy p${Math.round(config.buyPercentile * 100)} · Sell p${Math.round(
            config.sellPercentile * 100,
          )} · Window ${config.windowSize}`;
    const performanceLabel = activeDiagnostics ? formatProfit(activeDiagnostics.profit) : "—";
    const performanceNote = activeDiagnostics
      ? `${(activeDiagnostics.winRateValue * 100).toFixed(1)}% win rate · ${activeDiagnostics.days} days`
      : "Run backtest to see profit.";
    const drawdownNote = activeDiagnostics
      ? `Drawdown ${formatProfit(-activeDiagnostics.drawdown)}`
      : "Drawdown awaits backtest.";
    const qualityLabel = activeDiagnostics ? `${activeDiagnostics.qualityScore}/100` : "—";
    const qualityNote = activeDiagnostics
      ? `${(activeDiagnostics.coveragePct * 100).toFixed(1)}% coverage · ${activeDiagnostics.missingIntervals} gaps`
      : "Awaiting signal quality.";
    const healthNote = healthStatus ? `${healthStatus.label}: ${healthStatus.detail}` : "Health pending.";
    const chipItems = [
      `Strategy: ${activeStrategy}`,
      `LLM ${llmConfig.enabled ? "ON" : "OFF"}`,
      `Forecast ${solarForecast.enabled ? "ON" : "OFF"}`,
      `Weather ${weatherEnabled ? "ON" : "OFF"}`,
    ];
    return {
      intervalCount,
      usageCount,
      dataLoaded,
      usageLoaded,
      dataNote,
      usageNote,
      strategySummary,
      performanceLabel,
      performanceNote,
      drawdownNote,
      qualityLabel,
      qualityNote,
      healthNote,
      chipItems,
    };
  }, [
    payload,
    usagePayload,
    range.start,
    range.end,
    range.resolution,
    config,
    activeDiagnostics,
    healthStatus,
    activeStrategy,
    llmConfig.enabled,
    solarForecast.enabled,
    weatherEnabled,
  ]);
  const backtestSignals = useMemo(() => {
    if (!activeDiagnostics) return [];
    const signals: string[] = [];
    if (activeDiagnostics.days < 2) {
      signals.push("Sample window is short. Extend the range for more reliable signals.");
    }
    if (activeDiagnostics.missingIntervals > 0) {
      signals.push(
        `Data gaps detected. Consider reloading prices to fill ${activeDiagnostics.missingIntervals} missing intervals.`,
      );
    }
    if (baselineEdge !== null) {
      signals.push(
        baselineEdge >= 0
          ? `Active strategy beats baseline by ${formatProfit(baselineEdge)}.`
          : `Active strategy trails baseline by ${formatProfit(Math.abs(baselineEdge))}.`,
      );
    }
    if (activeDiagnostics.drawdown > Math.max(activeDiagnostics.profit * 0.7, 10)) {
      signals.push("Drawdown is heavy relative to profit. Consider tighter exits or smaller window.");
    }
    if (activeDiagnostics.winRateValue < 0.5) {
      signals.push("Win rate is under 50%. Adjust thresholds or try percentile mode.");
    } else {
      signals.push("Win rate is healthy. Consider exploring higher sell thresholds to lift profit.");
    }
    return signals.slice(0, 5);
  }, [activeDiagnostics, baselineEdge]);
  const optimizationBrief = useMemo(() => {
    if (!activeDiagnostics) return null;
    const highlights: { title: string; detail: string; tone: "good" | "warn" | "bad" }[] = [];
    if (activeDiagnostics.missingIntervals > 0) {
      highlights.push({
        title: "Fill data gaps",
        detail: `Reload prices to cover ${activeDiagnostics.missingIntervals} missing intervals.`,
        tone: "warn",
      });
    }
    if (baselineEdge !== null && baselineEdge < 0) {
      highlights.push({
        title: "Beat baseline",
        detail: `Close a ${formatProfit(Math.abs(baselineEdge))} deficit vs ${baseline?.name || "baseline"}.`,
        tone: "bad",
      });
    }
    if (activeDiagnostics.drawdown > Math.max(activeDiagnostics.profit * 0.7, 10)) {
      highlights.push({
        title: "Reduce drawdown",
        detail: "Tighten sell threshold or shorten percentile window.",
        tone: "warn",
      });
    }
    if (highlights.length < 3) {
      highlights.push({
        title: "Scale profitability",
        detail: "Explore higher sell targets or broader price windows.",
        tone: "good",
      });
    }
    if (highlights.length < 3) {
      highlights.push({
        title: "Lock consistency",
        detail: "Validate across a longer date range before deployment.",
        tone: "good",
      });
    }
    return highlights.slice(0, 3);
  }, [activeDiagnostics, baselineEdge, baseline?.name]);

  const tuningHint =
    config.mode === "threshold"
      ? "Threshold mode: lower buy + higher sell = fewer, higher-margin trades."
      : "Percentile mode: widen the window for fewer, higher-confidence trades.";

  const flightPlan = useMemo(() => {
    if (!activeDiagnostics) return null;
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    const drawdownRatio =
      activeDiagnostics.profit > 0
        ? activeDiagnostics.drawdown / activeDiagnostics.profit
        : 1;
    const stabilityIndex = clamp(
      activeDiagnostics.qualityScore * 0.5 +
        activeDiagnostics.coveragePct * 100 * 0.2 +
        activeDiagnostics.winRateValue * 100 * 0.3,
    );
    const riskScore = clamp(
      drawdownRatio * 40 +
        (1 - activeDiagnostics.coveragePct) * 40 +
        Math.max(0, 0.55 - activeDiagnostics.winRateValue) * 80 +
        (activeDiagnostics.days < 3 ? 10 : 0),
    );
    const launch =
      healthStatus?.className === "good" &&
      (baselineEdge === null || baselineEdge >= 0) &&
      activeDiagnostics.qualityScore >= 70
        ? {
            label: "GO",
            tone: "good",
            detail: "Signal quality is strong enough to ship or paper-trade.",
          }
        : activeDiagnostics.profit <= 0 || (baselineEdge !== null && baselineEdge < 0)
          ? {
              label: "HOLD",
              tone: "bad",
              detail: "Unprofitable or trailing baseline. Refine before scaling.",
            }
          : {
              label: "CAUTION",
              tone: "warn",
              detail: "Promising, but tighten risk controls before scaling.",
            };
    const riskLabel =
      riskScore >= 70 ? "High risk" : riskScore >= 45 ? "Moderate risk" : "Low risk";
    const cadenceLabel =
      range.resolution <= 5
        ? "High-frequency"
        : range.resolution <= 30
          ? "Standard cadence"
          : "Long cadence";
    let nextTitle = "Extend validation";
    let nextDetail = "Run a longer date range or alternate season.";
    if (activeDiagnostics.missingIntervals > 0) {
      nextTitle = "Repair data coverage";
      nextDetail = `Reload prices to fill ${activeDiagnostics.missingIntervals} missing intervals.`;
    } else if (baselineEdge !== null && baselineEdge < 0) {
      nextTitle = "Close baseline gap";
      nextDetail = "Adjust thresholds or try Balanced tuning to catch up.";
    } else if (activeDiagnostics.winRateValue < 0.5) {
      nextTitle = "Lift win rate";
      nextDetail = "Try percentile mode with a wider window for cleaner entries.";
    } else if (drawdownRatio > 0.7) {
      nextTitle = "Reduce drawdown";
      nextDetail = "Raise sell thresholds or shorten the trading window.";
    } else if (config.mode === "threshold") {
      nextTitle = "Push margin";
      nextDetail = "Try a higher sell threshold or smaller buy window.";
    } else {
      nextTitle = "Explore aggressiveness";
      nextDetail = "Tighten percentiles or extend the window for more coverage.";
    }
    const tags = [
      {
        label:
          baselineEdge === null
            ? "Baseline n/a"
            : baselineEdge >= 0
              ? `+${formatProfit(baselineEdge)} edge`
              : `${formatProfit(baselineEdge)} edge`,
        tone: baselineEdge === null ? "neutral" : baselineEdge >= 0 ? "good" : "bad",
      },
      {
        label: `${(activeDiagnostics.coveragePct * 100).toFixed(1)}% coverage`,
        tone: activeDiagnostics.coveragePct >= 0.95 ? "good" : "warn",
      },
      {
        label: `${activeDiagnostics.days} day${activeDiagnostics.days === 1 ? "" : "s"} sample`,
        tone: activeDiagnostics.days >= 5 ? "good" : activeDiagnostics.days >= 2 ? "warn" : "bad",
      },
    ];
    if (efficiencyMetrics?.utilization !== null && efficiencyMetrics?.utilization !== undefined) {
      const util = efficiencyMetrics.utilization;
      tags.push({
        label: `${(util * 100).toFixed(1)}% util`,
        tone: util >= 0.6 ? "good" : util >= 0.35 ? "warn" : "bad",
      });
    }
    return {
      launch,
      riskScore,
      riskLabel,
      stabilityIndex,
      nextTitle,
      nextDetail,
      cadenceLabel,
      tags,
    };
  }, [
    activeDiagnostics,
    baselineEdge,
    config.mode,
    efficiencyMetrics,
    healthStatus,
    range.resolution,
  ]);
  const executiveBrief = useMemo(() => {
    if (!activeDiagnostics) return null;
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    const readinessScore = clamp(
      activeDiagnostics.qualityScore * 0.4 +
        activeDiagnostics.winRateValue * 100 * 0.25 +
        (activeDiagnostics.profit > 0 ? 20 : 0) +
        (baselineEdge !== null && baselineEdge > 0 ? 15 : 0),
    );
    const riskRatio =
      activeDiagnostics.profit > 0
        ? activeDiagnostics.drawdown / activeDiagnostics.profit
        : 1;
    const riskPosture = riskRatio < 0.4 ? "Low" : riskRatio < 0.8 ? "Moderate" : "High";
    const riskTone = riskRatio < 0.4 ? "good" : riskRatio < 0.8 ? "warn" : "bad";
    const momentum = activeDiagnostics.avgDailyProfit;
    const momentumTone = momentum >= 0 ? "good" : "bad";
    const consistencyScore =
      dailyPerformance && dailyPerformance.avg !== 0
        ? clamp(100 - (dailyPerformance.std / Math.abs(dailyPerformance.avg)) * 35)
        : dailyPerformance
          ? clamp(100 - dailyPerformance.std * 4)
          : null;
    const consistencyTone =
      consistencyScore === null ? "neutral" : consistencyScore >= 65 ? "good" : "warn";
    const cards = [
      {
        label: "Readiness Score",
        value: `${readinessScore.toFixed(0)}/100`,
        note: readinessScore >= 70 ? "Ready to scale" : "Needs refinement",
        tone: readinessScore >= 70 ? "good" : readinessScore >= 50 ? "warn" : "bad",
      },
      {
        label: "Risk Posture",
        value: riskPosture,
        note: `Drawdown ratio ${(riskRatio * 100).toFixed(0)}%`,
        tone: riskTone,
      },
      {
        label: "Daily Momentum",
        value: formatProfit(momentum),
        note: `${activeDiagnostics.days} day sample`,
        tone: momentumTone,
      },
      {
        label: "Consistency",
        value: consistencyScore !== null ? `${consistencyScore.toFixed(0)}/100` : "—",
        note:
          dailyPerformance
            ? `Best ${formatProfit(dailyPerformance.best)} · Worst ${formatProfit(dailyPerformance.worst)}`
            : "Run backtest to compute daily spread.",
        tone: consistencyTone,
      },
    ];
    const nextMoves: string[] = [];
    if (activeDiagnostics.days < 5) {
      nextMoves.push("Extend the date range to 7+ days for stronger validation.");
    }
    if (baselineEdge !== null && baselineEdge < 0) {
      nextMoves.push("Close the baseline gap by tightening entries or widening sell targets.");
    }
    if (riskRatio > 0.8) {
      nextMoves.push("Reduce drawdown with smaller windows or higher sell thresholds.");
    }
    if (dailyPerformance && dailyPerformance.std > Math.abs(dailyPerformance.avg) * 1.5) {
      nextMoves.push("Smooth daily volatility by narrowing the trading window.");
    }
    if (!nextMoves.length) {
      nextMoves.push("Run a second window to confirm performance stability.");
    }
    return {
      readinessScore,
      cards,
      nextMoves: nextMoves.slice(0, 3),
    };
  }, [activeDiagnostics, baselineEdge, dailyPerformance]);
  const riskRadar = useMemo(() => {
    if (!activeDiagnostics) return null;
    const clamp = (value: number) => Math.max(0, Math.min(100, value));
    const drawdownRatio =
      activeDiagnostics.profit > 0
        ? activeDiagnostics.drawdown / activeDiagnostics.profit
        : 1;
    const confidenceScore = clamp(
      activeDiagnostics.qualityScore * 0.6 +
        activeDiagnostics.winRateValue * 100 * 0.25 +
        Math.min(20, activeDiagnostics.days * 4),
    );
    const confidenceTone =
      confidenceScore >= 75 ? "good" : confidenceScore >= 55 ? "warn" : "bad";
    const riskTier =
      drawdownRatio < 0.4
        ? { label: "Low", tone: "good" }
        : drawdownRatio < 0.8
          ? { label: "Moderate", tone: "warn" }
          : { label: "High", tone: "bad" };
    const downsideCushion = activeDiagnostics.profit - activeDiagnostics.drawdown;
    const dailySwing =
      dailyPerformance && dailyPerformance.count > 0
        ? Math.max(0, dailyPerformance.p90 - dailyPerformance.p10)
        : null;
    const tradeDensity =
      activeDiagnostics.days > 0
        ? activeDiagnostics.intervalCount / activeDiagnostics.days
        : 0;
    const scenario = dailyPerformance
      ? {
          best: dailyPerformance.p90,
          base: dailyPerformance.avg,
          worst: dailyPerformance.p10,
        }
      : null;
    const guardrails: string[] = [];
    if (activeDiagnostics.missingIntervals > 0) {
      guardrails.push(`Patch ${activeDiagnostics.missingIntervals} missing intervals before scaling.`);
    }
    if (drawdownRatio > 0.75) {
      guardrails.push("Cap drawdown with tighter sell targets or shorter windows.");
    }
    if (activeDiagnostics.winRateValue < 0.5) {
      guardrails.push("Improve hit rate before increasing trade frequency.");
    }
    if (dailyPerformance && dailyPerformance.std > Math.abs(dailyPerformance.avg) * 1.2) {
      guardrails.push("Volatility is elevated. Reduce exposure or widen spreads.");
    }
    if (!guardrails.length) {
      guardrails.push("Guardrails look steady. Revalidate weekly to confirm stability.");
    }
    return {
      confidenceScore,
      confidenceTone,
      riskTier,
      drawdownRatio,
      downsideCushion,
      dailySwing,
      tradeDensity,
      scenario,
      guardrails: guardrails.slice(0, 3),
    };
  }, [activeDiagnostics, dailyPerformance]);

  const backtestAtlas = useMemo(() => {
    if (!activeDiagnostics) return null;
    const drawdownRatio =
      activeDiagnostics.profit > 0
        ? activeDiagnostics.drawdown / activeDiagnostics.profit
        : 1;
    const cadenceLabel =
      range.resolution <= 5
        ? "High-frequency"
        : range.resolution <= 30
          ? "Standard cadence"
          : "Long cadence";
    const riskLabel =
      drawdownRatio < 0.4 ? "Low risk" : drawdownRatio < 0.8 ? "Moderate risk" : "High risk";
    const riskTone = drawdownRatio < 0.4 ? "good" : drawdownRatio < 0.8 ? "warn" : "bad";
    const edgeTone = baselineEdge === null ? "neutral" : baselineEdge >= 0 ? "good" : "bad";
    const coverageTone =
      activeDiagnostics.coveragePct >= 0.95
        ? "good"
        : activeDiagnostics.coveragePct >= 0.85
          ? "warn"
          : "bad";
    const momentumTone = activeDiagnostics.avgDailyProfit >= 0 ? "good" : "bad";
    const utilizationValue =
      efficiencyMetrics?.utilization !== null && efficiencyMetrics?.utilization !== undefined
        ? `${(efficiencyMetrics.utilization * 100).toFixed(1)}%`
        : "—";
    const utilizationTone =
      efficiencyMetrics?.utilization === null || efficiencyMetrics?.utilization === undefined
        ? "neutral"
        : efficiencyMetrics.utilization >= 0.6
          ? "good"
          : efficiencyMetrics.utilization >= 0.35
            ? "warn"
            : "bad";
    return {
      lanes: [
        {
          title: "Performance Vector",
          status: activeDiagnostics.avgDailyProfit >= 0 ? "Momentum up" : "Momentum down",
          tone: momentumTone,
          metrics: [
            {
              label: "Net Profit",
              value: formatProfit(activeDiagnostics.profit),
              hint: `${activeDiagnostics.days} day window`,
              tone: activeDiagnostics.profit >= 0 ? "good" : "bad",
            },
            {
              label: "Avg Daily",
              value: formatProfit(activeDiagnostics.avgDailyProfit),
              hint: `Std ${dailyPerformance ? formatProfit(dailyPerformance.std) : "—"}`,
              tone: momentumTone,
            },
            {
              label: "Edge vs Baseline",
              value:
                baselineEdge === null
                  ? "Baseline n/a"
                  : baselineEdge >= 0
                    ? `+${formatProfit(baselineEdge)}`
                    : `${formatProfit(baselineEdge)}`,
              hint: baseline?.name || "Baseline",
              tone: edgeTone,
            },
            {
              label: "Win Rate",
              value: `${(activeDiagnostics.winRateValue * 100).toFixed(1)}%`,
              hint: `${activeDiagnostics.intervalCount} intervals`,
              tone: activeDiagnostics.winRateValue >= 0.5 ? "good" : "warn",
            },
          ],
        },
        {
          title: "Risk Envelope",
          status: riskLabel,
          tone: riskTone,
          metrics: [
            {
              label: "Drawdown Ratio",
              value: `${(drawdownRatio * 100).toFixed(0)}%`,
              hint: `Max DD ${formatProfit(-activeDiagnostics.drawdown)}`,
              tone: riskTone,
            },
            {
              label: "Coverage",
              value: `${(activeDiagnostics.coveragePct * 100).toFixed(1)}%`,
              hint: `${activeDiagnostics.missingIntervals} gaps`,
              tone: coverageTone,
            },
            {
              label: "Quality Score",
              value: `${activeDiagnostics.qualityScore}/100`,
              hint: healthStatus?.label || "Quality scan",
              tone: activeDiagnostics.qualityScore >= 70 ? "good" : "warn",
            },
            {
              label: "Consistency",
              value: dailyPerformance ? formatProfit(dailyPerformance.avg) : "—",
              hint: dailyPerformance
                ? `Best ${formatProfit(dailyPerformance.best)}`
                : "Daily spread pending",
              tone: dailyPerformance && dailyPerformance.avg >= 0 ? "good" : "neutral",
            },
          ],
        },
        {
          title: "Execution Rhythm",
          status: cadenceLabel,
          tone: "neutral",
          metrics: [
            {
              label: "Cadence",
              value: `${range.resolution} min`,
              hint: cadenceLabel,
              tone: "neutral",
            },
            {
              label: "Sample Size",
              value: `${activeDiagnostics.days} day${activeDiagnostics.days === 1 ? "" : "s"}`,
              hint: `${activeDiagnostics.intervalCount} intervals`,
              tone: activeDiagnostics.days >= 5 ? "good" : activeDiagnostics.days >= 2 ? "warn" : "bad",
            },
            {
              label: "Utilization",
              value: utilizationValue,
              hint: "Battery utilization",
              tone: utilizationTone,
            },
            {
              label: "Throughput",
              value: efficiencyMetrics ? `${efficiencyMetrics.throughput.toFixed(1)} kWh` : "—",
              hint: `Cycles ${efficiencyMetrics ? efficiencyMetrics.cycles.toFixed(2) : "—"}`,
              tone: efficiencyMetrics ? "good" : "neutral",
            },
          ],
        },
      ],
      signals: backtestSignals.slice(0, 3),
      footer:
        healthStatus?.detail ||
        (backtestReadiness.dataLoaded
          ? "Signals are ready for the next iteration."
          : "Load pricing + usage to unlock signals."),
    };
  }, [
    activeDiagnostics,
    baseline,
    baselineEdge,
    backtestReadiness.dataLoaded,
    backtestSignals,
    dailyPerformance,
    efficiencyMetrics,
    healthStatus,
    range.resolution,
  ]);

  const backtestScenario = useMemo(() => {
    if (!activeDiagnostics) return null;
    const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
    const drawdownRatio =
      activeDiagnostics.profit > 0
        ? activeDiagnostics.drawdown / activeDiagnostics.profit
        : 1;
    const coveragePct = activeDiagnostics.coveragePct * 100;
    const winRatePct = activeDiagnostics.winRateValue * 100;
    const utilizationPct =
      efficiencyMetrics?.utilization !== null && efficiencyMetrics?.utilization !== undefined
        ? efficiencyMetrics.utilization * 100
        : null;
    const stabilityScore = dailyPerformance
      ? clamp(
          100 -
            (dailyPerformance.std / Math.max(1, Math.abs(dailyPerformance.avg))) * 35,
        )
      : null;
    const qualityScore = activeDiagnostics.qualityScore;
    const edgeValue = baselineEdge ?? activeDiagnostics.profit;

    const conservativeScore = clamp(100 - drawdownRatio * 70 - (100 - coveragePct) * 0.2);
    const balanceScore = clamp(
      40 +
        (activeDiagnostics.avgDailyProfit >= 0 ? 20 : 0) +
        (edgeValue >= 0 ? 15 : -10) +
        winRatePct * 0.35,
    );
    const momentumScore = clamp(
      30 +
        (activeDiagnostics.avgDailyProfit >= 0 ? 25 : 0) +
        winRatePct * 0.4 +
        (utilizationPct ?? 40) * 0.2,
    );
    const stabilityFocus = clamp(
      35 + (stabilityScore ?? 50) * 0.5 + (qualityScore >= 70 ? 15 : 0),
    );

    const insights: string[] = [];
    if (drawdownRatio > 0.8) {
      insights.push("Drawdown dominates profit. Tighten sell targets or reduce window size.");
    }
    if (coveragePct < 90) {
      insights.push("Coverage below 90%. Refresh cache or expand the time window.");
    }
    if (qualityScore < 65) {
      insights.push("Signal quality is thin. Add more days or smooth thresholds.");
    }
    if (utilizationPct !== null && utilizationPct < 35) {
      insights.push("Battery utilization is low. Consider widening buy/sell bands.");
    }
    if (!insights.length) {
      insights.push("Metrics are balanced. Run another window to confirm consistency.");
    }

    return {
      cards: [
        {
          title: "Conservative Shield",
          tone: drawdownRatio < 0.6 ? "good" : drawdownRatio < 0.85 ? "warn" : "bad",
          score: conservativeScore,
          focus: "Protect capital and minimize drawdown exposure.",
          metrics: [
            { label: "Drawdown", value: `${(drawdownRatio * 100).toFixed(0)}%` },
            { label: "Coverage", value: `${coveragePct.toFixed(1)}%` },
            { label: "Quality", value: `${qualityScore}/100` },
          ],
          action:
            drawdownRatio > 0.8
              ? "Raise sell thresholds and shorten the window to dampen drawdown."
              : "Maintain guardrails and extend the range for confidence.",
        },
        {
          title: "Balanced Growth",
          tone: edgeValue >= 0 ? "good" : "warn",
          score: balanceScore,
          focus: "Hold steady while improving edge vs baseline.",
          metrics: [
            { label: "Edge", value: formatProfit(edgeValue) },
            { label: "Avg Daily", value: formatProfit(activeDiagnostics.avgDailyProfit) },
            { label: "Win Rate", value: `${winRatePct.toFixed(1)}%` },
          ],
          action:
            edgeValue >= 0
              ? "Keep the core thresholds and scale window length."
              : "Adjust buy/sell bands until edge turns positive.",
        },
        {
          title: "Momentum Capture",
          tone: activeDiagnostics.avgDailyProfit >= 0 ? "good" : "warn",
          score: momentumScore,
          focus: "Press advantage when momentum is favorable.",
          metrics: [
            { label: "Momentum", value: formatProfit(activeDiagnostics.avgDailyProfit) },
            { label: "Utilization", value: utilizationPct ? `${utilizationPct.toFixed(1)}%` : "—" },
            { label: "Cadence", value: `${range.resolution} min` },
          ],
          action:
            activeDiagnostics.avgDailyProfit >= 0
              ? "Increase window size or lower buy trigger to capture more cycles."
              : "Hold aggressive tuning until momentum recovers.",
        },
        {
          title: "Stability Recovery",
          tone: stabilityScore !== null && stabilityScore >= 65 ? "good" : "warn",
          score: stabilityFocus,
          focus: "Smooth daily variance and protect consistency.",
          metrics: [
            { label: "Stability", value: stabilityScore !== null ? `${stabilityScore.toFixed(0)}/100` : "—" },
            { label: "Quality", value: `${qualityScore}/100` },
            { label: "Days", value: `${activeDiagnostics.days}` },
          ],
          action:
            stabilityScore !== null && stabilityScore < 60
              ? "Narrow the band or reduce max power to smooth volatility."
              : "Re-run with a longer sample to validate stability.",
        },
      ],
      insights,
    };
  }, [
    activeDiagnostics,
    baselineEdge,
    dailyPerformance,
    efficiencyMetrics,
    range.resolution,
  ]);

  const backtestSignalBrief = useMemo(() => {
    const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
    const hasDiagnostics = Boolean(activeDiagnostics);
    const coveragePct = activeDiagnostics ? activeDiagnostics.coveragePct * 100 : null;
    const winRatePct = activeDiagnostics ? activeDiagnostics.winRateValue * 100 : null;
    const profit = activeDiagnostics?.profit ?? null;
    const drawdown = activeDiagnostics?.drawdown ?? null;
    const drawdownRatio =
      hasDiagnostics && profit !== null && profit > 0 ? drawdown! / profit : hasDiagnostics ? 1 : null;
    const qualityScore = activeDiagnostics?.qualityScore ?? null;
    const utilization =
      efficiencyMetrics?.utilization !== null && efficiencyMetrics?.utilization !== undefined
        ? efficiencyMetrics.utilization * 100
        : null;

    const readinessScore = clamp(
      (backtestReadiness.dataLoaded ? 30 : 0) +
        (backtestReadiness.usageLoaded ? 15 : 0) +
        (coveragePct !== null ? (coveragePct / 100) * 25 : 0) +
        (qualityScore !== null ? (qualityScore / 100) * 15 : 0) +
        (activeDiagnostics
          ? activeDiagnostics.days >= 5
            ? 15
            : activeDiagnostics.days >= 2
              ? 8
              : 4
          : 0),
    );

    const riskScore =
      drawdownRatio === null
        ? 50
        : clamp(100 - drawdownRatio * 100);

    const consistencyScore = dailyPerformance
      ? clamp(
          100 -
            (dailyPerformance.std / Math.max(1, Math.abs(dailyPerformance.avg))) * 40,
        )
      : 50;

    const opportunityScore = clamp(
      50 +
        (profit !== null ? (profit >= 0 ? 15 : -15) : 0) +
        (baselineEdge !== null ? (baselineEdge >= 0 ? 10 : -10) : 0) +
        (winRatePct !== null ? (winRatePct >= 55 ? 10 : winRatePct >= 45 ? 0 : -10) : 0) +
        (utilization !== null ? (utilization >= 60 ? 10 : utilization < 35 ? -10 : 0) : 0),
    );

    const toneForScore = (score: number) =>
      score >= 70 ? "good" : score >= 50 ? "warn" : "bad";

    const actions: Array<{ title: string; detail: string; tone: string }> = [];
    if (!backtestReadiness.dataLoaded) {
      actions.push({
        title: "Load price + usage data",
        detail: "Pull Amber data or upload a cache to unlock diagnostics.",
        tone: "warn",
      });
    }
    if (backtestReadiness.dataLoaded && !backtestReadiness.usageLoaded) {
      actions.push({
        title: "Sync usage payload",
        detail: "Usage rows are missing; refresh to align energy flows.",
        tone: "warn",
      });
    }
    if (qualityScore !== null && qualityScore < 70) {
      actions.push({
        title: "Improve signal quality",
        detail: "Expand the window or smooth thresholds for higher confidence.",
        tone: "warn",
      });
    }
    if (baselineEdge !== null && baselineEdge < 0) {
      actions.push({
        title: "Tune for baseline edge",
        detail: "Adjust buy/sell bands until edge turns positive.",
        tone: "bad",
      });
    }
    if (drawdownRatio !== null && drawdownRatio > 0.7) {
      actions.push({
        title: "Reduce drawdown pressure",
        detail: "Raise sell thresholds or tighten max power.",
        tone: "bad",
      });
    }
    if (utilization !== null && utilization < 35) {
      actions.push({
        title: "Boost battery utilization",
        detail: "Widen thresholds or extend the window to capture cycles.",
        tone: "warn",
      });
    }
    if (!actions.length) {
      actions.push({
        title: "Validate next window",
        detail: "Re-run with a longer sample to confirm stability.",
        tone: "good",
      });
    }
    const trimmedActions = actions.slice(0, 3);

    const status =
      readinessScore >= 70 && (qualityScore ?? 0) >= 70
        ? "Ready to iterate"
        : readinessScore >= 50
          ? "Calibrate before scaling"
          : "Data gaps blocking confidence";

    const summary = hasDiagnostics
      ? `Readiness ${readinessScore.toFixed(0)} · Risk ${riskScore.toFixed(0)} · Opportunity ${opportunityScore.toFixed(0)}`
      : "Run a backtest to generate signal scoring.";

    const tags = [
      backtestReadiness.dataLoaded ? "Data loaded" : "Data missing",
      backtestReadiness.usageLoaded ? "Usage synced" : "Usage missing",
      qualityScore !== null ? `Quality ${qualityScore}` : "Quality n/a",
      coveragePct !== null ? `Coverage ${coveragePct.toFixed(0)}%` : "Coverage n/a",
    ];

    const highlights = backtestSignals.length
      ? backtestSignals.slice(0, 5)
      : ["Run a backtest to generate signal highlights."];

    return {
      status,
      summary,
      tags,
      cards: [
        {
          label: "Readiness",
          value: readinessScore.toFixed(0),
          hint: backtestReadiness.dataLoaded ? backtestReadiness.dataNote : "Awaiting payload",
          tone: toneForScore(readinessScore),
        },
        {
          label: "Risk",
          value: riskScore.toFixed(0),
          hint: drawdownRatio !== null ? `Drawdown ${(drawdownRatio * 100).toFixed(0)}%` : "Risk pending",
          tone: toneForScore(riskScore),
        },
        {
          label: "Consistency",
          value: consistencyScore.toFixed(0),
          hint: dailyPerformance
            ? `Daily avg ${formatProfit(dailyPerformance.avg)}`
            : "Daily spread pending",
          tone: toneForScore(consistencyScore),
        },
        {
          label: "Opportunity",
          value: opportunityScore.toFixed(0),
          hint: profit !== null ? `Profit ${formatProfit(profit)}` : "Profit pending",
          tone: toneForScore(opportunityScore),
        },
      ],
      actions: trimmedActions,
      highlights,
    };
  }, [
    activeDiagnostics,
    backtestReadiness,
    backtestSignals,
    baselineEdge,
    dailyPerformance,
    efficiencyMetrics,
  ]);

  const pulseSnapshot = useMemo(() => {
    if (!active?.points?.length || !activeDiagnostics) return null;
    const dayTotals: { day: string; cumulative: number }[] = [];
    let currentDay = "";
    let currentTotal = 0;
    active.points.forEach((point) => {
      const day = toDayStamp(point.time);
      if (day !== currentDay) {
        if (currentDay) {
          dayTotals.push({ day: currentDay, cumulative: currentTotal });
        }
        currentDay = day;
      }
      currentTotal = point.cumulativeProfit;
    });
    if (currentDay) {
      dayTotals.push({ day: currentDay, cumulative: currentTotal });
    }
    if (!dayTotals.length) return null;
    const daily = dayTotals.map((entry, index) => ({
      day: entry.day,
      profit: entry.cumulative - (index > 0 ? dayTotals[index - 1].cumulative : 0),
    }));
    const profits = daily.map((item) => item.profit);
    const totalDays = profits.length;
    const totalProfit = profits.reduce((sum, value) => sum + value, 0);
    const avgDaily = totalDays > 0 ? totalProfit / totalDays : 0;
    const variance =
      totalDays > 0
        ? profits.reduce((sum, value) => sum + (value - avgDaily) ** 2, 0) / totalDays
        : 0;
    const volatility = Math.sqrt(variance);
    const positiveDays = profits.filter((value) => value > 0).length;
    const consistency = totalDays > 0 ? positiveDays / totalDays : 0;
    const bestDay = daily.reduce((best, item) => (item.profit > best.profit ? item : best), daily[0]);
    const worstDay = daily.reduce(
      (worst, item) => (item.profit < worst.profit ? item : worst),
      daily[0],
    );
    let winStreak = 0;
    let lossStreak = 0;
    let currentWin = 0;
    let currentLoss = 0;
    daily.forEach((item) => {
      if (item.profit > 0) {
        currentWin += 1;
        currentLoss = 0;
      } else if (item.profit < 0) {
        currentLoss += 1;
        currentWin = 0;
      } else {
        currentWin = 0;
        currentLoss = 0;
      }
      winStreak = Math.max(winStreak, currentWin);
      lossStreak = Math.max(lossStreak, currentLoss);
    });
    const recentSlice = profits.slice(-3);
    const priorSlice = profits.slice(-6, -3);
    const recentAvg =
      recentSlice.length > 0
        ? recentSlice.reduce((sum, value) => sum + value, 0) / recentSlice.length
        : 0;
    const priorAvg =
      priorSlice.length > 0
        ? priorSlice.reduce((sum, value) => sum + value, 0) / priorSlice.length
        : avgDaily;
    const momentumDelta = recentAvg - priorAvg;
    const peakProfit = Math.max(...profits);
    const concentration =
      totalProfit !== 0 ? Math.abs(peakProfit) / Math.abs(totalProfit) : 0;
    const regime =
      activeDiagnostics.profit > 0 && consistency >= 0.6
        ? momentumDelta >= 0
          ? {
              label: "Bullish",
              tone: "good",
              detail: "Profit holds with improving recent days.",
            }
          : {
              label: "Stable",
              tone: "warn",
              detail: "Profit holds, but momentum cooled recently.",
            }
        : activeDiagnostics.profit > 0
          ? {
              label: "Choppy",
              tone: "warn",
              detail: "Profitable, but daily swings are uneven.",
            }
          : {
              label: "Bearish",
              tone: "bad",
              detail: "Losses dominate recent daily outcomes.",
            };
    return {
      totalDays,
      totalProfit,
      avgDaily,
      volatility,
      consistency,
      positiveDays,
      bestDay,
      worstDay,
      winStreak,
      lossStreak,
      momentumDelta,
      concentration,
      regime,
    };
  }, [active, activeDiagnostics]);

  const pickLatest = (items: RawInterval[] | null) => {
    if (!items?.length) return null;
    return items.reduce((latest, item) => {
      if (!latest) return item;
      return new Date(item.startTime).getTime() > new Date(latest.startTime).getTime()
        ? item
        : latest;
    }, null as RawInterval | null);
  };

  const currentSummary = useMemo(() => {
    if (!currentPrice?.length) return null;
    const general = pickLatest(currentPrice.filter((item) => item.channelType === "general"));
    const feedIn = pickLatest(currentPrice.filter((item) => item.channelType === "feedIn"));
    const timestamp = general?.startTime || feedIn?.startTime || "";
    return { general, feedIn, timestamp };
  }, [currentPrice]);

  const currentSummary30 = useMemo(() => {
    if (!currentPrice30?.length) return null;
    const general = pickLatest(currentPrice30.filter((item) => item.channelType === "general"));
    const feedIn = pickLatest(currentPrice30.filter((item) => item.channelType === "feedIn"));
    const timestamp = general?.startTime || feedIn?.startTime || "";
    return { general, feedIn, timestamp };
  }, [currentPrice30]);
  const usageSummary = useMemo(() => {
    if (!usagePayload?.length) return null;
    let costAud = 0;
    let usageKwh = 0;
    let exportKwh = 0;
    let renewablesWeighted = 0;
    let renewablesWeight = 0;
    usagePayload.forEach((row) => {
      costAud += row.cost / 100;
      if (row.channelType === "general") {
        usageKwh += row.kwh;
      } else if (row.channelType === "feedIn") {
        exportKwh += row.kwh;
      }
      if (Number.isFinite(row.renewables)) {
        const weight = row.kwh || 0;
        renewablesWeighted += row.renewables * weight;
        renewablesWeight += weight;
      }
    });
    const renewablesPct =
      renewablesWeight > 0 ? renewablesWeighted / renewablesWeight : null;
    return { costAud, usageKwh, exportKwh, renewablesPct };
  }, [usagePayload]);
  const renewablesPct = usageSummary?.renewablesPct ?? null;
  const runboard = useMemo(() => {
    if (!activeDiagnostics) return null;
    const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
    const profit = activeDiagnostics.profit;
    const edgeValue = baselineEdge ?? profit;
    const edgeTone =
      baselineEdge === null ? (profit >= 0 ? "good" : "bad") : baselineEdge >= 0 ? "good" : "bad";
    const winRatePct = activeDiagnostics.winRateValue * 100;
    const drawdownRatio = profit > 0 ? activeDiagnostics.drawdown / profit : 1;
    const riskTone = drawdownRatio < 0.5 ? "good" : drawdownRatio < 0.8 ? "warn" : "bad";
    const qualityPct = clamp(activeDiagnostics.qualityScore / 100) * 100;
    const coveragePct = clamp(activeDiagnostics.coveragePct) * 100;
    const utilizationPct =
      efficiencyMetrics?.utilization !== null && efficiencyMetrics?.utilization !== undefined
        ? clamp(efficiencyMetrics.utilization) * 100
        : null;
    const stabilityScore = dailyPerformance
      ? clamp(
          1 -
            (dailyPerformance.std / Math.max(1, Math.abs(dailyPerformance.avg))) * 0.45,
        ) * 100
      : null;
    return {
      cards: [
        {
          label: "Edge vs Baseline",
          value: baselineEdge !== null ? formatProfit(edgeValue) : formatProfit(profit),
          hint: baseline?.name || "Baseline",
          tone: edgeTone,
        },
        {
          label: "Daily Velocity",
          value: formatProfit(activeDiagnostics.avgDailyProfit),
          hint: `${activeDiagnostics.days} day avg`,
          tone: activeDiagnostics.avgDailyProfit >= 0 ? "good" : "bad",
        },
        {
          label: "Win Rate",
          value: `${winRatePct.toFixed(1)}%`,
          hint: `${activeDiagnostics.intervalCount} intervals`,
          tone: winRatePct >= 55 ? "good" : winRatePct >= 45 ? "warn" : "bad",
        },
        {
          label: "Risk Pressure",
          value: `${(drawdownRatio * 100).toFixed(0)}%`,
          hint: "Drawdown vs profit",
          tone: riskTone,
        },
      ],
      bars: [
        {
          label: "Coverage",
          value: coveragePct,
          hint: `${activeDiagnostics.missingIntervals} gaps`,
          tone: coveragePct >= 95 ? "good" : coveragePct >= 90 ? "warn" : "bad",
        },
        {
          label: "Quality Score",
          value: qualityPct,
          hint: `${activeDiagnostics.qualityScore}/100`,
          tone: qualityPct >= 70 ? "good" : qualityPct >= 55 ? "warn" : "bad",
        },
        {
          label: "Utilization",
          value: utilizationPct,
          hint: utilizationPct === null ? "Awaiting throughput" : `${utilizationPct.toFixed(1)}%`,
          tone:
            utilizationPct === null
              ? "neutral"
              : utilizationPct >= 60
                ? "good"
                : utilizationPct >= 35
                  ? "warn"
                  : "bad",
        },
        {
          label: "Consistency",
          value: stabilityScore,
          hint:
            stabilityScore === null
              ? "Run backtest for daily spread"
              : `${stabilityScore.toFixed(0)}/100`,
          tone:
            stabilityScore === null
              ? "neutral"
              : stabilityScore >= 65
                ? "good"
                : stabilityScore >= 45
                  ? "warn"
                  : "bad",
        },
      ],
      pills: [
        `${activeDiagnostics.days} day window`,
        `${activeDiagnostics.intervalCount} intervals`,
        `${range.resolution} min cadence`,
        baselineEdge === null
          ? "Baseline comparison n/a"
          : baselineEdge >= 0
            ? "Edge positive"
            : "Edge negative",
      ],
    };
  }, [
    activeDiagnostics,
    baselineEdge,
    baseline?.name,
    dailyPerformance,
    efficiencyMetrics,
    range.resolution,
  ]);

  const backtestDock = useMemo(() => {
    const readiness = executiveBrief?.cards[0] ?? null;
    const risk =
      executiveBrief?.cards.find((card) => card.label === "Risk Posture") ?? null;
    const nextMove = executiveBrief?.nextMoves[0] ?? null;

    const edgeCard = runboard?.cards[0];
    const velocityCard = runboard?.cards[1];
    const coverageBar = runboard?.bars[0];
    const qualityBar = runboard?.bars[1];

    const cards = [
      {
        label: edgeCard?.label || "Edge vs Baseline",
        value: edgeCard?.value || "—",
        hint: edgeCard?.hint || "Baseline comparison pending.",
        tone: edgeCard?.tone || "neutral",
      },
      {
        label: velocityCard?.label || "Daily Velocity",
        value: velocityCard?.value || "—",
        hint: velocityCard?.hint || "Awaiting backtest window.",
        tone: velocityCard?.tone || "neutral",
      },
      {
        label: coverageBar?.label || "Coverage",
        value:
          coverageBar?.value !== null && coverageBar?.value !== undefined
            ? `${Math.round(coverageBar.value)}%`
            : "—",
        hint: coverageBar?.hint || "Load data to evaluate coverage.",
        tone: coverageBar?.tone || "neutral",
      },
      {
        label: qualityBar?.label || "Quality Score",
        value: qualityBar?.hint || "—",
        hint: qualityBar ? "Signal quality score" : "Run backtest to score quality.",
        tone: qualityBar?.tone || "neutral",
      },
    ];

    return { readiness, risk, nextMove, cards };
  }, [executiveBrief, runboard]);

  const backtestPulse = useMemo(() => {
    const profit = activeDiagnostics?.profit ?? null;
    const avgDaily = activeDiagnostics?.avgDailyProfit ?? null;
    const winRate = activeDiagnostics ? activeDiagnostics.winRateValue * 100 : null;
    const coveragePct = activeDiagnostics ? activeDiagnostics.coveragePct * 100 : null;
    const qualityScore = activeDiagnostics?.qualityScore ?? null;
    const edgeTone =
      baselineEdge === null ? "neutral" : baselineEdge >= 0 ? "good" : "bad";
    const profitTone = profit === null ? "neutral" : profit >= 0 ? "good" : "bad";
    const winTone =
      winRate === null ? "neutral" : winRate >= 55 ? "good" : winRate >= 45 ? "warn" : "bad";
    const qualityTone =
      qualityScore === null
        ? "neutral"
        : qualityScore >= 70
          ? "good"
          : qualityScore >= 55
            ? "warn"
            : "bad";
    const coverageTone =
      coveragePct === null
        ? "neutral"
        : coveragePct >= 95
          ? "good"
          : coveragePct >= 90
            ? "warn"
            : "bad";
    const readinessTone = backtestReadiness.dataLoaded ? "good" : "warn";
    const strategyLabel = active?.name || activeStrategy || "—";
    const modeLabel = config.mode === "threshold" ? "Threshold" : "Percentile";

    return {
      cards: [
        {
          label: "Net Profit",
          value: profit === null ? "—" : formatProfit(profit),
          hint: activeDiagnostics ? `${activeDiagnostics.days} day window` : "Run backtest to score profit.",
          tone: profitTone,
        },
        {
          label: "Edge vs Baseline",
          value: baselineEdge === null ? "—" : formatProfit(baselineEdge),
          hint: baseline?.name || "Baseline comparison",
          tone: edgeTone,
        },
        {
          label: "Win Rate",
          value: winRate === null ? "—" : `${winRate.toFixed(1)}%`,
          hint: activeDiagnostics ? `${activeDiagnostics.intervalCount} intervals` : "Awaiting signals",
          tone: winTone,
        },
        {
          label: "Quality Score",
          value: qualityScore === null ? "—" : `${qualityScore}/100`,
          hint: activeDiagnostics ? `${activeDiagnostics.missingIntervals} gaps` : "Run backtest to measure",
          tone: qualityTone,
        },
        {
          label: "Coverage",
          value: coveragePct === null ? "—" : `${coveragePct.toFixed(1)}%`,
          hint: backtestReadiness.dataLoaded ? backtestReadiness.dataNote : "Load data to evaluate",
          tone: coverageTone,
        },
        {
          label: "Avg Daily",
          value: avgDaily === null ? "—" : formatProfit(avgDaily),
          hint: activeDiagnostics ? "Daily velocity" : "Run backtest to compute",
          tone: avgDaily === null ? "neutral" : avgDaily >= 0 ? "good" : "bad",
        },
      ],
      rail: [
        {
          label: "Readiness",
          value: backtestReadiness.dataLoaded ? "Data Loaded" : "Data Missing",
          hint: backtestReadiness.usageLoaded ? "Usage synced" : "Usage payload missing",
          tone: readinessTone,
        },
        {
          label: "Strategy",
          value: strategyLabel,
          hint: `${modeLabel} · ${config.capacityKwh} kWh`,
          tone: "neutral",
        },
        {
          label: "Window",
          value: `${range.start} → ${range.end}`,
          hint: `${range.resolution} min cadence`,
          tone: "neutral",
        },
        {
          label: "Next Move",
          value: backtestDock.nextMove || "Run backtest to surface next moves.",
          hint: backtestReadiness.dataLoaded
            ? "Adjust thresholds, then re-run the runboard."
            : "Load pricing + usage to unlock tuning guidance.",
          tone: "focus",
        },
      ],
    };
  }, [
    activeDiagnostics,
    active,
    activeStrategy,
    backtestDock.nextMove,
    backtestReadiness,
    baseline?.name,
    baselineEdge,
    config.capacityKwh,
    config.mode,
    range.end,
    range.resolution,
    range.start,
  ]);
  const backtestHud = useMemo(() => {
    const modeLabel = config.mode === "threshold" ? "Threshold" : "Percentile";
    const profit = activeDiagnostics?.profit ?? null;
    const drawdown = activeDiagnostics?.drawdown ?? null;
    const coveragePct = activeDiagnostics ? activeDiagnostics.coveragePct * 100 : null;
    const qualityScore = activeDiagnostics?.qualityScore ?? null;
    const utilization =
      efficiencyMetrics?.utilization !== null && efficiencyMetrics?.utilization !== undefined
        ? efficiencyMetrics.utilization * 100
        : null;
    const profitTone = profit === null ? "neutral" : profit >= 0 ? "good" : "bad";
    const edgeTone = baselineEdge === null ? "neutral" : baselineEdge >= 0 ? "good" : "bad";
    const coverageTone =
      coveragePct === null ? "neutral" : coveragePct >= 95 ? "good" : coveragePct >= 85 ? "warn" : "bad";
    const qualityTone =
      qualityScore === null ? "neutral" : qualityScore >= 70 ? "good" : qualityScore >= 55 ? "warn" : "bad";
    const utilizationTone =
      utilization === null ? "neutral" : utilization >= 60 ? "good" : utilization >= 35 ? "warn" : "bad";
    const drawdownTone =
      drawdown === null ? "neutral" : profit !== null && drawdown > Math.max(profit * 0.7, 10) ? "warn" : "neutral";
    return {
      status: loading.crunch ? "Crunching backtest..." : status,
      cards: [
        {
          label: "Active Strategy",
          value: active?.name || "—",
          hint: `${modeLabel} · ${config.capacityKwh} kWh · ${config.maxPowerKw} kW`,
          tone: backtestReadiness.dataLoaded ? "good" : "neutral",
        },
        {
          label: "Net Profit",
          value: profit === null ? "—" : formatProfit(profit),
          hint: activeDiagnostics ? `${activeDiagnostics.days} day window` : "Run backtest to score profit",
          tone: profitTone,
        },
        {
          label: "Edge vs Baseline",
          value: baselineEdge === null ? "—" : formatProfit(baselineEdge),
          hint: baseline?.name || "Baseline",
          tone: edgeTone,
        },
        {
          label: "Coverage",
          value: coveragePct === null ? "—" : `${coveragePct.toFixed(1)}%`,
          hint: activeDiagnostics
            ? `${activeDiagnostics.intervalCount} intervals · ${activeDiagnostics.missingIntervals} gaps`
            : "Load data to evaluate",
          tone: coverageTone,
        },
        {
          label: "Max Drawdown",
          value: drawdown === null ? "—" : formatProfit(-drawdown),
          hint: "Peak-to-trough risk",
          tone: drawdownTone,
        },
        {
          label: "Quality Score",
          value: qualityScore === null ? "—" : `${qualityScore}/100`,
          hint: healthStatus?.label || "Data + profit health",
          tone: qualityTone,
        },
        {
          label: "Utilization",
          value: utilization === null ? "—" : `${utilization.toFixed(1)}%`,
          hint: efficiencyMetrics ? `${efficiencyMetrics.throughput.toFixed(1)} kWh traded` : "Awaiting backtest",
          tone: utilizationTone,
        },
      ],
      nextMove:
        backtestDock.nextMove ||
        (backtestReadiness.dataLoaded
          ? "Adjust thresholds, then re-run the runboard."
          : "Load pricing + usage to unlock tuning guidance."),
    };
  }, [
    active,
    activeDiagnostics,
    backtestDock.nextMove,
    backtestReadiness.dataLoaded,
    baseline,
    baselineEdge,
    config.capacityKwh,
    config.maxPowerKw,
    config.mode,
    efficiencyMetrics,
    healthStatus,
    loading.crunch,
    status,
  ]);

  const backtestSummary = useMemo(() => {
    const readinessScore = executiveBrief?.readinessScore ?? null;
    const readinessTone =
      readinessScore === null ? "neutral" : readinessScore >= 70 ? "good" : readinessScore >= 50 ? "warn" : "bad";
    const launch = flightPlan?.launch ?? null;
    const riskScore = flightPlan?.riskScore ?? null;
    const stabilityIndex = flightPlan?.stabilityIndex ?? null;
    const cadenceLabel = flightPlan?.cadenceLabel ?? `${range.resolution} min cadence`;
    const riskLabel = flightPlan?.riskLabel ?? "Risk pending";
    const coveragePct = activeDiagnostics ? activeDiagnostics.coveragePct * 100 : null;
    const coverageTone =
      coveragePct === null ? "neutral" : coveragePct >= 95 ? "good" : coveragePct >= 90 ? "warn" : "bad";
    const edgeTone = baselineEdge === null ? "neutral" : baselineEdge >= 0 ? "good" : "bad";
    const nextMoves =
      executiveBrief?.nextMoves?.length
        ? executiveBrief.nextMoves
        : [
            backtestReadiness.dataLoaded
              ? "Run the runboard to validate readiness."
              : "Load pricing + usage to unlock guidance.",
          ];
    return {
      readinessScore,
      readinessTone,
      readinessLabel: readinessScore === null ? "—" : `${readinessScore.toFixed(0)}/100`,
      launch,
      riskScore,
      stabilityIndex,
      cadenceLabel,
      riskLabel,
      coveragePct,
      coverageTone,
      edgeLabel: baselineEdge === null ? "Baseline n/a" : formatProfit(baselineEdge),
      edgeTone,
      nextMoves: nextMoves.slice(0, 3),
    };
  }, [
    activeDiagnostics,
    backtestReadiness.dataLoaded,
    baselineEdge,
    executiveBrief,
    flightPlan,
    range.resolution,
  ]);

  const backtestBrief = useMemo(() => {
    if (!activeDiagnostics) {
      return {
        tone: "neutral",
        headline: "Run a backtest to generate the executive brief.",
        subhead: "Load pricing + usage, then re-run to unlock readiness signals.",
        drivers: ["No diagnostics available yet."],
        cards: [
          { label: "Readiness", value: "—", hint: "Awaiting run" },
          { label: "Edge", value: "—", hint: "Baseline pending" },
          { label: "Risk", value: "—", hint: "Risk pending" },
        ],
      };
    }
    const edgeLabel = baselineEdge === null ? "—" : formatProfit(baselineEdge);
    const readiness = executiveBrief?.readinessScore ?? null;
    const readinessLabel = readiness === null ? "—" : `${Math.round(readiness)}%`;
    const riskScore = flightPlan?.riskScore ?? null;
    const riskLabel = flightPlan?.riskLabel ?? "Risk pending";
    const quality = activeDiagnostics.qualityScore;
    const confidenceScore = clampNumber(
      activeDiagnostics.coveragePct * 0.4 +
        (quality / 100) * 0.4 +
        Math.min(1, activeDiagnostics.days / 7) * 0.2,
      0,
      1,
    );
    const confidenceLabel = `${Math.round(confidenceScore * 100)}%`;
    const confidenceHint =
      activeDiagnostics.days >= 5
        ? "Healthy sample depth"
        : `Sample depth ${activeDiagnostics.days} day${activeDiagnostics.days === 1 ? "" : "s"}`;
    let nextStepLabel = "Run a backtest";
    let nextStepHint = "Load pricing + usage to unlock guidance.";
    if (activeDiagnostics) {
      if (baselineEdge !== null && baselineEdge < 0) {
        nextStepLabel = "Retune thresholds";
        nextStepHint = "Active trailing baseline.";
      } else if (quality < 65) {
        nextStepLabel = "Clean signal noise";
        nextStepHint = "Quality below target.";
      } else {
        nextStepLabel = "Scale cautiously";
        nextStepHint = "Edge positive with guardrails.";
      }
    }
    let tone = "neutral";
    let headline = "Hold for tuning before scale.";
    if (quality >= 70 && (baselineEdge === null || baselineEdge >= 0)) {
      tone = "good";
      headline = "Backtest ready to scale with guardrails.";
    } else if (baselineEdge !== null && baselineEdge < 0) {
      tone = "warn";
      headline = "Backtest trailing baseline — refine before scaling.";
    } else if (quality < 60) {
      tone = "warn";
      headline = "Signal quality is soft — tighten thresholds.";
    }
    const drivers = [
      `Readiness ${readinessLabel}`,
      `Quality ${quality}/100`,
      `Edge ${edgeLabel}`,
      `Risk ${riskScore === null ? "—" : riskScore.toFixed(0)}`,
      `Coverage ${(activeDiagnostics.coveragePct * 100).toFixed(1)}%`,
      `Confidence ${confidenceLabel}`,
    ];
    return {
      tone,
      headline,
      subhead: flightPlan?.nextDetail || "Review readiness and risk before deployment.",
      drivers,
      cards: [
        {
          label: "Readiness",
          value: readinessLabel,
          hint: executiveBrief?.cards[0]?.note || "Readiness pending",
        },
        {
          label: "Edge",
          value: edgeLabel,
          hint: baselineEdge === null ? "Baseline pending" : "Active vs baseline",
        },
        {
          label: "Risk",
          value: riskScore === null ? "—" : riskScore.toFixed(0),
          hint: riskLabel,
        },
        {
          label: "Confidence",
          value: confidenceLabel,
          hint: confidenceHint,
        },
        {
          label: "Next Step",
          value: nextStepLabel,
          hint: nextStepHint,
        },
      ],
    };
  }, [activeDiagnostics, baselineEdge, executiveBrief, flightPlan]);

  const backtestVerdict = useMemo(() => {
    if (!activeDiagnostics) {
      return {
        headline: "Run a backtest to generate the verdict.",
        subhead: "Load pricing + usage to unlock conclusions.",
        tone: "neutral",
        drivers: ["No diagnostics available yet."],
        nextMove: backtestSummary.nextMoves[0] || "Load data to unlock insights.",
      };
    }
    const profit = activeDiagnostics.profit;
    const edge = baselineEdge ?? 0;
    const healthLabel = healthStatus?.label || "Health pending";
    const qualityScore = activeDiagnostics.qualityScore;
    const stabilityIndex = flightPlan?.stabilityIndex ?? null;
    const riskScore = flightPlan?.riskScore ?? null;
    const confidenceScore = clampNumber(
      activeDiagnostics.coveragePct * 0.4 +
        (qualityScore / 100) * 0.4 +
        Math.min(1, activeDiagnostics.days / 7) * 0.2,
      0,
      1,
    );
    const confidenceLabel = `${Math.round(confidenceScore * 100)}%`;
    let tone = "neutral";
    let headline = "Mixed signal — iterate before deployment.";
    if (
      profit >= 0 &&
      edge >= 0 &&
      qualityScore >= 70 &&
      (riskScore === null || riskScore < 60) &&
      (stabilityIndex === null || stabilityIndex >= 65)
    ) {
      tone = "good";
      headline = "Backtest verdict: deployable with guardrails.";
    } else if (profit < 0 || edge < 0 || (riskScore !== null && riskScore >= 70)) {
      tone = "warn";
      headline = "Backtest verdict: underperforming vs baseline.";
    }
    const drivers = [
      `Profit ${formatProfit(profit)}`,
      `Edge ${baselineEdge === null ? "—" : formatProfit(baselineEdge)}`,
      `Quality ${qualityScore}/100`,
      `Stability ${stabilityIndex === null ? "—" : `${stabilityIndex.toFixed(0)}/100`}`,
      `Risk ${riskScore === null ? "—" : riskScore.toFixed(0)}`,
      `Confidence ${confidenceLabel}`,
      `Health ${healthLabel}`,
    ];
    return {
      headline,
      subhead: backtestSummary.launch?.detail || "Review readiness and risk before deployment.",
      tone,
      drivers,
      nextMove: backtestSummary.nextMoves[0] || "Iterate thresholds and re-run.",
    };
  }, [activeDiagnostics, baselineEdge, backtestSummary, healthStatus, flightPlan]);

  const backtestFocus = useMemo(() => {
    const readiness = backtestSummary.readinessLabel;
    const edge = backtestSummary.edgeLabel;
    const risk = backtestSummary.riskLabel;
    const nextMove = backtestVerdict.nextMove || backtestSummary.nextMoves[0] || "Run a backtest.";
    return {
      headline: backtestVerdict.headline,
      subhead: backtestVerdict.subhead,
      tone: backtestVerdict.tone,
      nextMove,
      highlights: [
        `Readiness ${readiness}`,
        `Edge ${edge}`,
        `Risk ${risk}`,
        `Coverage ${backtestSummary.coveragePct === null ? "—" : `${backtestSummary.coveragePct.toFixed(1)}%`}`,
      ],
    };
  }, [backtestSummary, backtestVerdict]);

  const backtestNav = useMemo(
    () => [
      { id: "backtest-brief", label: "Executive Brief" },
      { id: "backtest-verdict", label: "Verdict" },
      { id: "backtest-summary", label: "Summary Deck" },
      { id: "backtest-hud", label: "Command HUD" },
      { id: "backtest-pulse", label: "Focus Strip" },
      { id: "backtest-briefing", label: "Signal Brief" },
      { id: "backtest-mission", label: "Mission Control" },
      { id: "backtest-runboard", label: "Runboard" },
      { id: "backtest-atlas", label: "Insight Atlas" },
      { id: "backtest-scenarios", label: "Scenario Matrix" },
      { id: "backtest-command", label: "Command Center" },
      { id: "backtest-optimization", label: "Optimization" },
      { id: "backtest-comparison", label: "Comparison" },
      { id: "backtest-settings", label: "Strategy Settings" },
    ],
    [],
  );

  const monitorSeries = useMemo(() => {
    const source = currentPrice?.length ? currentPrice : payload?.length ? payload : [];
    if (!source.length) return { buy: [], sell: [], lastTime: null as string | null };
    const maxHistory = Math.max(48, Math.round((24 * 7 * 60) / 5));
    const sliced = source.slice(-maxHistory);
    return buildSeries(sliced);
  }, [payload, currentPrice]);

  const liveTimeline = useMemo(() => {
    if (!currentPrice?.length) return [];
    const now = Date.now();
    const bucket = new Map<string, { time: string; buy: number; sell: number }>();
    currentPrice
      .slice()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .forEach((item) => {
        const ts = new Date(item.startTime).getTime();
        if (ts < now) return;
        if (!bucket.has(item.startTime)) {
          bucket.set(item.startTime, { time: item.startTime, buy: 0, sell: 0 });
        }
        const entry = bucket.get(item.startTime)!;
        if (item.channelType === "general") entry.buy = item.perKwh;
        if (item.channelType === "feedIn") entry.sell = Math.abs(item.perKwh);
      });
    return Array.from(bucket.values());
  }, [currentPrice]);

  const bestStrategyName = bestLeaderboard || active?.name || "";
  const bestStrategyNote = bestStrategyName ? noteForStrategy(bestStrategyName) : "";

  const monitorInputs = useMemo(
    () => ({
      currentBuy: currentSummary?.general?.perKwh ?? null,
      currentSell: currentSummary?.feedIn ? Math.abs(currentSummary.feedIn.perKwh) : null,
      renewablesPct:
        currentSummary?.general?.renewables ?? currentSummary?.feedIn?.renewables ?? null,
      buySeries: monitorSeries.buy,
      sellSeries: monitorSeries.sell,
      lastTimeIso: monitorSeries.lastTime,
      resolutionMinutes: 5,
      horizonHours: 12,
      battery: batteryStatus,
      thresholds: { buy: config.buyThreshold, sell: config.sellThreshold },
      bestStrategyName,
      bestStrategyNote,
    }),
    [
      currentSummary?.general?.perKwh,
      currentSummary?.feedIn,
      monitorSeries.buy,
      monitorSeries.sell,
      monitorSeries.lastTime,
      batteryStatus,
      config.buyThreshold,
      config.sellThreshold,
      bestStrategyName,
      bestStrategyNote,
    ],
  );

  const monitorForecast = useMemo(
    () =>
      buildForecastSignal({
        buySeries: monitorSeries.buy,
        sellSeries: monitorSeries.sell,
        lastTimeIso: monitorSeries.lastTime ?? currentSummary?.timestamp ?? null,
        horizonHours: 12,
        resolutionMinutes: 5,
        timeline: liveTimeline,
      }),
    [monitorSeries.buy, monitorSeries.sell, monitorSeries.lastTime, currentSummary?.timestamp, liveTimeline],
  );

  const monitorPriceWindow = useMemo(() => {
    if (!monitorForecast?.timeline?.length) return null;
    const timeline = monitorForecast.timeline;
    const bestBuy = timeline.reduce((best, point) => (point.buy < best.buy ? point : best), timeline[0]);
    const bestSell = timeline.reduce(
      (best, point) => (point.sell > best.sell ? point : best),
      timeline[0],
    );
    const buyLabel = formatTimestamp(bestBuy.time);
    const sellLabel = formatTimestamp(bestSell.time);
    return {
      buyLabel,
      sellLabel,
      spread: Math.max(0, bestSell.sell - bestBuy.buy),
    };
  }, [monitorForecast]);

  const monitorDecision: MonitorDecision | null = useMemo(() => {
    if (!monitorInputs.currentBuy && !monitorInputs.currentSell) return null;
    return decideMonitorAction(monitorInputs, monitorForecast);
  }, [monitorInputs, monitorForecast]);

  const monitorRl = useMemo(() => {
    if (!monitorDecision) return null;
    return buildRlExplanation(monitorInputs, monitorForecast, monitorDecision.action);
  }, [monitorDecision, monitorInputs, monitorForecast]);

  const monitorTimeline = useMemo(
    () => buildDecisionTimeline(monitorForecast, monitorInputs),
    [monitorForecast, monitorInputs],
  );

  const projectedProfit = useMemo(() => {
    if (!monitorForecast || !monitorTimeline.length) return null;
    const intervalHours = range.resolution / 60;
    const maxPower = Math.min(config.maxPowerKw, config.inverterMaxKw);
    const energyLimit = maxPower * intervalHours;
    let soc = (batteryStatus.socPct / 100) * config.capacityKwh;
    let cash = 0;
    monitorTimeline.forEach((item) => {
      if (item.action === "charge") {
        const charge = Math.min(energyLimit, config.capacityKwh - soc);
        soc += charge;
        cash -= (charge * item.buy) / 100;
      } else if (item.action === "discharge") {
        const discharge = Math.min(energyLimit, soc);
        soc -= discharge;
        cash += (discharge * item.sell) / 100;
      }
    });
    return cash;
  }, [
    monitorForecast,
    monitorTimeline,
    range.resolution,
    config.maxPowerKw,
    config.inverterMaxKw,
    config.capacityKwh,
    batteryStatus.socPct,
  ]);

  const monitorPriceStats = useMemo(() => {
    const buySeries = (currentPrice || [])
      .filter((row) => row.channelType === "general")
      .map((row) => row.perKwh);
    const sellSeries = (currentPrice || [])
      .filter((row) => row.channelType === "feedIn")
      .map((row) => Math.abs(row.perKwh));
    const buy30Series = (currentPrice30 || [])
      .filter((row) => row.channelType === "general")
      .map((row) => row.perKwh);
    const sell30Series = (currentPrice30 || [])
      .filter((row) => row.channelType === "feedIn")
      .map((row) => Math.abs(row.perKwh));
    const liveBuy = currentSummary?.general?.perKwh ?? null;
    const liveSell = currentSummary?.feedIn ? Math.abs(currentSummary.feedIn.perKwh) : null;
    const spread = liveBuy !== null && liveSell !== null ? liveSell - liveBuy : null;
    const buyTrend = buySeries.length > 1 ? buySeries[buySeries.length - 1] - buySeries[0] : 0;
    const sellTrend = sellSeries.length > 1 ? sellSeries[sellSeries.length - 1] - sellSeries[0] : 0;
    const buySlope = linearSlope(buySeries);
    const sellSlope = linearSlope(sellSeries);
    const buyVol = stdDev(buySeries);
    const sellVol = stdDev(sellSeries);
    const volatilityScore = clampNumber((buyVol + sellVol) / 2 / 12, 0, 1);
    const spreadStrength = spread !== null ? clampNumber(spread / 15, 0, 1) : 0;
    const trendStrength = clampNumber(Math.abs(buySlope) / 0.6, 0, 1);
    const regimeScore = clampNumber(
      0.45 * spreadStrength + 0.35 * volatilityScore + 0.2 * trendStrength,
      0,
      1,
    );
    const regimeLabel = regimeScore > 0.65 ? "Volatile" : regimeScore > 0.4 ? "Active" : "Calm";
    const momentumLabel =
      buySlope > 0.25 ? "Rising buy" : buySlope < -0.25 ? "Falling buy" : "Flat buy";
    const riskLabel =
      volatilityScore > 0.6 ? "High volatility" : volatilityScore > 0.35 ? "Mixed volatility" : "Stable";
    return {
      liveBuy,
      liveSell,
      spread,
      buyVol,
      sellVol,
      buyTrend,
      sellTrend,
      buy30Avg: buy30Series.length ? average(buy30Series) : null,
      sell30Avg: sell30Series.length ? average(sell30Series) : null,
      buySlope,
      sellSlope,
      regimeScore,
      regimeLabel,
      momentumLabel,
      riskLabel,
    };
  }, [currentPrice, currentPrice30, currentSummary]);

  const monitorStrategyCards = useMemo(() => {
    const winRateLabel = activeDiagnostics
      ? `${(activeDiagnostics.winRateValue * 100).toFixed(1)}%`
      : "—";
    const avgDaily = activeDiagnostics ? formatProfit(activeDiagnostics.avgDailyProfit) : "—";
    const quality = activeDiagnostics ? `${activeDiagnostics.qualityScore}/100` : "—";
    const edgeLabel = baselineEdge === null ? "—" : formatProfit(baselineEdge);
    const drawdownLabel = activeDiagnostics ? formatProfit(-activeDiagnostics.drawdown) : "—";
    return [
      {
        label: "Active Strategy",
        value: active?.name || activeStrategy || "—",
        hint: bestStrategyNote || "Use backtest to rank strategies.",
      },
      {
        label: "Thresholds",
        value: `${config.buyThreshold}c / ${config.sellThreshold}c`,
        hint: config.mode === "threshold" ? "Threshold mode" : "Percentile mode",
      },
      {
        label: "Win Rate",
        value: winRateLabel,
        hint: activeDiagnostics ? `${activeDiagnostics.days} day sample` : "Run a backtest.",
      },
      {
        label: "Avg Daily",
        value: avgDaily,
        hint: activeDiagnostics ? "Daily momentum" : "Awaiting run.",
      },
      {
        label: "Signal Quality",
        value: quality,
        hint: activeDiagnostics ? `${activeDiagnostics.intervalCount} intervals` : "No diagnostics yet.",
      },
      {
        label: "Edge vs Baseline",
        value: edgeLabel,
        hint: baselineEdge === null ? "Baseline pending" : "Active minus baseline",
      },
      {
        label: "Max Drawdown",
        value: drawdownLabel,
        hint: activeDiagnostics ? "Peak-to-trough risk" : "Awaiting run",
      },
    ];
  }, [
    active?.name,
    activeStrategy,
    bestStrategyNote,
    config.buyThreshold,
    config.sellThreshold,
    config.mode,
    activeDiagnostics,
    baselineEdge,
  ]);

  const monitorStrategyPulse = useMemo(() => {
    const edgeLabel = baselineEdge === null ? "—" : formatProfit(baselineEdge);
    const qualityLabel = activeDiagnostics ? `${activeDiagnostics.qualityScore}/100` : "—";
    const momentumLabel = activeDiagnostics ? formatProfit(activeDiagnostics.avgDailyProfit) : "—";
    let tuneLabel = "Run a backtest";
    let tuneHint = "No diagnostics yet.";
    if (activeDiagnostics) {
      if (baselineEdge !== null && baselineEdge < 0) {
        tuneLabel = "Retune thresholds";
        tuneHint = "Active trailing baseline.";
      } else if (activeDiagnostics.qualityScore < 65) {
        tuneLabel = "Clean signal noise";
        tuneHint = "Quality below 65.";
      } else {
        tuneLabel = "Scale cautiously";
        tuneHint = "Edge positive with stable quality.";
      }
    }
    return [
      { label: "Edge", value: edgeLabel, hint: baselineEdge === null ? "Baseline pending" : "Active vs baseline" },
      { label: "Quality", value: qualityLabel, hint: activeDiagnostics ? `${activeDiagnostics.days} days` : "Awaiting run" },
      {
        label: "Momentum",
        value: momentumLabel,
        hint: activeDiagnostics ? "Avg daily profit" : "Awaiting run",
      },
      { label: "Next Step", value: tuneLabel, hint: tuneHint },
    ];
  }, [activeDiagnostics, baselineEdge]);

  const monitorRlSummary = useMemo(() => {
    if (!monitorRl) return null;
    const policyCharge = Math.round(monitorRl.policy.charge * 100);
    const policyDischarge = Math.round(monitorRl.policy.discharge * 100);
    const policyHold = Math.round(monitorRl.policy.hold * 100);
    return {
      action: monitorDecision?.action ?? "hold",
      qSpread: Math.max(monitorRl.qValues.charge, monitorRl.qValues.discharge, monitorRl.qValues.hold) -
        Math.min(monitorRl.qValues.charge, monitorRl.qValues.discharge, monitorRl.qValues.hold),
      policy: `C ${policyCharge}% · D ${policyDischarge}% · H ${policyHold}%`,
      expectedReturn: monitorRl.expectedReturn,
      reward: monitorRl.immediateReward,
    };
  }, [monitorRl, monitorDecision?.action]);

  const monitorRlPulse = useMemo(() => {
    if (!monitorRl || !monitorRlSummary) {
      return [
        { label: "Policy Clarity", value: "—", hint: "Awaiting RL context" },
        { label: "Constraint", value: "—", hint: "Load current prices" },
        { label: "Value Edge", value: "—", hint: "No Q spread yet" },
      ];
    }
    const entropy = normalizedEntropy([
      monitorRl.policy.charge,
      monitorRl.policy.discharge,
      monitorRl.policy.hold,
    ]);
    const clarityLabel =
      entropy <= 0.4 ? "Decisive" : entropy <= 0.65 ? "Balanced" : "Diffuse";
    const constraintLabel =
      monitorRl.constraints.socOkToCharge && monitorRl.constraints.socOkToDischarge
        ? "SOC ready"
        : monitorRl.constraints.socOkToCharge
          ? "Charge only"
          : monitorRl.constraints.socOkToDischarge
            ? "Discharge only"
            : "SOC constrained";
    return [
      { label: "Policy Clarity", value: clarityLabel, hint: `Entropy ${Math.round(entropy * 100)}%` },
      { label: "Constraint", value: constraintLabel, hint: `Reserve ${monitorRl.state.reservePct.toFixed(0)}%` },
      { label: "Value Edge", value: monitorRlSummary.qSpread.toFixed(2), hint: "Q spread" },
    ];
  }, [monitorRl, monitorRlSummary]);

  const weatherSummaryCards = useMemo(() => {
    return [
      {
        label: "Impact Verdict",
        value: weatherImpact.impactSummary,
        hint: weatherImpact.impactNote,
      },
      {
        label: "Forecast Tracking",
        value: weatherImpact.trackingLabel,
        hint: `${weatherImpact.trackingNote} · ${weatherImpact.reliabilityLabel}`,
      },
      {
        label: "Solar Outlook",
        value: weatherImpact.solarOutlookLabel,
        hint: weatherImpact.solarOutlookNote,
      },
      {
        label: "Best Window",
        value: weatherImpact.bestWindowLabel,
        hint: weatherImpact.bestWindowNote,
      },
    ];
  }, [weatherImpact]);

  const weatherPulseCards = useMemo(() => {
    const avgLabel =
      weatherSummary.avg === null ? "—" : `${Math.round(weatherSummary.avg * 100)}%`;
    const peakLabel =
      weatherSummary.peak === null ? "—" : `${Math.round(weatherSummary.peak * 100)}%`;
    const maeLabel =
      solarForecastMetrics ? `${solarForecastMetrics.mae.toFixed(2)} kW` : "—";
    const mapeLabel =
      solarForecastMetrics ? `${Math.round(solarForecastMetrics.mape * 100)}%` : "—";
    const clearLabel =
      weatherImpact.clearHours ? `${weatherImpact.clearHours} hrs` : "—";
    const solarLossLabel =
      weatherImpact.solarLossPct === null ? "—" : `${Math.round(weatherImpact.solarLossPct * 100)}%`;
    const biasLabel =
      solarForecastMetrics?.biasPct === null || solarForecastMetrics?.biasPct === undefined
        ? "—"
        : `${(solarForecastMetrics.biasPct * 100).toFixed(1)}%`;
    const signalCorrLabel =
      weatherImpact.signalCorrelation === null ? "—" : weatherImpact.signalCorrelation.toFixed(2);
    const daylightCoverageLabel =
      weatherImpact.daylightCoverage === null
        ? "—"
        : `${Math.round(weatherImpact.daylightCoverage * 100)}%`;
    const persistenceLabel =
      weatherImpact.persistence === null
        ? "—"
        : `${Math.round(weatherImpact.persistence * 100)}%`;
    const diurnalLabel =
      weatherImpact.diurnalBias === null
        ? "—"
        : `${(weatherImpact.diurnalBias * 100).toFixed(1)}%`;
    const reliabilityLabel =
      weatherImpact.reliabilityScore === null
        ? "—"
        : `${Math.round(weatherImpact.reliabilityScore * 100)}%`;
    const rampLabel =
      weatherImpact.rampRiskScore === null
        ? "—"
        : `${Math.round(weatherImpact.rampRiskScore * 100)}%`;
    const trackingLabel =
      weatherImpact.trackingScore === null
        ? "—"
        : `${Math.round(weatherImpact.trackingScore * 100)}%`;
    const hourlyFitLabel =
      weatherImpact.hourlyFitScore === null
        ? "—"
        : `${Math.round(weatherImpact.hourlyFitScore * 100)}%`;
    return [
      {
        label: "Cloud Cover Avg",
        value: avgLabel,
        hint: weatherSummary.sampleCount ? `${weatherSummary.sampleCount} hrs` : "No weather feed",
      },
      {
        label: "Cloud Peak",
        value: peakLabel,
        hint: weatherSummary.trend,
      },
      {
        label: "Pattern Stability",
        value: persistenceLabel,
        hint: weatherImpact.persistenceLabel,
      },
      {
        label: "Diurnal Bias",
        value: diurnalLabel,
        hint: weatherImpact.diurnalLabel,
      },
      {
        label: "Signal Link",
        value: signalCorrLabel,
        hint: weatherImpact.signalLabel,
      },
      {
        label: "Clear Window",
        value: clearLabel,
        hint: weatherImpact.impactLabel,
      },
      {
        label: "Solar Loss",
        value: solarLossLabel,
        hint: weatherImpact.solarLossPct === null ? "Loss vs clear sky" : "Actual vs clear sky",
      },
      {
        label: "Clear-sky Index",
        value:
          weatherImpact.clearSkyIndex === null
            ? "—"
            : `${Math.round(weatherImpact.clearSkyIndex * 100)}%`,
        hint: weatherImpact.clearSkyLabel,
      },
      {
        label: "Ramp Risk",
        value: rampLabel,
        hint: weatherImpact.rampLabel,
      },
      {
        label: "Reliability",
        value: reliabilityLabel,
        hint: weatherImpact.reliabilityLabel,
      },
      {
        label: "Tracking Score",
        value: trackingLabel,
        hint: weatherImpact.trackingNote,
      },
      {
        label: "Forecast MAPE",
        value: mapeLabel,
        hint: solarForecastMetrics ? `Bias ${solarForecastMetrics.bias.toFixed(2)} kW` : "Awaiting data",
      },
      {
        label: "Forecast Bias",
        value: biasLabel,
        hint: weatherImpact.biasLabel,
      },
      {
        label: "Calibration",
        value: solarCalibration ? `${Math.round(solarCalibration.factor * 100)}%` : "—",
        hint: solarCalibration ? solarCalibration.label : "Awaiting actuals",
      },
      {
        label: "Hourly Fit",
        value: hourlyFitLabel,
        hint: weatherImpact.hourlyFitLabel,
      },
      {
        label: "Forecast Confidence",
        value: weatherImpact.confidenceLabel,
        hint: solarForecastMetrics ? `Coverage ${(solarForecastMetrics.coverage * 100).toFixed(0)}%` : "Awaiting data",
      },
      {
        label: "Daylight Coverage",
        value: daylightCoverageLabel,
        hint: weatherImpact.sampleCount ? `${weatherImpact.sampleCount} samples` : "Awaiting feed-in",
      },
    ];
  }, [weatherSummary, solarForecastMetrics, weatherImpact, solarCalibration]);

  const solarVerdict = useMemo(() => {
    if (weatherImpact.impactScore === null) {
      return {
        conclusion: "Solar forecast pending.",
        hint: "Load weather + feed-in data to score accuracy.",
        drivers: ["Weather feed", "Solar actuals", "Forecast model"],
      };
    }
    const coverageLabel =
      weatherImpact.daylightCoverage === null
        ? "Coverage —"
        : `Coverage ${Math.round(weatherImpact.daylightCoverage * 100)}%`;
    const latestLabel = latestSolarDay
      ? `Latest day ${latestSolarDay.simulatedKwh.toFixed(1)} kWh`
      : "Latest day —";
    const latestHint =
      latestSolarDay?.actualKwh !== null && latestSolarDay?.actualKwh !== undefined
        ? `Actual ${latestSolarDay.actualKwh.toFixed(1)} kWh`
        : "Actuals pending";
    return {
      conclusion: `${weatherImpact.impactSummary} · ${weatherImpact.reliabilityLabel}.`,
      hint: `${weatherImpact.forecastQualityLabel} · ${weatherImpact.solarLossLabel}`,
      drivers: [
        weatherImpact.impactNote,
        weatherImpact.forecastQualityNote,
        `${weatherImpact.trackingLabel} · ${weatherImpact.trackingNote}`,
        weatherImpact.signalStrengthLabel,
        solarCalibration ? `Calibration ${solarCalibration.label}` : "Calibration —",
        weatherImpact.hourlyFitLabel,
        coverageLabel,
        latestLabel,
        latestHint,
      ],
    };
  }, [weatherImpact, latestSolarDay, solarCalibration]);

  const monitorInsights = useMemo(() => {
    const liveBuy = monitorPriceStats.liveBuy;
    const liveSell = monitorPriceStats.liveSell;
    const spread = monitorPriceStats.spread;
    const forecastBuy = monitorForecast?.buyMedian ?? null;
    const forecastSell = monitorForecast?.sellMedian ?? null;
    const forecastSpread = monitorForecast?.spread ?? null;
    const buySignal = liveBuy !== null && liveBuy <= config.buyThreshold;
    const sellSignal = liveSell !== null && liveSell >= config.sellThreshold;
    let priceConclusion = "Load current prices to classify the regime.";
    let priceHint = "Awaiting live prices.";
    let priceTag = "Awaiting prices";
    let priceNextStep = "Load current prices to unlock guidance.";
    if (liveBuy !== null || liveSell !== null) {
      if (buySignal && !sellSignal) {
        priceTag = "Charge window";
        priceConclusion = "Buy zone forming on current pricing.";
        priceNextStep = "Charge on the next low slot.";
      } else if (sellSignal && !buySignal) {
        priceTag = "Discharge window";
        priceConclusion = "Sell zone forming with strong spread.";
        priceNextStep = "Discharge into the next peak.";
      } else if (sellSignal && buySignal) {
        priceTag = "Mixed trigger";
        priceConclusion = "Both thresholds triggered — verify spread.";
        priceNextStep = "Hold until spread widens.";
      } else if (forecastSpread !== null && forecastSpread >= 12) {
        priceTag = "Volatile window";
        priceConclusion = "Volatile window — wait for a cleaner edge.";
        priceNextStep = "Wait for volatility to settle.";
      } else if (forecastBuy !== null && liveBuy !== null && liveBuy < forecastBuy * 0.92) {
        priceTag = "Charge window";
        priceConclusion = "Live buy under forecast median — charge window.";
        priceNextStep = "Charge while buy stays below median.";
      } else if (forecastSell !== null && liveSell !== null && liveSell > forecastSell * 1.08) {
        priceTag = "Discharge window";
        priceConclusion = "Live sell above forecast median — discharge window.";
        priceNextStep = "Discharge while sell holds above median.";
      } else if (spread !== null && spread >= 10) {
        priceTag = "Wide spread";
        priceConclusion = "Wide spread favors discharge over charge.";
        priceNextStep = "Favor discharge if SOC allows.";
      } else {
        priceTag = "Hold zone";
        priceConclusion = "Spread tight — hold unless forecast shifts.";
        priceNextStep = "Hold and watch the next window.";
      }
      priceHint =
        monitorPriceStats.buyTrend > 0.2
          ? "Buy prices drifting upward."
          : monitorPriceStats.buyTrend < -0.2
            ? "Buy prices easing lower."
            : "Buy prices stable.";
    }
    const spreadStrength = spread !== null ? clampNumber(spread / 15, 0, 1) : 0;
    const forecastSpreadStrength =
      forecastSpread !== null ? clampNumber(forecastSpread / 15, 0, 1) : 0;
    const opportunityScore = clampNumber(
      0.4 * spreadStrength + 0.35 * forecastSpreadStrength + 0.25 * monitorPriceStats.regimeScore,
      0,
      1,
    );
    const forecastStability =
      forecastSpread !== null ? clampNumber(1 - forecastSpread / 28, 0.2, 1) : 0.35;
    const priceConfidenceScore = clampNumber(
      0.45 * opportunityScore + 0.55 * forecastStability,
      0,
      1,
    );
    const priceConfidenceLabel =
      priceConfidenceScore >= 0.7
        ? "High confidence"
        : priceConfidenceScore >= 0.45
          ? "Medium confidence"
          : "Low confidence";
    const priceConfidenceHint =
      forecastSpread !== null
        ? `Forecast spread ${forecastSpread.toFixed(1)}c`
        : "Forecast pending";
    const opportunityLabel =
      opportunityScore >= 0.7 ? "High edge" : opportunityScore >= 0.45 ? "Moderate edge" : "Low edge";
    const opportunityHint =
      spread !== null
        ? `Spread ${spread.toFixed(1)}c · Forecast ${forecastSpread === null ? "—" : `${forecastSpread.toFixed(1)}c`}`
        : "Awaiting spread signal";
    const edgeSummary = `Edge ${Math.round(opportunityScore * 100)}% · ${opportunityLabel}`;
    if (liveBuy !== null || liveSell !== null) {
      priceHint = `${priceHint} ${edgeSummary}`;
    }
    const priceDrivers = [
      spread === null ? "Spread —" : `Spread ${spread.toFixed(1)}c`,
      forecastSpread === null ? "Forecast spread —" : `Forecast spread ${forecastSpread.toFixed(1)}c`,
      forecastBuy === null ? "Forecast buy —" : `Forecast buy ${forecastBuy.toFixed(1)}c`,
      forecastSell === null ? "Forecast sell —" : `Forecast sell ${forecastSell.toFixed(1)}c`,
      `Buy trend ${monitorPriceStats.buyTrend >= 0 ? "+" : ""}${monitorPriceStats.buyTrend.toFixed(1)}c`,
      `Buy vol ${monitorPriceStats.buyVol.toFixed(1)}c`,
      `Sell vol ${monitorPriceStats.sellVol.toFixed(1)}c`,
    ];
    const priceRisk = monitorPriceStats.riskLabel;
    const priceRiskHint = monitorPriceStats.momentumLabel;

    let strategyConclusion = "Run a backtest to score the active strategy.";
    let strategyHint = "No diagnostics yet.";
    let strategyTag = "Awaiting backtest";
    let strategyNextStep = "Run a backtest to unlock guidance.";
    let strategyRisk = "Risk pending";
    let strategyRiskHint = "Run a backtest to score risk posture.";
    if (activeDiagnostics) {
      strategyConclusion =
        baselineEdge !== null && baselineEdge >= 0
          ? "Active strategy is beating baseline."
          : "Active strategy is trailing baseline.";
      strategyHint = `${(activeDiagnostics.winRateValue * 100).toFixed(1)}% win rate · ${activeDiagnostics.days} days`;
      strategyTag = baselineEdge !== null && baselineEdge >= 0 ? "Beating baseline" : "Trailing baseline";
      if (healthStatus?.className === "warn") {
        strategyRisk = "Risk elevated";
        strategyRiskHint = healthStatus.detail || "Diagnostics flag elevated risk.";
      } else if (baselineEdge !== null && baselineEdge < 0) {
        strategyRisk = "Risk elevated";
        strategyRiskHint = "Trailing baseline performance.";
      } else {
        strategyRisk = "Risk stable";
        strategyRiskHint = "Edge positive with stable quality.";
      }
      if (baselineEdge !== null && baselineEdge < 0) {
        strategyNextStep = "Retune thresholds before scaling.";
      } else if (healthStatus?.className === "warn") {
        strategyNextStep = "Reduce risk exposure and tighten limits.";
      } else if (activeDiagnostics.qualityScore < 65) {
        strategyNextStep = "Tighten signal quality.";
      } else {
        strategyNextStep = "Scale cautiously with guardrails.";
      }
    }
    const strategyConfidenceScore = activeDiagnostics
      ? clampNumber(
          0.5 * (activeDiagnostics.qualityScore / 100) +
            0.3 * activeDiagnostics.coveragePct +
            0.2 * Math.min(1, activeDiagnostics.days / 7),
          0,
          1,
        )
      : null;
    const strategyConfidenceLabel =
      strategyConfidenceScore === null
        ? "Confidence pending"
        : strategyConfidenceScore >= 0.7
          ? "High confidence"
          : strategyConfidenceScore >= 0.45
            ? "Medium confidence"
            : "Low confidence";
    const strategyConfidenceHint = activeDiagnostics
      ? `Quality ${activeDiagnostics.qualityScore}/100 · Coverage ${Math.round(
          activeDiagnostics.coveragePct * 100,
        )}%`
      : "Run a backtest to score confidence.";
    const strategyDrivers = [
      `Win rate ${activeDiagnostics ? (activeDiagnostics.winRateValue * 100).toFixed(1) : "—"}%`,
      `Avg daily ${activeDiagnostics ? formatProfit(activeDiagnostics.avgDailyProfit) : "—"}`,
      `Quality ${activeDiagnostics ? `${activeDiagnostics.qualityScore}/100` : "—"}`,
      `Coverage ${activeDiagnostics ? `${Math.round(activeDiagnostics.coveragePct * 100)}%` : "—"}`,
      `Edge ${baselineEdge === null ? "—" : formatProfit(baselineEdge)}`,
    ];

    let rlConclusion = "Load current prices to score RL context.";
    let rlHint = "Policy output pending.";
    let rlNextStep = "Load current prices to unlock RL guidance.";
    let rlConfidence = "Confidence pending";
    let rlConfidenceHint = "Load current prices.";
    if (monitorRlSummary) {
      const spreadScore = monitorRlSummary.qSpread;
      const confidenceLabel =
        spreadScore >= 1 ? "High confidence" : spreadScore >= 0.4 ? "Medium confidence" : "Low confidence";
      const clarityLabel = monitorRlPulse[0]?.value ?? "Policy";
      rlConclusion = `Policy favors ${monitorRlSummary.action.toUpperCase()} with ${confidenceLabel}.`;
      rlHint = `${clarityLabel} · Expected return ${monitorRlSummary.expectedReturn.toFixed(2)}.`;
      rlConfidence = confidenceLabel;
      rlConfidenceHint = `Q spread ${monitorRlSummary.qSpread.toFixed(2)}`;
      rlNextStep =
        spreadScore < 0.35
          ? "Hold until policy clarity improves."
          : monitorRlSummary.action === "charge"
            ? "Charge if SOC headroom allows."
            : monitorRlSummary.action === "discharge"
              ? "Discharge into current peak."
              : "Hold and wait for edge.";
    }
    const rlDrivers = [
      `Action ${monitorRlSummary ? monitorRlSummary.action.toUpperCase() : "—"}`,
      `Q spread ${monitorRlSummary ? monitorRlSummary.qSpread.toFixed(2) : "—"}`,
      `Immediate reward ${monitorRlSummary ? monitorRlSummary.reward.toFixed(2) : "—"}`,
    ];

    let weatherConclusion = "Weather feed pending.";
    let weatherHint = "Awaiting forecast diagnostics.";
    let weatherTag = "Awaiting weather";
    let weatherNextStep = "Load weather feed to unlock forecast guidance.";
    let weatherConfidence = "Forecast pending";
    let weatherConfidenceHint = "Awaiting solar samples.";
    if (weatherImpact.impactScore !== null) {
      const reliabilityScore = weatherImpact.reliabilityScore ?? weatherImpact.forecastQualityScore;
      const forecastWeak = reliabilityScore !== null && reliabilityScore < 0.45;
      const forecastStrong = reliabilityScore !== null && reliabilityScore >= 0.7;
      const impactStrong = weatherImpact.impactScore >= 0.6;
      const impactModerate = weatherImpact.impactScore >= 0.35;
      weatherTag = weatherImpact.impactSummary;
      weatherConclusion = impactStrong
        ? "Cloud drag likely to reduce solar output."
        : impactModerate
          ? "Moderate cloud impact — solar output may dip."
          : "Low cloud impact — solar outlook steady.";
      weatherHint = `${weatherImpact.impactNote} · ${weatherImpact.reliabilityLabel}`;
      weatherConfidence = weatherImpact.confidenceLabel;
      weatherConfidenceHint = `${weatherImpact.forecastQualityLabel} · ${weatherImpact.hourlyFitLabel}`;
      if (forecastWeak) {
        weatherNextStep = "Downweight solar forecast and track actuals.";
      } else if (impactStrong && forecastStrong) {
        weatherNextStep = "Plan for reduced solar in the next window.";
      } else if (impactStrong) {
        weatherNextStep = "Plan for cloud impact; validate with live feed.";
      } else {
        weatherNextStep = "Solar outlook steady — use the forecast.";
      }
    }
    const weatherDrivers = [
      `Impact ${weatherImpact.impactSummary}`,
      `Outlook ${weatherImpact.solarOutlookLabel}`,
      `Clear-sky ${weatherImpact.clearSkyLabel}`,
      `Forecast ${weatherImpact.forecastQualityLabel}`,
      `Bias ${weatherImpact.biasLabel}`,
      `Tracking ${weatherImpact.trackingLabel}`,
      `Recent bias ${weatherImpact.recentBiasLabel}`,
      `Reliability ${weatherImpact.reliabilityLabel}`,
      `Calibration ${solarCalibration ? solarCalibration.label : "—"}`,
      `Diurnal fit ${weatherImpact.hourlyFitLabel}`,
      `Signal ${weatherImpact.signalStrengthLabel}`,
      `Ramp ${weatherImpact.rampLabel}`,
      `Clear window ${weatherImpact.clearHours ? `${weatherImpact.clearHours} hrs` : "—"}`,
      `Solar loss ${weatherImpact.solarLossLabel}`,
      `Coverage ${weatherImpact.daylightCoverage === null ? "—" : `${Math.round(weatherImpact.daylightCoverage * 100)}%`}`,
      `MAE ${solarForecastMetrics ? `${solarForecastMetrics.mae.toFixed(2)} kW` : "—"}`,
      `MAPE ${solarForecastMetrics ? `${Math.round(solarForecastMetrics.mape * 100)}%` : "—"}`,
      `R² ${solarForecastMetrics?.r2 === null || solarForecastMetrics?.r2 === undefined ? "—" : solarForecastMetrics.r2.toFixed(2)}`,
    ];

    const overview = {
      action: monitorDecision ? monitorDecision.action.toUpperCase() : "HOLD",
      confidence: monitorDecision ? `${(monitorDecision.confidence * 100).toFixed(0)}%` : "—",
      price: priceTag,
      strategy: strategyTag,
      weather: weatherTag,
      nextStep: monitorDecision ? `Next: ${priceNextStep}` : "Next: Load current prices",
    };

    return {
      priceConclusion,
      priceHint,
      priceTag,
      priceNextStep,
      priceOpportunity: { label: opportunityLabel, hint: opportunityHint, score: opportunityScore },
      priceConfidenceLabel,
      priceConfidenceHint,
      priceDrivers,
      strategyConclusion,
      strategyHint,
      strategyTag,
      strategyNextStep,
      strategyConfidenceLabel,
      strategyConfidenceHint,
      strategyDrivers,
      rlConclusion,
      rlHint,
      rlNextStep,
      rlDrivers,
      weatherConclusion,
      weatherHint,
      weatherTag,
      weatherNextStep,
      weatherDrivers,
      weatherConfidence,
      weatherConfidenceHint,
      overview,
      priceRisk,
      priceRiskHint,
      strategyRisk,
      strategyRiskHint,
      rlConfidence,
      rlConfidenceHint,
    };
  }, [
    activeDiagnostics,
    baselineEdge,
    config.buyThreshold,
    config.sellThreshold,
    healthStatus?.className,
    healthStatus?.detail,
    monitorDecision,
    monitorPriceStats,
    monitorForecast,
    monitorRlSummary,
    monitorRlPulse,
    solarForecastMetrics,
    solarCalibration,
    weatherImpact,
  ]);

  const monitorPricePulse = useMemo(() => {
    const spreadLabel =
      monitorPriceStats.spread !== null
        ? `${monitorPriceStats.spread.toFixed(1)}c spread`
        : "Spread pending";
    const liveHint =
      monitorPriceStats.liveBuy !== null && monitorPriceStats.liveSell !== null
        ? `Buy ${monitorPriceStats.liveBuy.toFixed(1)}c · Sell ${monitorPriceStats.liveSell.toFixed(1)}c`
        : "Awaiting live price";
    return [
      {
        label: "Edge Score",
        value: `${Math.round(monitorInsights.priceOpportunity.score * 100)}%`,
        hint: monitorInsights.priceOpportunity.label,
      },
      {
        label: "Regime",
        value: monitorPriceStats.regimeLabel,
        hint: monitorPriceStats.riskLabel,
      },
      {
        label: "Spread",
        value: monitorPriceStats.spread !== null ? `${monitorPriceStats.spread.toFixed(1)}c` : "—",
        hint: `Forecast ${monitorForecast?.spread === null || monitorForecast?.spread === undefined ? "—" : `${monitorForecast.spread.toFixed(1)}c`} · ${spreadLabel}`,
      },
      {
        label: "Signal Bias",
        value: monitorDecision ? monitorDecision.action.toUpperCase() : "WAIT",
        hint: liveHint,
      },
      {
        label: "Next Window",
        value: monitorPriceWindow ? `Buy ${monitorPriceWindow.buyLabel}` : "—",
        hint: monitorPriceWindow
          ? `Sell ${monitorPriceWindow.sellLabel} · Δ${monitorPriceWindow.spread.toFixed(1)}c`
          : "Awaiting forecast window",
      },
    ];
  }, [
    monitorPriceStats,
    monitorDecision,
    monitorInsights.priceOpportunity,
    monitorForecast,
    monitorPriceWindow,
  ]);

  const visiblePoints = useMemo(() => {
    if (!active?.points.length) return [];
    const start = Math.max(0, Math.min(windowStart, active.points.length - 1));
    const end = Math.min(active.points.length, start + windowSize);
    return active.points.slice(start, end);
  }, [active, windowStart, windowSize]);

  const sampledPoints = useMemo(() => {
    if (!visiblePoints.length) return [];
    return downsample(visiblePoints, maxPoints);
  }, [visiblePoints, maxPoints]);

  const ranges = useMemo(() => {
    if (!sampledPoints.length) return null;
    const buy = sampledPoints.map((p) => p.buy);
    const sell = sampledPoints.map((p) => p.sell);
    const soc = sampledPoints.map((p) => p.soc);
    const profit = sampledPoints.map((p) => p.cumulativeProfit);
    const baselineProfit = baseline
      ? downsample(baseline.points, maxPoints).map((p) => p.cumulativeProfit)
      : [];
    return {
      buy: rangeValues(buy),
      sell: rangeValues(sell),
      soc: rangeValues(soc),
      profit: rangeValues(profit),
      baseline: baselineProfit.length ? rangeValues(baselineProfit) : [0, 0],
    };
  }, [sampledPoints, baseline, maxPoints]);

  const distribution = useMemo(() => {
    if (!active?.points.length) return null;
    const buy = active.points.map((p) => p.buy);
    const sell = active.points.map((p) => p.sell);
    return { buy, sell };
  }, [active]);

  async function handleUpload(file: File) {
    setError(null);
    const text = await file.text();
    const json = JSON.parse(text);
    const data = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(data)) {
      throw new Error("Unsupported JSON payload shape.");
    }
    setPayload(data as RawInterval[]);
  }

  async function handleFetch() {
    setError(null);
    setStatus("Fetching Amber API...");
    setLoading((prev) => ({ ...prev, fetch: true }));
    try {
      const startDate = normalizeDateInput(range.start);
      const endDate = normalizeDateInput(range.end);
      if (!startDate || !endDate) {
        throw new Error("Start/End date required.");
      }
      const headers = buildAmberHeaders(token, anonKey);
      const params = {
        startDate,
        endDate,
        resolution: String(range.resolution),
        siteId,
      };
      const fallback = {
        siteId,
        previous: "96",
        next: "96",
        resolution: String(range.resolution),
      };
      const prices = await fetchPricesWithFallback(apiBase, params, fallback, headers);
      setApiSnapshots((prev) => ({ ...prev, prices: prices.json }));
      setPayload(prices.data as RawInterval[]);
      if (!prices.usedFallback) {
        try {
          const usage = await fetchUsage(apiBase, params, headers);
          setApiSnapshots((prev) => ({ ...prev, usage: usage.json }));
          setUsagePayload(usage.data as UsageInterval[]);
        } catch {
          setUsagePayload(null);
        }
      } else {
        setUsagePayload(null);
      }
    } finally {
      setLoading((prev) => ({ ...prev, fetch: false }));
    }
  }

  async function handleCurrent() {
    setError(null);
    setLoading((prev) => ({ ...prev, current: true }));
    currentFetchAtRef.current = Date.now();
    try {
      const headers = buildAmberHeaders(token, anonKey);
      const [current5, current30] = await Promise.all([
        fetchCurrent(
          apiBase,
          {
            siteId,
            previous: "0",
            next: "288",
            resolution: "5",
          },
          headers,
        ),
        fetchCurrent(
          apiBase,
          {
            siteId,
            previous: "0",
            next: "48",
            resolution: "30",
          },
          headers,
        ),
      ]);
      setApiSnapshots((prev) => ({
        ...prev,
        current: current5.json,
        current30: current30.json,
      }));
      setCurrentPrice(current5.data as RawInterval[]);
      setCurrentPrice30(current30.data as RawInterval[]);
    } finally {
      setLoading((prev) => ({ ...prev, current: false }));
    }
  }

  useEffect(() => {
    if (currentSummary?.timestamp) {
      setMonitorStatus(`Live prices updated ${formatTimestamp(currentSummary.timestamp)}`);
    }
  }, [currentSummary?.timestamp]);

  async function handleSendCommand() {
    setMonitorError(null);
    if (!monitorDecision) {
      setMonitorError("No decision available yet.");
      return;
    }
    if (!apiBase) {
      setMonitorError("Missing API base.");
      return;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
    setMonitorStatus("Sending command...");
    try {
      const resp = await fetch(apiPath("/device/command"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: monitorDecision.action,
          powerKw: monitorDecision.powerKw,
          targetSoc: null,
          reason: monitorDecision.reasons.join(" "),
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text);
      }
      const json = await resp.json();
      setLastCommand(JSON.stringify(json));
      setMonitorStatus(`Command sent: ${monitorDecision.action.toUpperCase()}`);
    } catch (err) {
      setMonitorError(err instanceof Error ? err.message : "Command failed.");
      setMonitorStatus("Command failed.");
    }
  }

  async function handleLlmDecision() {
    setError(null);
    if (!llmConfig.enabled) {
      setError("Enable LLM decisioning first.");
      return;
    }
    if (!apiBase) {
      setError("Missing API base.");
      return;
    }
    const horizon = Math.max(1, Math.min(168, llmConfig.horizonHours));
    const series = (payload || currentPrice || []).slice(-horizon).map((item) => ({
      startTime: item.startTime,
      general: item.channelType === "general" ? item.perKwh : undefined,
      feedIn: item.channelType === "feedIn" ? item.perKwh : undefined,
    }));
    const samplingStep = horizon > 48 ? 2 : 1;
    const slotSource =
      payload && payload.length ? payload : currentPrice && currentPrice.length ? currentPrice : [];
    const hourlySlots = slotSource
      .filter((item) => {
        const t = new Date(item.startTime);
        return t.getMinutes() === 0 && t.getHours() % samplingStep === 0;
      })
      .map((item) => item.startTime)
      .slice(-Math.ceil(horizon / samplingStep));
    const prompt = {
      cadence: llmConfig.cadence,
      outputFormat: llmConfig.outputFormat,
      stateFeatures: ["price", "soc", "solar", "time"],
      config: {
        capacityKwh: config.capacityKwh,
        maxPowerKw: config.maxPowerKw,
        dailyChargeAud: config.dailyChargeAud,
      },
      hourlySlots,
      instructions:
        "Return one action per hourlySlots entry, in the same order. Note: hourlySlots may be every 2 hours if horizon is large.",
      recentPrices: series,
    };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
    setLlmLoading(true);
    try {
      const resp = await fetch(apiPath("/llm"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: llmConfig.model,
          messages: [
            {
              role: "system",
              content:
                "You are an energy trading assistant. Return ONLY valid JSON matching the requested output format.",
            },
            {
              role: "user",
              content: JSON.stringify(prompt),
            },
          ],
          temperature: 0.2,
          max_tokens: llmConfig.maxTokens,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM error ${resp.status}: ${text}`);
      }
      const json = await resp.json();
      setLlmResponse(JSON.stringify(json, null, 2));
    } finally {
      setLlmLoading(false);
    }
  }

  async function handleSites() {
    setError(null);
    const json = await fetchSites(apiBase, anonKey);
    setApiSnapshots((prev) => ({ ...prev, sites: json }));
  }

  async function handleLoadCache() {
    if (!selectedCache) return;
    setError(null);
    setLoading((prev) => ({ ...prev, cache: true }));
    try {
      const entry = [...localCaches, ...serverCaches].find(
        (item) => cacheId(item) === selectedCache,
      );
      if (!entry) throw new Error("Cache not found.");
      if (entry.source === "local") {
        const json = readLocalCacheData(entry.name);
        if (!json) throw new Error("Local cache missing.");
        if (entry.kind === "usage") {
          setApiSnapshots((prev) => ({ ...prev, usage: json }));
          setUsagePayload(json as UsageInterval[]);
        } else {
          setApiSnapshots((prev) => ({ ...prev, prices: json }));
          const data = Array.isArray(json) ? json : (json as any).data;
          setPayload(data as RawInterval[]);
        }
      } else {
        const json = await fetchCacheFile(apiBase, entry.name, anonKey);
        setApiSnapshots((prev) => ({ ...prev, prices: json }));
        const data = Array.isArray(json) ? json : (json as any).data;
        setPayload(data as RawInterval[]);
      }
    } finally {
      setLoading((prev) => ({ ...prev, cache: false }));
    }
  }

  const forecasts = useMemo(() => {
    if (!active?.points.length) return null;
    const buy = active.points.map((p) => p.buy);
    const sell = active.points.map((p) => p.sell);
    const profit = active.points.map((p) => p.cumulativeProfit);
    return {
      arima: {
        buy: arimaForecast(buy, 12),
        sell: arimaForecast(sell, 12),
        profit: arimaForecast(profit, 12),
      },
      prophet: {
        buy: prophetForecast(buy, 12, 48),
        sell: prophetForecast(sell, 12, 48),
        profit: prophetForecast(profit, 12, 48),
      },
    };
  }, [active]);

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isGithub = host.endsWith("github.io");
    if (isGithub) {
      return (
        <div className="page">
          <section className="panel">
            <h2>Access Notice</h2>
            <p className="subhead">
              This GitHub Pages address is not the primary access point.
            </p>
            {customDomain ? (
              <a className="primary-link" href={customDomain}>
                Continue to the secured site
              </a>
            ) : (
              <p className="hint">Please use the custom domain provided to you.</p>
            )}
          </section>
        </div>
      );
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Amber Battery Lab</p>
          <h1>
            Trade the grid.{" "}
            <span>Backtest Amber pricing with a bold, visual cockpit.</span>
          </h1>
          <p className="subhead">
            Upload cached pricing, pull new intervals through the proxy, and
            explore how your battery strategy behaves minute by minute.
          </p>
          <div className="hero-actions">
            <button
              className="ghost"
              onClick={() => handleLoadCache().catch((err) => setError(err.message))}
              disabled={loading.cache || !cacheList.length}
            >
              {loading.cache ? (
                <>
                  <span className="spinner" /> Loading...
                </>
              ) : (
                "Load Cache"
              )}
            </button>
            <button
              className="ghost"
              onClick={() => handleCurrent().catch((err) => setError(err.message))}
              disabled={loading.current}
            >
              {loading.current ? (
                <>
                  <span className="spinner" /> Loading...
                </>
              ) : (
                "Current Prices"
              )}
            </button>
            <button
              className="ghost"
              onClick={() => handleFetch().catch((err) => setError(err.message))}
              disabled={loading.fetch}
            >
              {loading.fetch ? (
                <>
                  <span className="spinner" /> Fetching...
                </>
              ) : (
                "Refresh Data"
              )}
            </button>
          </div>
        </div>
        <div className="status-card">
          <p className="mono">Status</p>
          <p>{status}</p>
          {error && <p className="error">{error}</p>}
          <div className="status-badges">
            {loading.fetch && <span className="badge">Fetching</span>}
            {loading.cache && <span className="badge">Cache</span>}
            {loading.current && <span className="badge">Current</span>}
            {loading.crunch && <span className="badge">Backtest</span>}
          </div>
          <div className="stats">
            <div>
              <span>Active Strategy</span>
              <strong>{active?.name || "—"}</strong>
            </div>
            <div>
              <span>Net Profit</span>
              <strong>{active ? formatProfit(active.summary.profit) : "$0.00"}</strong>
            </div>
            <div>
              <span>{baseline?.name ? `${baseline.name} Profit` : "Baseline Profit"}</span>
              <strong>{baseline ? formatProfit(baseline.summary.profit) : "$0.00"}</strong>
            </div>
            <div>
              <span>Interval P/L</span>
              <strong>
                {active?.points.length
                  ? (active.points[active.points.length - 1].cumulativeProfit / active.points.length).toFixed(2)
                  : "0.00"}
              </strong>
            </div>
            <div>
              <span>End SOC</span>
              <strong>{active?.summary.endSoc.toFixed(1) || "0.0"}</strong>
            </div>
          </div>
        </div>
      </header>

      <div className="tab-row">
        <button
          className={activeTab === "backtest" ? "tab active" : "tab"}
          onClick={() => setActiveTab("backtest")}
        >
          Backtest
        </button>
        <button
          className={activeTab === "monitor" ? "tab active" : "tab"}
          onClick={() => setActiveTab("monitor")}
        >
          Monitor
        </button>
      </div>

      {activeTab === "backtest" ? (
        <>
          <div className="backtest-nav-bar">
            <div className="backtest-nav-meta">
              <div className={`nav-meta-card ${backtestReadiness.dataLoaded ? "good" : "warn"}`}>
                <span className="mono">Status</span>
                <strong>{loading.crunch ? "Crunching backtest..." : status}</strong>
                <span className="hint">
                  {backtestReadiness.dataLoaded
                    ? `${backtestReadiness.intervalCount} intervals`
                    : backtestReadiness.dataNote}
                </span>
              </div>
              <div className="nav-meta-card neutral">
                <span className="mono">Window</span>
                <strong>
                  {range.start} → {range.end}
                </strong>
                <span className="hint">{range.resolution} min cadence</span>
              </div>
              <div className="nav-meta-card neutral">
                <span className="mono">Strategy</span>
                <strong>{active?.name || activeStrategy || "—"}</strong>
                <span className="hint">
                  {config.mode === "threshold" ? "Threshold" : "Percentile"} · {config.capacityKwh} kWh
                </span>
              </div>
            </div>
            <div className="backtest-nav-row">
              {backtestNav.map((item) => (
                <button
                  key={item.id}
                  className="ghost small"
                  onClick={() => scrollToSection(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <section className="panel backtest-briefing-lite" id="backtest-brief">
            <div className="panel-header">
              <h2>Backtest Executive Brief</h2>
              <p className="hint">Simple conclusion first, click to inspect logic.</p>
            </div>
            <div className={`brief-card ${backtestBrief.tone}`}>
              <div>
                <span className="mono">Conclusion</span>
                <strong>{backtestBrief.headline}</strong>
                <span className="hint">{backtestBrief.subhead}</span>
              </div>
            </div>
            <div className="brief-grid">
              {backtestBrief.cards.map((card) => (
                <div key={card.label} className="brief-metric">
                  <span className="mono">{card.label}</span>
                  <strong>{card.value}</strong>
                  <span className="hint">{card.hint}</span>
                </div>
              ))}
            </div>
            <details className="insight-details">
              <summary>View logic</summary>
              <div className="insight-details-grid">
                {backtestBrief.drivers.map((driver) => (
                  <div key={driver} className="insight-chip">
                    {driver}
                  </div>
                ))}
              </div>
            </details>
          </section>
          <section className="panel backtest-verdict" id="backtest-verdict">
            <div className="panel-header">
              <h2>Backtest Verdict</h2>
              <p className="hint">One-line conclusion, with click-through logic.</p>
            </div>
            <div className={`verdict-card ${backtestVerdict.tone}`}>
              <div>
                <span className="mono">Conclusion</span>
                <strong>{backtestVerdict.headline}</strong>
                <span className="hint">{backtestVerdict.subhead}</span>
              </div>
              <div className="verdict-next">
                <span className="mono">Next Move</span>
                <strong>{backtestVerdict.nextMove}</strong>
              </div>
            </div>
            <details className="insight-details">
              <summary>View logic</summary>
              <div className="insight-details-grid">
                {backtestVerdict.drivers.map((driver) => (
                  <div key={driver} className="insight-chip">
                    {driver}
                  </div>
                ))}
              </div>
            </details>
          </section>
          <section className="panel backtest-summary" id="backtest-summary">
            <div className="panel-header">
              <h2>Backtest Summary Deck</h2>
              <p className="hint">Readiness, risk posture, and next actions in one cockpit.</p>
            </div>
            <div className="summary-hero">
              <div className={`summary-score ${backtestSummary.launch?.tone || backtestSummary.readinessTone}`}>
                <span className="mono">Launch Status</span>
                <strong>{backtestSummary.launch?.label || "Awaiting run"}</strong>
                <p>{backtestSummary.launch?.detail || "Run a backtest to score launch readiness."}</p>
                <div className="summary-meter">
                  <div
                    className="summary-meter-fill"
                    style={{ width: `${backtestSummary.readinessScore ?? 0}%` }}
                  />
                </div>
                <div className="summary-score-meta">
                  <span className="mono">Readiness Score</span>
                  <strong>{backtestSummary.readinessLabel}</strong>
                </div>
              </div>
              <div className="summary-metric-grid">
                <div className={`summary-metric ${backtestSummary.readinessTone}`}>
                  <span className="mono">Readiness</span>
                  <strong>{backtestSummary.readinessLabel}</strong>
                  <span className="hint">
                    {executiveBrief?.cards[0]?.note || "Backtest readiness pending."}
                  </span>
                </div>
                <div className={`summary-metric ${backtestSummary.edgeTone}`}>
                  <span className="mono">Edge vs Baseline</span>
                  <strong>{backtestSummary.edgeLabel}</strong>
                  <span className="hint">{baseline?.name || "Baseline comparison"}</span>
                </div>
                <div className={`summary-metric ${backtestSummary.coverageTone}`}>
                  <span className="mono">Coverage</span>
                  <strong>
                    {backtestSummary.coveragePct === null
                      ? "—"
                      : `${backtestSummary.coveragePct.toFixed(1)}%`}
                  </strong>
                  <span className="hint">
                    {activeDiagnostics ? `${activeDiagnostics.missingIntervals} gaps` : "Load data to evaluate"}
                  </span>
                </div>
                <div className="summary-metric neutral">
                  <span className="mono">Risk Score</span>
                  <strong>
                    {backtestSummary.riskScore === null || backtestSummary.riskScore === undefined
                      ? "—"
                      : backtestSummary.riskScore.toFixed(0)}
                  </strong>
                  <span className="hint">{backtestSummary.riskLabel}</span>
                </div>
                <div className="summary-metric neutral">
                  <span className="mono">Stability</span>
                  <strong>
                    {backtestSummary.stabilityIndex === null ||
                    backtestSummary.stabilityIndex === undefined
                      ? "—"
                      : backtestSummary.stabilityIndex.toFixed(0)}
                  </strong>
                  <span className="hint">Daily profit consistency</span>
                </div>
                <div className="summary-metric neutral">
                  <span className="mono">Cadence</span>
                  <strong>{backtestSummary.cadenceLabel}</strong>
                  <span className="hint">Window resolution</span>
                </div>
              </div>
              <div className="summary-next">
                <span className="mono">Next Moves</span>
                <div className="summary-next-list">
                  {backtestSummary.nextMoves.map((move) => (
                    <div key={move} className="summary-next-item">
                      {move}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <section className="panel backtest-hud" id="backtest-hud">
            <div className="panel-header">
              <div>
                <h2>Backtest Command HUD</h2>
                <p className="hint">
                  Quick status, key metrics, and direct actions for the active window.
                </p>
              </div>
              <div className="hud-actions">
                <button
                  className="ghost small"
                  onClick={() => handleLoadCache().catch((err) => setError(err.message))}
                  disabled={loading.cache || !cacheList.length}
                >
                  Load Cache
                </button>
                <button
                  className="ghost small"
                  onClick={() => handleFetch().catch((err) => setError(err.message))}
                  disabled={loading.fetch}
                >
                  Refresh Data
                </button>
                <button
                  className="ghost small"
                  onClick={() => handleCurrent().catch((err) => setError(err.message))}
                  disabled={loading.current}
                >
                  Current Prices
                </button>
                <button
                  className="ghost small"
                  onClick={() => scrollToSection("backtest-settings")}
                >
                  Tune Strategy
                </button>
              </div>
            </div>
            <div className="hud-status">
              <div className={`hud-state ${backtestReadiness.dataLoaded ? "good" : "warn"}`}>
                <span className="mono">Run Status</span>
                <strong>{backtestHud.status}</strong>
                <span className="hint">
                  {backtestReadiness.dataLoaded
                    ? `${backtestReadiness.intervalCount} intervals loaded`
                    : backtestReadiness.dataNote}
                </span>
              </div>
              <div className={`hud-state ${healthStatus?.className || "neutral"}`}>
                <span className="mono">Health</span>
                <strong>{healthStatus?.label || "Awaiting scan"}</strong>
                <span className="hint">{healthStatus?.detail || "Run a backtest to score health."}</span>
              </div>
              <div className="hud-state neutral">
                <span className="mono">Window</span>
                <strong>
                  {range.start} → {range.end}
                </strong>
                <span className="hint">{range.resolution} min cadence</span>
              </div>
            </div>
            <div className="hud-grid">
              {backtestHud.cards.map((card) => (
                <div key={card.label} className={`hud-card ${card.tone}`}>
                  <span className="mono">{card.label}</span>
                  <strong>{card.value}</strong>
                  <span className="hint">{card.hint}</span>
                </div>
              ))}
            </div>
            <div className="hud-footer">
              <div className="hud-next">
                <span className="mono">Next Move</span>
                <strong>{backtestHud.nextMove}</strong>
                <span className="hint">
                  {backtestReadiness.dataLoaded
                    ? "Iterate thresholds, then compare against the baseline."
                    : "Load pricing + usage to unlock tuning guidance."}
                </span>
                <div className="hud-tags">
                  {backtestReadiness.chipItems.map((chip) => (
                    <span key={chip} className="hud-tag">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
              <div className="hud-nav">
                <span className="mono">Jump to</span>
                <div className="hud-nav-row">
                  {backtestNav.map((item) => (
                    <button
                      key={item.id}
                      className="ghost small"
                      onClick={() => scrollToSection(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <section className="panel backtest-pulse" id="backtest-pulse">
            <div className="panel-header">
              <h2>Backtest Focus Strip</h2>
              <p className="hint">Scan the run health, edge, and coverage in one glance.</p>
            </div>
            <div className="insight-row">
              <div className="insight-copy">
                <span className="mono">Conclusion</span>
                <strong>{backtestFocus.headline}</strong>
                <span className="hint">{backtestFocus.subhead}</span>
                <span className="hint">Next: {backtestFocus.nextMove}</span>
              </div>
              <details className="insight-details">
                <summary>View highlights</summary>
                <div className="insight-details-grid">
                  {backtestFocus.highlights.map((item) => (
                    <div key={item} className="insight-chip">
                      {item}
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <div className="decision-strip">
              <div className="decision-card">
                <span className="mono">Readiness</span>
                <strong>{backtestSummary.readinessLabel}</strong>
                <span className="hint">{backtestSummary.launch?.detail || "Run a backtest to score readiness."}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Edge vs Baseline</span>
                <strong>{backtestSummary.edgeLabel}</strong>
                <span className="hint">{backtestSummary.riskLabel}</span>
              </div>
            </div>
            <div className="pulse-grid">
              {backtestPulse.cards.map((card) => (
                <div key={card.label} className={`pulse-card ${card.tone}`}>
                  <span className="mono">{card.label}</span>
                  <strong>{card.value}</strong>
                  <span className="hint">{card.hint}</span>
                </div>
              ))}
            </div>
            <div className="pulse-rail">
              {backtestPulse.rail.map((item) => (
                <div key={item.label} className={`pulse-rail-item ${item.tone}`}>
                  <span className="mono">{item.label}</span>
                  <strong>{item.value}</strong>
                  <span className="hint">{item.hint}</span>
                </div>
              ))}
            </div>
          </section>
          <details className="panel-details deep-dive">
            <summary>Open Deep Dives</summary>
            <div className="panel-details-body">
              <section className="panel signal-brief" id="backtest-briefing">
            <div className="panel-header">
              <h2>Backtest Signal Brief</h2>
              <p className="hint">Readiness, risk, consistency, and opportunity in one scan.</p>
            </div>
            <div className="signal-brief-summary">
              <div className="signal-summary">
                <span className="mono">Signal Status</span>
                <strong>{backtestSignalBrief.status}</strong>
                <span className="hint">{backtestSignalBrief.summary}</span>
              </div>
              <div className="signal-tags">
                {backtestSignalBrief.tags.map((tag) => (
                  <span key={tag} className="signal-tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="signal-brief-grid">
              {backtestSignalBrief.cards.map((card) => (
                <div key={card.label} className={`signal-brief-card ${card.tone}`}>
                  <span className="mono">{card.label}</span>
                  <strong>{card.value}</strong>
                  <span className="hint">{card.hint}</span>
                </div>
              ))}
            </div>
            <div className="signal-action-grid">
              {backtestSignalBrief.actions.map((action, idx) => (
                <div key={action.title} className={`signal-action ${action.tone}`}>
                  <span className="mono">Action {idx + 1}</span>
                  <strong>{action.title}</strong>
                  <span className="hint">{action.detail}</span>
                </div>
              ))}
            </div>
            <div className="signal-highlights">
              <span className="mono">Signal Highlights</span>
              <div className="signal-highlight-grid">
                {backtestSignalBrief.highlights.map((item, idx) => (
                  <div key={`${item}-${idx}`} className="signal-highlight">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>
              <section className="panel backtest-brief" id="backtest-mission">
            <div className="panel-header">
              <h2>Backtest Mission Control</h2>
              <p className="hint">Align data, strategy, and performance in one cockpit view.</p>
            </div>
            <div className="backtest-brief-grid">
              <div
                className={`backtest-brief-card ${backtestReadiness.dataLoaded ? "good" : "warn"}`}
              >
                <span className="mono">Data Readiness</span>
                <strong>{backtestReadiness.dataLoaded ? "Loaded" : "Missing"}</strong>
                <span className="hint">{backtestReadiness.dataNote}</span>
                <span className="hint">{backtestReadiness.usageNote}</span>
              </div>
              <div className="backtest-brief-card neutral">
                <span className="mono">Strategy Profile</span>
                <strong>{config.mode === "threshold" ? "Threshold" : "Percentile"}</strong>
                <span className="hint">{backtestReadiness.strategySummary}</span>
                <span className="hint">
                  Battery {config.capacityKwh} kWh · {config.maxPowerKw} kW max
                </span>
              </div>
              <div
                className={`backtest-brief-card ${activeDiagnostics ? "good" : "neutral"}`}
              >
                <span className="mono">Performance Pulse</span>
                <strong>{backtestReadiness.performanceLabel}</strong>
                <span className="hint">{backtestReadiness.performanceNote}</span>
                <span className="hint">{backtestReadiness.drawdownNote}</span>
              </div>
              <div
                className={`backtest-brief-card ${
                  activeDiagnostics ? (healthStatus?.className === "good" ? "good" : "warn") : "neutral"
                }`}
              >
                <span className="mono">Signal Quality</span>
                <strong>{backtestReadiness.qualityLabel}</strong>
                <span className="hint">{backtestReadiness.qualityNote}</span>
                <span className="hint">{backtestReadiness.healthNote}</span>
              </div>
            </div>
            <div className="chip-row">
              {backtestReadiness.chipItems.map((chip) => (
                <span key={chip} className="chip">
                  {chip}
                </span>
              ))}
            </div>
            <div className="backtest-track">
              <div
                className={`track-step ${backtestReadiness.dataLoaded ? "good" : "warn"}`}
              >
                <span className="mono">Step 1</span>
                <strong>Data Pipeline</strong>
                <span className="hint">{backtestReadiness.dataNote}</span>
                <span className="hint">{backtestReadiness.usageNote}</span>
              </div>
              <div className={`track-step ${active ? "good" : "neutral"}`}>
                <span className="mono">Step 2</span>
                <strong>Strategy Lock</strong>
                <span className="hint">{active?.name || "Select a strategy to continue."}</span>
                <span className="hint">
                  {config.mode === "threshold" ? "Threshold" : "Percentile"} ·{" "}
                  {config.capacityKwh} kWh
                </span>
              </div>
              <div
                className={`track-step ${
                  activeDiagnostics ? (baselineEdge !== null && baselineEdge >= 0 ? "good" : "warn") : "neutral"
                }`}
              >
                <span className="mono">Step 3</span>
                <strong>Performance</strong>
                <span className="hint">
                  {activeDiagnostics ? backtestReadiness.performanceNote : "Run a backtest to score performance."}
                </span>
                <span className="hint">
                  {baselineEdge !== null ? `Edge vs baseline: ${formatProfit(baselineEdge)}` : "Baseline edge pending."}
                </span>
              </div>
              <div
                className={`track-step ${healthStatus?.className || "neutral"}`}
              >
                <span className="mono">Step 4</span>
                <strong>Risk & Quality</strong>
                <span className="hint">{backtestReadiness.qualityNote}</span>
                <span className="hint">{healthStatus?.detail || "Awaiting diagnostic scan."}</span>
              </div>
            </div>
            <div className="backtest-meta">
              <div className="meta-card">
                <span className="mono">Status</span>
                <strong>{loading.crunch ? "Crunching backtest..." : status}</strong>
                <span className="hint">{payload?.length ? `${backtestReadiness.intervalCount} intervals loaded` : "Waiting for payload."}</span>
              </div>
              <div className="meta-card">
                <span className="mono">Date Window</span>
                <strong>
                  {range.start} → {range.end}
                </strong>
                <span className="hint">{range.resolution} min cadence</span>
              </div>
              <div className="meta-card">
                <span className="mono">Execution Mode</span>
                <strong>{llmConfig.enabled ? "LLM Assisted" : "Rule-driven"}</strong>
                <span className="hint">
                  {llmConfig.enabled
                    ? `${llmConfig.model} · ${llmConfig.cadence}`
                    : "Deterministic ruleset"}
                </span>
              </div>
            </div>
          </section>
              <section className="panel backtest-dock">
            <div className="panel-header">
              <h2>Backtest Ops Dock</h2>
              <p className="hint">Quick navigation + the single next improvement to prioritize.</p>
            </div>
            <div className="dock-grid">
              <div className="dock-main">
                <div
                  className={`dock-callout ${backtestDock.readiness?.tone || "neutral"}`}
                >
                  <span className="mono">Readiness</span>
                  <strong>{backtestDock.readiness?.value || "—"}</strong>
                  <span className="hint">
                    {backtestDock.readiness?.note || "Run a backtest to score readiness."}
                  </span>
                </div>
                <div className={`dock-callout ${backtestDock.risk?.tone || "neutral"}`}>
                  <span className="mono">Risk Posture</span>
                  <strong>{backtestDock.risk?.value || "—"}</strong>
                  <span className="hint">
                    {backtestDock.risk?.note || "Awaiting drawdown + profit signal."}
                  </span>
                </div>
                <div className="dock-next">
                  <span className="mono">Next Move</span>
                  <strong>
                    {backtestDock.nextMove || "Run a backtest to generate next moves."}
                  </strong>
                  <span className="hint">
                    {backtestReadiness.dataLoaded
                      ? "Iterate the active window, then re-run the leaderboard."
                      : "Load pricing + usage to unlock tuning guidance."}
                  </span>
                  <div className="dock-tags">
                    <span className={`dock-tag ${backtestReadiness.dataLoaded ? "good" : "warn"}`}>
                      Data
                    </span>
                    <span className={`dock-tag ${activeDiagnostics ? "good" : "neutral"}`}>
                      Backtest
                    </span>
                    <span className={`dock-tag ${healthStatus?.className || "neutral"}`}>
                      Health
                    </span>
                  </div>
                </div>
              </div>
              <div className="dock-cards">
                {backtestDock.cards.map((card) => (
                  <div key={card.label} className={`dock-card ${card.tone}`}>
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="dock-nav">
              <span className="mono">Jump to</span>
              <div className="dock-nav-row">
                {backtestNav.map((item) => (
                  <button
                    key={item.id}
                    className="ghost small"
                    onClick={() => scrollToSection(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
              <section className="panel runboard-panel" id="backtest-runboard">
            <div className="panel-header">
              <h2>Backtest Runboard</h2>
              <p className="hint">Executive-grade KPIs, coverage, and risk posture in one grid.</p>
            </div>
            {runboard ? (
              <>
                <div className="runboard-hero">
                  {runboard.cards.map((card) => (
                    <div key={card.label} className={`runboard-card ${card.tone}`}>
                      <span className="mono">{card.label}</span>
                      <strong>{card.value}</strong>
                      <span className="hint">{card.hint}</span>
                    </div>
                  ))}
                </div>
                <div className="runboard-bars">
                  {runboard.bars.map((bar) => (
                    <div key={bar.label} className={`runboard-bar ${bar.tone}`}>
                      <div className="runboard-bar-top">
                        <span className="mono">{bar.label}</span>
                        <strong>{bar.hint}</strong>
                      </div>
                      <div className="runboard-bar-track">
                        <div
                          className="runboard-bar-fill"
                          style={{ width: `${Math.max(0, Math.min(100, bar.value ?? 0))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="runboard-footer">
                  {runboard.pills.map((pill) => (
                    <span key={pill} className="runboard-pill">
                      {pill}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">Run a backtest to populate the runboard.</div>
            )}
          </section>
              <section className="panel backtest-atlas" id="backtest-atlas">
            <div className="panel-header">
              <h2>Backtest Insight Atlas</h2>
              <p className="hint">Performance vectors, risk envelope, and execution rhythm in one map.</p>
            </div>
            {backtestAtlas ? (
              <>
                <div className="atlas-grid">
                  {backtestAtlas.lanes.map((lane) => (
                    <div key={lane.title} className={`atlas-card ${lane.tone}`}>
                      <div className="atlas-card-head">
                        <span className="mono">{lane.title}</span>
                        <span className={`atlas-chip ${lane.tone}`}>{lane.status}</span>
                      </div>
                      <div className="atlas-metrics">
                        {lane.metrics.map((metric) => (
                          <div key={metric.label} className={`atlas-metric ${metric.tone}`}>
                            <span className="mono">{metric.label}</span>
                            <strong>{metric.value}</strong>
                            <span className="hint">{metric.hint}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="atlas-footer">
                  <span className="mono">Signal highlights</span>
                  <div className="atlas-signals">
                    {backtestAtlas.signals.length ? (
                      backtestAtlas.signals.map((signal, idx) => (
                        <div key={idx} className="atlas-signal">
                          {signal}
                        </div>
                      ))
                    ) : (
                      <div className="atlas-signal muted">Run a backtest to generate signals.</div>
                    )}
                  </div>
                  <div className="atlas-note">{backtestAtlas.footer}</div>
                </div>
              </>
            ) : (
              <div className="empty">Run a backtest to generate insight vectors.</div>
            )}
          </section>
              <section className="panel scenario-panel" id="backtest-scenarios">
            <div className="panel-header">
              <h2>Backtest Scenario Matrix</h2>
              <p className="hint">Stress-tested postures and the next tuning move.</p>
            </div>
            {backtestScenario ? (
              <>
                <div className="scenario-grid">
                  {backtestScenario.cards.map((card) => (
                    <div key={card.title} className={`scenario-card ${card.tone}`}>
                      <div className="scenario-head">
                        <span className="mono">{card.title}</span>
                        <span className={`scenario-score ${card.tone}`}>
                          {card.score.toFixed(0)}
                        </span>
                      </div>
                      <strong>{card.focus}</strong>
                      <div className="scenario-metrics">
                        {card.metrics.map((metric) => (
                          <div key={metric.label} className="scenario-metric">
                            <span className="mono">{metric.label}</span>
                            <strong>{metric.value}</strong>
                          </div>
                        ))}
                      </div>
                      <div className="scenario-action">
                        <span className="mono">Suggested Move</span>
                        <p>{card.action}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="scenario-footer">
                  <span className="mono">Scenario Insights</span>
                  <div className="scenario-insights">
                    {backtestScenario.insights.map((item) => (
                      <div key={item} className="scenario-insight">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty">Run a backtest to unlock scenario guidance.</div>
            )}
          </section>
              <section className="panel">
            <div className="panel-header">
              <h2>Amber Overview</h2>
              <p className="hint">Live pricing + usage summary</p>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <span className="mono">Live Buy</span>
                <strong>
                  {currentSummary?.general
                    ? formatAmberPrice(currentSummary.general.perKwh)
                    : "—"}
                </strong>
                <span>
                  {currentSummary?.general?.startTime
                    ? formatTimestamp(currentSummary.general.startTime)
                    : "—"}
                </span>
              </div>
              <div className="summary-card">
                <span className="mono">Live Sell</span>
                <strong>
                  {currentSummary?.feedIn
                    ? formatAmberPrice(currentSummary.feedIn.perKwh)
                    : "—"}
                </strong>
                <span>
                  {currentSummary?.feedIn?.startTime
                    ? formatTimestamp(currentSummary.feedIn.startTime)
                    : "—"}
                </span>
              </div>
              <div className="summary-card">
                <span className="mono">Usage Cost</span>
                <strong>
                  {usageSummary ? formatProfit(-usageSummary.costAud) : "—"}
                </strong>
                <span>{range.start} → {range.end}</span>
              </div>
              <div className="summary-card">
                <span className="mono">Total Usage</span>
                <strong>
                  {usageSummary ? `${usageSummary.usageKwh.toFixed(2)} kWh` : "—"}
                </strong>
                <span>General usage</span>
              </div>
              <div className="summary-card">
                <span className="mono">Solar Exports</span>
                <strong>
                  {usageSummary ? `${usageSummary.exportKwh.toFixed(2)} kWh` : "—"}
                </strong>
                <span>Feed-in total</span>
              </div>
              <div className="summary-card">
                <span className="mono">% Renewables</span>
                <strong>
                  {renewablesPct !== null
                    ? `${renewablesPct.toFixed(1)}%`
                    : "—"}
                </strong>
                <span>Weighted by kWh</span>
              </div>
            </div>
          </section>

              <section className="panel">
            <div className="panel-header">
              <h2>Current Market Snapshot</h2>
              <p className="hint">Buy and sell prices side-by-side</p>
            </div>
            {currentSummary ? (
              <div className="timeline-stack">
                <CurrentMarketTimeline title="Live 5-min" rows={currentPrice} tone="primary" />
                <CurrentMarketTimeline title="Live 30-min" rows={currentPrice30} tone="secondary" />
              </div>
            ) : (
              <div className="empty">Click “Current Prices” to load.</div>
            )}
          </section>

      <section className="panel command-panel" id="backtest-command">
        <div className="panel-header">
          <h2>Backtest Command Center</h2>
          <p className="hint">Signal confidence, data quality, and efficiency at a glance</p>
        </div>
        <div className="insight-row">
          <div className="insight-copy">
            <span className="mono">Conclusion</span>
            <strong>{healthStatus?.label || "Run a backtest to score health."}</strong>
            <span className="hint">{healthStatus?.detail || "Diagnostics will summarize signal health."}</span>
          </div>
          <details className="insight-details">
            <summary>Quick stats</summary>
            <div className="insight-details-grid">
              <div className="insight-chip">
                {activeDiagnostics ? `${activeDiagnostics.qualityScore}/100 quality` : "Quality —"}
              </div>
              <div className="insight-chip">
                {baselineEdge === null ? "Edge —" : `Edge ${formatProfit(baselineEdge)}`}
              </div>
              <div className="insight-chip">
                {activeDiagnostics ? `${activeDiagnostics.coveragePct * 100}% coverage` : "Coverage —"}
              </div>
            </div>
          </details>
        </div>
        <details className="panel-details">
          <summary>Show command center details</summary>
          <div className="panel-details-body">
            {activeDiagnostics ? (
          <div className="command-grid">
            <div className="command-block">
              <span className="mono">Performance Pulse</span>
              <div className="command-lead">{formatProfit(activeDiagnostics.profit)}</div>
              <div className="summary-grid">
                <div className="summary-card">
                  <span className="mono">Avg Daily</span>
                  <strong>{formatProfit(activeDiagnostics.avgDailyProfit)}</strong>
                  <span>{activeDiagnostics.days} days</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Win Rate</span>
                  <strong>{(activeDiagnostics.winRateValue * 100).toFixed(1)}%</strong>
                  <span>Interval wins</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Max Drawdown</span>
                  <strong>{formatProfit(-activeDiagnostics.drawdown)}</strong>
                  <span>Peak-to-trough</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Edge vs Baseline</span>
                  <strong
                    className={`delta ${
                      baselineEdge === null ? "" : baselineEdge >= 0 ? "pos" : "neg"
                    }`}
                  >
                    {baselineEdge !== null ? formatProfit(baselineEdge) : "—"}
                  </strong>
                  <span>{baseline?.name || "Baseline"}</span>
                </div>
              </div>
            </div>
            <div className="command-block">
              <span className="mono">Data Quality</span>
              <div className="score-card">
                <div className="score-top">
                  <strong>{`${activeDiagnostics.qualityScore}/100`}</strong>
                  <span
                    className={`delta ${activeDiagnostics.qualityScore >= 70 ? "pos" : "neg"}`}
                  >
                    {activeDiagnostics.qualityScore >= 70 ? "High confidence" : "Needs more depth"}
                  </span>
                </div>
                <div className="score-bar">
                  <div
                    className="score-fill"
                    style={{ width: `${activeDiagnostics.qualityScore}%` }}
                  />
                </div>
              </div>
              <div className="summary-grid">
                <div className="summary-card">
                  <span className="mono">Coverage</span>
                  <strong>{(activeDiagnostics.coveragePct * 100).toFixed(1)}%</strong>
                  <span>{activeDiagnostics.missingIntervals} missing</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Intervals</span>
                  <strong>{activeDiagnostics.intervalCount}</strong>
                  <span>{range.resolution} min</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Days</span>
                  <strong>{activeDiagnostics.days}</strong>
                  <span>{range.start} → {range.end}</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Health</span>
                  <strong className={`health ${healthStatus?.className || ""}`}>
                    {healthStatus?.label || "—"}
                  </strong>
                  <span>{healthStatus?.detail || "Load data to evaluate."}</span>
                </div>
              </div>
            </div>
            <div className="command-block">
              <span className="mono">Efficiency</span>
              <div className="summary-grid">
                <div className="summary-card">
                  <span className="mono">Profit / kWh</span>
                  <strong>
                    {efficiencyMetrics ? formatProfit(efficiencyMetrics.profitPerKwh) : "—"}
                  </strong>
                  <span>Across traded energy</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Throughput</span>
                  <strong>
                    {efficiencyMetrics ? `${efficiencyMetrics.throughput.toFixed(1)} kWh` : "—"}
                  </strong>
                  <span>Buy + sell</span>
                </div>
                <div className="summary-card">
                  <span className="mono">Cycles</span>
                  <strong>
                    {efficiencyMetrics ? efficiencyMetrics.cycles.toFixed(2) : "—"}
                  </strong>
                  <span>{config.capacityKwh} kWh battery</span>
                </div>
                <div className="summary-card">
                  <span className="mono">End SOC</span>
                  <strong>{active?.summary.endSoc.toFixed(1) || "0.0"}</strong>
                  <span>kWh remaining</span>
                </div>
              </div>
              {efficiencyMetrics?.utilization !== null ? (
                <div className="utilization">
                  <span className="mono">Utilization</span>
                  <div className="score-bar">
                    <div
                      className="score-fill"
                      style={{ width: `${(efficiencyMetrics.utilization ?? 0) * 100}%` }}
                    />
                  </div>
                  <span className="hint">
                    {((efficiencyMetrics.utilization ?? 0) * 100).toFixed(1)}% of theoretical
                  </span>
                </div>
              ) : null}
            </div>
            <div className="command-block wide">
              <span className="mono">Actionable Signals</span>
              <div className="insight-grid">
                <div className="insight-card">
                  <span className="mono">Backtest Health</span>
                  <strong className={`health ${healthStatus?.className || ""}`}>
                    {healthStatus?.label || "—"}
                  </strong>
                  <span>{healthStatus?.detail || "Load data to evaluate."}</span>
                </div>
                <div className="insight-card">
                  <span className="mono">Best Strategy</span>
                  <strong>{bestComparison || bestLeaderboard || "—"}</strong>
                  <span>Highest profit in this run</span>
                </div>
                <div className="insight-card">
                  <span className="mono">Signal Count</span>
                  <strong>{backtestSignals.length}</strong>
                  <span>Actionable insights</span>
                </div>
              </div>
              <div className="signal-grid">
                {backtestSignals.map((signal, idx) => (
                  <div key={idx} className="signal-card">
                    {signal}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty">Run a backtest to unlock command center insights.</div>
        )}
          </div>
        </details>
      </section>

      <section className="panel executive-panel">
        <div className="panel-header">
          <h2>Backtest Executive Brief</h2>
          <p className="hint">Readiness score, risk posture, and daily stability</p>
        </div>
        <div className="insight-row">
          <div className="insight-copy">
            <span className="mono">Conclusion</span>
            <strong>{backtestSummary.readinessLabel} readiness</strong>
            <span className="hint">{executiveBrief?.cards[0]?.note || "Run a backtest to score readiness."}</span>
          </div>
          <details className="insight-details">
            <summary>Quick stats</summary>
            <div className="insight-details-grid">
              <div className="insight-chip">Risk {backtestSummary.riskLabel}</div>
              <div className="insight-chip">Coverage {backtestSummary.coveragePct === null ? "—" : `${backtestSummary.coveragePct.toFixed(1)}%`}</div>
              <div className="insight-chip">Stability {backtestSummary.stabilityIndex === null || backtestSummary.stabilityIndex === undefined ? "—" : backtestSummary.stabilityIndex.toFixed(0)}</div>
            </div>
          </details>
        </div>
        <details className="panel-details">
          <summary>Show executive brief details</summary>
          <div className="panel-details-body">
            {executiveBrief ? (
              <>
                <div className="executive-grid">
                  {executiveBrief.cards.map((card) => (
                    <div key={card.label} className={`executive-card ${card.tone}`}>
                      <span className="mono">{card.label}</span>
                      <strong>{card.value}</strong>
                      <span className="hint">{card.note}</span>
                    </div>
                  ))}
                </div>
                <div className="executive-next">
                  <span className="mono">Next Moves</span>
                  <div className="executive-list">
                    {executiveBrief.nextMoves.map((move, idx) => (
                      <div key={idx} className="executive-item">
                        {move}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty">Run a backtest to generate the executive brief.</div>
            )}
          </div>
        </details>
      </section>

      <section className="panel radar-panel">
        <div className="panel-header">
          <h2>Backtest Risk Radar</h2>
          <p className="hint">Confidence, downside cushion, and scenario ladder</p>
        </div>
        <div className="insight-row">
          <div className="insight-copy">
            <span className="mono">Conclusion</span>
            <strong>{riskRadar ? riskRadar.riskTier.label : "Risk tier pending"}</strong>
            <span className="hint">
              {riskRadar
                ? `Drawdown ratio ${(riskRadar.drawdownRatio * 100).toFixed(0)}%`
                : "Run a backtest to score risk posture."}
            </span>
          </div>
          <details className="insight-details">
            <summary>Quick stats</summary>
            <div className="insight-details-grid">
              <div className="insight-chip">
                {riskRadar ? `${riskRadar.confidenceScore.toFixed(0)}/100 confidence` : "Confidence —"}
              </div>
              <div className="insight-chip">
                {riskRadar ? `Cushion ${formatProfit(riskRadar.downsideCushion)}` : "Cushion —"}
              </div>
              <div className="insight-chip">
                {riskRadar ? `${riskRadar.tradeDensity.toFixed(0)} trades/day` : "Density —"}
              </div>
            </div>
          </details>
        </div>
        <details className="panel-details">
          <summary>Show risk radar details</summary>
          <div className="panel-details-body">
            {riskRadar ? (
              <>
                <div className="radar-grid">
                  <div className={`radar-card ${riskRadar.riskTier.tone}`}>
                    <span className="mono">Risk Tier</span>
                    <strong>{riskRadar.riskTier.label}</strong>
                    <span>Drawdown ratio {(riskRadar.drawdownRatio * 100).toFixed(0)}%</span>
                  </div>
                  <div className={`radar-card ${riskRadar.confidenceTone}`}>
                    <span className="mono">Confidence</span>
                    <strong>{`${riskRadar.confidenceScore.toFixed(0)}/100`}</strong>
                    <span>Coverage + win rate blend</span>
                  </div>
                  <div className="radar-card neutral">
                    <span className="mono">Downside Cushion</span>
                    <strong>{formatProfit(riskRadar.downsideCushion)}</strong>
                    <span>Profit minus drawdown</span>
                  </div>
                  <div className="radar-card neutral">
                    <span className="mono">Daily Swing</span>
                    <strong>
                      {riskRadar.dailySwing !== null ? formatProfit(riskRadar.dailySwing) : "—"}
                    </strong>
                    <span>{riskRadar.tradeDensity.toFixed(0)} intervals per day</span>
                  </div>
                </div>
                <div className="radar-ladder">
                  <div className="radar-title">
                    <span className="mono">Scenario Ladder</span>
                    <span className="hint">Daily P&amp;L range</span>
                  </div>
                  {riskRadar.scenario ? (
                    <div className="radar-scenarios">
                      <div className="radar-scenario">
                        <span>Best</span>
                        <strong>{formatProfit(riskRadar.scenario.best)}</strong>
                        <span className="hint">90th percentile</span>
                      </div>
                      <div className="radar-scenario">
                        <span>Base</span>
                        <strong>{formatProfit(riskRadar.scenario.base)}</strong>
                        <span className="hint">Average day</span>
                      </div>
                      <div className="radar-scenario">
                        <span>Worst</span>
                        <strong>{formatProfit(riskRadar.scenario.worst)}</strong>
                        <span className="hint">10th percentile</span>
                      </div>
                    </div>
                  ) : (
                    <div className="empty">Run a backtest to compute scenario ranges.</div>
                  )}
                </div>
                <div className="radar-guardrails">
                  <span className="mono">Guardrails</span>
                  <div className="radar-list">
                    {riskRadar.guardrails.map((item, idx) => (
                      <div key={idx} className="radar-item">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty">Run a backtest to build the risk radar.</div>
            )}
          </div>
        </details>
      </section>

      <section className="panel flight-panel">
        <div className="panel-header">
          <h2>Backtest Flight Plan</h2>
          <p className="hint">Launch readiness, risk guardrails, and the next experiment</p>
        </div>
        <div className="insight-row">
          <div className="insight-copy">
            <span className="mono">Conclusion</span>
            <strong>{flightPlan ? flightPlan.launch.label : "Launch status pending"}</strong>
            <span className="hint">{flightPlan ? flightPlan.launch.detail : "Run a backtest to generate the flight plan."}</span>
          </div>
          <details className="insight-details">
            <summary>Quick stats</summary>
            <div className="insight-details-grid">
              <div className="insight-chip">
                {flightPlan ? `Risk ${flightPlan.riskScore.toFixed(0)}` : "Risk —"}
              </div>
              <div className="insight-chip">
                {flightPlan ? `Stability ${flightPlan.stabilityIndex.toFixed(0)}` : "Stability —"}
              </div>
              <div className="insight-chip">
                {flightPlan ? flightPlan.cadenceLabel : "Cadence —"}
              </div>
            </div>
          </details>
        </div>
        <details className="panel-details">
          <summary>Show flight plan details</summary>
          <div className="panel-details-body">
            {flightPlan ? (
              <div className="flight-grid">
                <div className={`flight-card ${flightPlan.launch.tone}`}>
                  <span className="mono">Launch Status</span>
                  <strong>{flightPlan.launch.label}</strong>
                  <p>{flightPlan.launch.detail}</p>
                  <div className="flight-tags">
                    {flightPlan.tags.map((tag) => (
                      <span key={tag.label} className={`flight-tag ${tag.tone}`}>
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flight-card">
                  <span className="mono">Risk Guardrails</span>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      style={{ width: `${flightPlan.riskScore}%` }}
                    />
                  </div>
                  <div className="flight-metrics">
                    <div className="flight-metric">
                      <span>Risk score</span>
                      <strong>{flightPlan.riskScore.toFixed(0)}</strong>
                    </div>
                    <div className="flight-metric">
                      <span>Stability</span>
                      <strong>{flightPlan.stabilityIndex.toFixed(0)}</strong>
                    </div>
                    <div className="flight-metric">
                      <span>Cadence</span>
                      <strong>{flightPlan.cadenceLabel}</strong>
                    </div>
                  </div>
                  <span className="flight-note">{flightPlan.riskLabel}</span>
                </div>
                <div className="flight-card">
                  <span className="mono">Next Experiment</span>
                  <strong>{flightPlan.nextTitle}</strong>
                  <p>{flightPlan.nextDetail}</p>
                  <div className="flight-metrics">
                    <div className="flight-metric">
                      <span>Mode</span>
                      <strong>{config.mode === "threshold" ? "Threshold" : "Percentile"}</strong>
                    </div>
                    <div className="flight-metric">
                      <span>Resolution</span>
                      <strong>{range.resolution} min</strong>
                    </div>
                    <div className="flight-metric">
                      <span>Intervals</span>
                      <strong>{activeDiagnostics?.intervalCount ?? 0}</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty">Run a backtest to generate the flight plan.</div>
            )}
          </div>
        </details>
      </section>
            </div>
          </details>

      <section className="grid">
        <div className="panel">
          <h2>Data Inputs</h2>
          <div className="field">
            <label>Load JSON</label>
            <div className="row">
              <input
                type="file"
                accept=".json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleUpload(file).catch((err) => setError(err.message));
                  }
                }}
              />
              <span className="hint">Upload any Amber payload</span>
            </div>
          </div>

          <div className="field">
            <label>Cache list</label>
            <div className="row">
              <select
                value={selectedCache}
                onChange={(e) => setSelectedCache(e.target.value)}
                disabled={!cacheList.length}
              >
                <option value="">Select a cache file</option>
                {cacheList.map((cache) => (
                  <option key={cacheId(cache)} value={cacheId(cache)}>
                    {cache.source === "local" ? "Local" : "Server"} · {cache.name}
                  </option>
                ))}
              </select>
              <button
                className="ghost small"
                onClick={() => handleLoadCache().catch((err) => setError(err.message))}
                disabled={!cacheList.length}
              >
                Load
              </button>
            </div>
          </div>

          <div className="divider" />

          <h3>Amber Proxy</h3>
          <div className="field">
            <label>Site ID</label>
            <input value={siteId} onChange={(e) => setSiteId(e.target.value)} />
          </div>
          <div className="field">
            <label>Token (optional)</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="Use server env if blank"
            />
          </div>
          <div className="field">
            <label>Start</label>
            <input
              type="date"
              value={normalizeDateInput(range.start)}
              onChange={(e) => setRange({ ...range, start: e.target.value })}
            />
          </div>
          <div className="field">
            <label>End</label>
            <input
              type="date"
              value={normalizeDateInput(range.end)}
              onChange={(e) => setRange({ ...range, end: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Resolution (min)</label>
            <input
              type="number"
              value={range.resolution}
              onChange={(e) =>
                setRange({ ...range, resolution: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Export raw data</label>
            <div className="row">
              <button
                className="ghost small"
                onClick={() => setExportOpen((prev) => !prev)}
              >
                Export raw data
              </button>
            </div>
            {exportOpen && (
              <div className="export-menu">
                <div className="export-section">
                  <span className="mono">Prices</span>
                  <div className="row">
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!payload) return;
                        downloadJson(`amber_prices_${range.start}_${range.end}.json`, payload);
                        saveLocalCache("prices", payload);
                      }}
                      disabled={!payload}
                    >
                      Download
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!payload) return;
                        copyJson(payload).catch((err) => setError(err.message));
                      }}
                      disabled={!payload}
                    >
                      Copy
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!payload) return;
                        downloadJson(`amber_prices_${range.start}_${range.end}.json`, payload);
                        saveLocalCache("prices", payload);
                        copyJson(payload).catch((err) => setError(err.message));
                      }}
                      disabled={!payload}
                    >
                      Download + Copy
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!payload) return;
                        saveLocalCache("prices", payload);
                      }}
                      disabled={!payload}
                    >
                      Save to Cache
                    </button>
                  </div>
                </div>
                <div className="export-section">
                  <span className="mono">Usage</span>
                  <div className="row">
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!usagePayload) return;
                        downloadJson(`amber_usage_${range.start}_${range.end}.json`, usagePayload);
                        saveLocalCache("usage", usagePayload);
                      }}
                      disabled={!usagePayload}
                    >
                      Download
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!usagePayload) return;
                        copyJson(usagePayload).catch((err) => setError(err.message));
                      }}
                      disabled={!usagePayload}
                    >
                      Copy
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!usagePayload) return;
                        downloadJson(`amber_usage_${range.start}_${range.end}.json`, usagePayload);
                        saveLocalCache("usage", usagePayload);
                        copyJson(usagePayload).catch((err) => setError(err.message));
                      }}
                      disabled={!usagePayload}
                    >
                      Download + Copy
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (!usagePayload) return;
                        saveLocalCache("usage", usagePayload);
                      }}
                      disabled={!usagePayload}
                    >
                      Save to Cache
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="hint">
            Proxy hides your token when the server is configured with environment variables.
          </div>
        </div>

        <div className="panel" id="backtest-settings">
          <h2>Strategy Settings</h2>
        <div className="toggle">
          <button
            className={config.mode === "threshold" ? "active" : ""}
            onClick={() => setConfig({ ...config, mode: "threshold" })}
          >
            Threshold
          </button>
          <button
            className={config.mode === "percentile" ? "active" : ""}
            onClick={() => setConfig({ ...config, mode: "percentile" })}
          >
            Percentile
          </button>
        </div>
        <div className="preset-row">
          <span className="mono">Quick Tuning</span>
          <div className="preset-actions">
            <button
              className="ghost small"
              onClick={() => applyTuningPreset("conservative")}
            >
              Conservative
            </button>
            <button
              className="ghost small"
              onClick={() => applyTuningPreset("balanced")}
            >
              Balanced
            </button>
            <button
              className="ghost small"
              onClick={() => applyTuningPreset("aggressive")}
            >
              Aggressive
            </button>
          </div>
          <span className="hint">Applies to the active strategy mode.</span>
        </div>

        <div className="field">
          <label>Active Chart Strategy</label>
            <select value={activeStrategy} onChange={(e) => setActiveStrategy(e.target.value)}>
              {strategies.map((strategy) => (
                <option key={strategy.name} value={strategy.name}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </div>

          {config.mode === "threshold" ? (
            <>
              <div className="field">
                <label>Buy Threshold (cents)</label>
                <input
                  type="number"
                  value={config.buyThreshold}
                  onChange={(e) =>
                    setConfig({ ...config, buyThreshold: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label>Sell Threshold (cents)</label>
                <input
                  type="number"
                  value={config.sellThreshold}
                  onChange={(e) =>
                    setConfig({ ...config, sellThreshold: Number(e.target.value) })
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Window Size</label>
                <input
                  type="number"
                  value={config.windowSize}
                  onChange={(e) =>
                    setConfig({ ...config, windowSize: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label>Buy Percentile</label>
                <input
                  type="number"
                  step="0.05"
                  value={config.buyPercentile}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      buyPercentile: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Sell Percentile</label>
                <input
                  type="number"
                  step="0.05"
                  value={config.sellPercentile}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      sellPercentile: Number(e.target.value),
                    })
                  }
                />
              </div>
            </>
          )}

          <div className="divider" />
          <h3>Battery</h3>
          <div className="field">
            <label>Capacity (kWh)</label>
            <input
              type="number"
              value={config.capacityKwh}
              onChange={(e) =>
                setConfig({ ...config, capacityKwh: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Max Power (kW)</label>
            <input
              type="number"
              value={config.maxPowerKw}
              onChange={(e) =>
                setConfig({ ...config, maxPowerKw: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Inverter Max AC (kW)</label>
            <input
              type="number"
              value={config.inverterMaxKw}
              onChange={(e) =>
                setConfig({ ...config, inverterMaxKw: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Daily Charge (AUD)</label>
            <input
              type="number"
              step="0.01"
              value={config.dailyChargeAud}
              onChange={(e) =>
                setConfig({ ...config, dailyChargeAud: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Start SOC (kWh)</label>
            <input
              type="number"
              value={config.startSoc}
              onChange={(e) =>
                setConfig({ ...config, startSoc: Number(e.target.value) })
              }
            />
          </div>
        </div>
      </section>

      <section className="panel" id="backtest-optimization">
        <div className="panel-header">
          <h2>Optimization Brief</h2>
          <p className="hint">Prioritized actions and tuning guidance</p>
        </div>
        {optimizationBrief ? (
          <>
            <div className="brief-grid">
              {optimizationBrief.map((item, idx) => (
                <div key={idx} className={`brief-card ${item.tone}`}>
                  <span className="mono">Priority {idx + 1}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              ))}
            </div>
            <div className="brief-footer">
              <span className="hint">{tuningHint}</span>
            </div>
          </>
        ) : (
          <div className="empty">Run a backtest to generate optimization guidance.</div>
        )}
      </section>

          <section className="panel" id="backtest-comparison">
            <div className="panel-header">
              <h2>Strategy Comparison</h2>
              <p className="hint">Backtest multiple strategies side-by-side</p>
            </div>
            <div className="compare-header-actions">
              <button
                className="ghost small"
                onClick={() => {
                  const target = document.getElementById("actual-usage-review");
                  if (target) {
                    target.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                disabled={!usagePayload?.length}
              >
                Jump to Actual Usage
              </button>
            </div>
            <div className="compare-controls">
              <div>
                <label>Compare A</label>
            <select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
              {strategies.map((strategy) => (
                <option key={strategy.name} value={strategy.name}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Compare B</label>
            <select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
              {strategies.map((strategy) => (
                <option key={strategy.name} value={strategy.name}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </div>
            <div className="winner-badge">
              Winner: <strong>{compareWinner || "—"}</strong>
            </div>
          </div>
          {usageDailySeries ? (
            <div className="panel inset usage-compare-panel">
              <h3>Actual Usage vs Feed-in (Daily)</h3>
              <UsageLinesChart days={usageDailySeries} />
            </div>
          ) : (
            <div className="empty">Load usage data to show actual usage curves.</div>
          )}
          {compareLeft && compareRight ? (
            <CompareChart
              left={compareLeft}
              right={compareRight}
              winner={compareWinner}
              baseline={baseline?.points}
              baselineLabel={baselineName}
              actualUsage={usageBaseline?.points}
              actualUsageLabel="Actual Usage (Amber)"
              llmOverlay={llmOverlay}
              llmResponse={llmResponse}
            />
          ) : (
            <div className="empty">Load data to compare strategies.</div>
        )}
        <div className="table">
          <div className="table-row head">
            <span>Strategy</span>
            <span>Profit</span>
            <span>Buy kWh</span>
            <span>Sell kWh</span>
            <span>End SOC</span>
          </div>
          {comparisonRows.map((row) => (
            <div
              key={row.name}
              className={`table-row${row.name === baselineName ? " baseline" : ""}${
                row.name === bestComparison ? " best" : ""
              }${row.name === "Baseline (Actual Usage)" ? " actual" : ""}`}
              data-note={row.note}
            >
              <span className="strategy-name">
                {row.name}
                <i className="note">ⓘ</i>
              </span>
              <span>{formatProfit(row.profit)}</span>
              <span>{row.buyKwh !== null ? row.buyKwh.toFixed(1) : "—"}</span>
              <span>{row.sellKwh !== null ? row.sellKwh.toFixed(1) : "—"}</span>
              <span>{row.endSoc.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Custom Strategy Builder</h2>
          <p className="hint">Create rules via UI or DSL</p>
        </div>
        <div className="field">
          <label>Strategy name</label>
          <input value={customName} onChange={(e) => setCustomName(e.target.value)} />
        </div>
        <div className="preset-row">
          {[
            {
              name: "Buy Low / Sell High",
              rules: [
                { field: "buy", op: "<=", value: 12 },
                { field: "sell", op: ">=", value: 60 },
              ],
              dsl: "BUY when buy <= 12; SELL when sell >= 60",
            },
            {
              name: "Night Charge / Peak Sell",
              rules: [
                { field: "hour", op: "<=", value: 5 },
                { field: "sell", op: ">=", value: 70 },
              ],
              dsl: "BUY when hour <= 5; SELL when sell >= 70",
            },
            {
              name: "Solar Assist",
              rules: [
                { field: "solar", op: "<=", value: 2 },
                { field: "sell", op: ">=", value: 55 },
              ],
              dsl: "BUY when solar <= 2; SELL when sell >= 55",
            },
            {
              name: "Negative Price Fill",
              rules: [
                { field: "buy", op: "<", value: 0 },
                { field: "sell", op: ">=", value: 65 },
              ],
              dsl: "BUY when buy < 0; SELL when sell >= 65",
            },
          ].map((preset) => (
            <button
              key={preset.name}
              className="ghost small"
              onClick={() => {
                setCustomName(preset.name);
                setCustomRules(preset.rules as CustomRule[]);
                setDslInput(preset.dsl);
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="rule-list">
          {customRules.map((rule, idx) => (
            <div key={idx} className="rule-row">
              <select
                value={rule.field}
                onChange={(e) =>
                  setCustomRules((prev) =>
                    prev.map((r, i) =>
                      i === idx ? { ...r, field: e.target.value as CustomRule["field"] } : r,
                    ),
                  )
                }
              >
                <option value="buy">buy price</option>
                <option value="sell">sell price</option>
                <option value="hour">hour</option>
                <option value="solar">solar kW</option>
              </select>
              <select
                value={rule.op}
                onChange={(e) =>
                  setCustomRules((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, op: e.target.value as CustomRule["op"] } : r)),
                  )
                }
              >
                <option value="<">{"<"}</option>
                <option value="<=">{"<="}</option>
                <option value=">">{">"}</option>
                <option value=">=">{">="}</option>
              </select>
              <input
                type="number"
                value={rule.value}
                onChange={(e) =>
                  setCustomRules((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, value: Number(e.target.value) } : r)),
                  )
                }
              />
              <button
                className="ghost small"
                onClick={() => setCustomRules((prev) => prev.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="rule-actions">
            <button
              className="ghost small"
              onClick={() => setCustomRules((prev) => [...prev, { field: "buy", op: "<=", value: 10 }])}
            >
              Add Buy Rule
            </button>
            <button
              className="ghost small"
              onClick={() => setCustomRules((prev) => [...prev, { field: "sell", op: ">=", value: 60 }])}
            >
              Add Sell Rule
            </button>
          </div>
        </div>
        <div className="divider" />
        <div className="field">
          <label>DSL input</label>
          <textarea
            rows={3}
            value={dslInput}
            onChange={(e) => setDslInput(e.target.value)}
            placeholder="BUY when buy <= 12; SELL when sell >= 60"
          />
          <button
            className="ghost small"
            onClick={() => {
              const parsed = parseDsl(dslInput);
              if (parsed.length) {
                setCustomRules(parsed);
                setDslStatus(`Parsed ${parsed.length} rules.`);
              } else {
                setDslStatus("No valid rules parsed. Use: BUY when buy <= 12; SELL when sell >= 60");
              }
            }}
          >
            Parse DSL
          </button>
          {dslStatus && <div className="hint">{dslStatus}</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>LLM Strategy (OpenRouter)</h2>
          <p className="hint">Advanced options require manual selection</p>
        </div>
        <div className="field">
          <label>Enable LLM decisioning</label>
          <label className="check">
            <input
              type="checkbox"
              checked={llmConfig.enabled}
              onChange={(e) => setLlmConfig({ ...llmConfig, enabled: e.target.checked })}
            />
            <span>Use OpenRouter model for strategy decisions</span>
          </label>
        </div>
        <div className="field">
          <label>Model</label>
          <input
            value={llmConfig.model}
            onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Decision cadence</label>
          <select
            value={llmConfig.cadence}
            onChange={(e) => setLlmConfig({ ...llmConfig, cadence: e.target.value })}
          >
            <option value="per-backtest">Once per backtest</option>
            <option value="per-interval">Every interval</option>
            <option value="per-hour">Hourly</option>
          </select>
        </div>
        <div className="field">
          <label>LLM output format</label>
          <textarea
            rows={2}
            value={llmConfig.outputFormat}
            onChange={(e) => setLlmConfig({ ...llmConfig, outputFormat: e.target.value })}
          />
        </div>
        <div className="field">
          <label>LLM horizon (hours)</label>
          <input
            type="number"
            min={1}
            max={168}
            value={llmConfig.horizonHours}
            onChange={(e) =>
              setLlmConfig({ ...llmConfig, horizonHours: Number(e.target.value) })
            }
          />
        </div>
        <div className="field">
          <label>Max tokens</label>
          <input
            type="number"
            min={256}
            max={8000}
            value={llmConfig.maxTokens}
            onChange={(e) =>
              setLlmConfig({ ...llmConfig, maxTokens: Number(e.target.value) })
            }
          />
        </div>
        <div className="field">
          <label>Overlay on charts</label>
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={llmOverlay.enabled}
                onChange={(e) => setLlmOverlay({ ...llmOverlay, enabled: e.target.checked })}
              />
              <span>Enable overlay</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={llmOverlay.bands}
                onChange={(e) => setLlmOverlay({ ...llmOverlay, bands: e.target.checked })}
              />
              <span>Color bands</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={llmOverlay.arrows}
                onChange={(e) => setLlmOverlay({ ...llmOverlay, arrows: e.target.checked })}
              />
              <span>Arrows</span>
            </label>
            <label className="check">
              <span>Opacity</span>
              <input
                type="number"
                min="0.05"
                max="0.5"
                step="0.05"
                value={llmOverlay.opacity}
                onChange={(e) =>
                  setLlmOverlay({ ...llmOverlay, opacity: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="primary"
            onClick={() => handleLlmDecision().catch((err) => setError(err.message))}
            disabled={llmLoading}
          >
            {llmLoading ? (
              <>
                <span className="spinner" /> Calling LLM...
              </>
            ) : (
              "Run LLM Decision"
            )}
          </button>
        </div>
        <div className="field">
          <label>LLM summary</label>
          <div className="stats">
            <div>
              <span>Action</span>
              <strong>{llmSummary.action || "—"}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>
                {llmSummary.confidence !== null ? `${(llmSummary.confidence * 100).toFixed(0)}%` : "—"}
              </strong>
            </div>
            <div>
              <span>Reason</span>
              <strong>{llmSummary.reason || "—"}</strong>
            </div>
            <div>
              <span>Actions</span>
              <strong>
                {llmActionCount ? `${llmActionCount}/${llmConfig.horizonHours}` : `0/${llmConfig.horizonHours}`}
              </strong>
            </div>
          </div>
        </div>
        {llmMetrics && (
          <div className="llm-grid">
            <div className="panel">
              <h3>Hourly Actions</h3>
              <ActionTimelineChart points={llmTimeline} />
            </div>
            <div className="panel">
              <h3>Action Mix</h3>
              <ActionPieChart counts={llmMetrics.counts} />
            </div>
            <div className="panel">
              <h3>Confidence</h3>
              <ConfidenceChart values={llmMetrics.confidences} />
            </div>
            <div className="panel">
              <h3>Profit Impact</h3>
              <ProfitCompareChart
                llmProfit={llmMetrics.llmProfit}
                baseProfit={llmMetrics.baseProfit}
              />
            </div>
          </div>
        )}
        <div className="field">
          <div className="row">
            <label>LLM raw output</label>
            <button
              className="ghost small"
              onClick={() => setLlmShowRaw((prev) => !prev)}
            >
              {llmShowRaw ? "Hide" : "Show"}
            </button>
          </div>
          {llmShowRaw && (
            <pre className="code-block">
              {llmResponse || "No response yet. Click “Run LLM Decision”."}
            </pre>
          )}
        </div>
        <div className="hint">
          API key is stored server-side (e.g. `OPENROUTER_API_KEY` in Supabase).
        </div>
      </section>

      <RLPanel
        apiBase={apiBase}
        anonKey={anonKey}
        payload={payload}
        solar={payload ? payload.map((item) => solarForTime(new Date(item.startTime), solarProfile)) : []}
        config={config}
        onError={(message) => setError(message)}
        onEvalComplete={(result, model) =>
          setRlEval({
            profit: result.profit,
            endSoc: result.endSoc,
            algorithm: model.algorithm,
            at: Date.now(),
          })
        }
      />

      <section className="panel">
        <div className="panel-header">
          <h2>Leaderboard</h2>
          <p className="hint">Profit / drawdown / win rate</p>
        </div>
        <div className="table">
          <div className="table-row head">
            <span>Strategy</span>
            <span>Profit</span>
            <span>Drawdown</span>
            <span>Win Rate</span>
            <span>Score</span>
            <span>Comment</span>
          </div>
          {leaderboard.map((row) => (
            <div
              key={row.name}
              className={`table-row${row.name === bestLeaderboard ? " best" : ""}`}
            >
              <span>{row.name}</span>
              <span>{formatProfit(row.profit)}</span>
              <span>{row.drawdown.toFixed(2)}</span>
              <span>{(row.winRate * 100).toFixed(1)}%</span>
              <span>{row.score.toFixed(2)}</span>
              <span>{row.comment}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel chart-panel">
        <div className="chart-header">
          <div>
            <h2>Backtest Timeline</h2>
            <p className="hint">Hover to inspect price and SOC</p>
          </div>
          <div className="chip">
            {active?.points.length ? `${active.points.length} intervals` : "No data yet"}
          </div>
        </div>
        <div className="chart-controls">
          <div>
            <label>Window size</label>
            <input
              type="number"
              value={windowSize}
              min={10}
              max={active?.points.length || 10}
              onChange={(e) => setWindowSize(Number(e.target.value))}
            />
          </div>
          <div>
            <label>Start index</label>
            <input
              type="range"
              min={0}
              max={Math.max(0, (active?.points.length || 0) - windowSize)}
              value={windowStart}
              onChange={(e) => setWindowStart(Number(e.target.value))}
              step={1}
            />
          </div>
          <div>
            <label>Max points</label>
            <input
              type="number"
              min={100}
              max={1000}
              value={maxPoints}
              onChange={(e) => setMaxPoints(Number(e.target.value))}
            />
          </div>
        </div>
        {sampledPoints.length ? (
          <Chart
            points={sampledPoints}
            ranges={ranges!}
            baseline={baseline ? downsample(baseline.points, maxPoints) : undefined}
            llmOverlay={llmOverlay}
            llmResponse={llmResponse}
          />
        ) : (
          <div className="empty">Upload JSON or fetch from the proxy.</div>
        )}
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Profit Curve</h2>
          {sampledPoints.length ? (
            <LineChart
              points={sampledPoints}
              dataKey="cumulativeProfit"
              color="#7c3aed"
              label="Profit"
            />
          ) : (
            <div className="empty">Load data to see profit curve.</div>
          )}
        </div>
        <div className="panel">
          <h2>Price Distribution</h2>
          {distribution ? (
            <KdeBoxPlot buy={distribution.buy} sell={distribution.sell} />
          ) : (
            <div className="empty">Load data to see distribution.</div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Forecast (ARIMA)</h2>
          {forecasts ? (
            <ForecastPanel forecasts={forecasts.arima} />
          ) : (
            <div className="empty">Load data to see forecasts.</div>
          )}
        </div>
        <div className="panel">
          <h2>Forecast (Prophet)</h2>
          {forecasts ? (
            <ForecastPanel forecasts={forecasts.prophet} />
          ) : (
            <div className="empty">Load data to see forecasts.</div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel weather-panel">
          <div className="panel-header">
            <h2>Solar Contribution (Simulated vs Actual)</h2>
            <button className="ghost small" onClick={() => setSolarModalOpen(true)}>
              Fullscreen
            </button>
          </div>
          <div className="insight-row">
            <div className="insight-copy">
              <span className="mono">Forecast Verdict</span>
              <strong>{solarVerdict.conclusion}</strong>
              <span className="hint">{solarVerdict.hint}</span>
            </div>
            <details className="insight-details">
              <summary>View logic</summary>
              <div className="insight-details-grid">
                {solarVerdict.drivers.map((driver, idx) => (
                  <div key={`${driver}-${idx}`} className="insight-chip">
                    {driver}
                  </div>
                ))}
              </div>
            </details>
          </div>
          <div className="weather-metrics">
            {weatherSummaryCards.map((card) => (
              <div key={card.label} className="weather-metric">
                <span className="mono">{card.label}</span>
                <strong>{card.value}</strong>
                <span className="hint">{card.hint}</span>
              </div>
            ))}
          </div>
          <details className="monitor-details">
            <summary>View metrics</summary>
            <div className="monitor-grid">
              {weatherPulseCards.map((card) => (
                <div key={card.label} className="monitor-card">
                  <span className="mono">{card.label}</span>
                  <strong>{card.value}</strong>
                  <span className="hint">{card.hint}</span>
                </div>
              ))}
              <div className="monitor-card">
                <span className="mono">Forecast Mode</span>
                <strong>{solarForecast.enabled ? solarForecast.mode.toUpperCase() : "OFF"}</strong>
                <span className="hint">
                  {solarForecast.enabled ? "Solar curve overlay" : "Enable forecast to compare"}
                </span>
              </div>
              <div className="monitor-card">
                <span className="mono">Weather Source</span>
                <strong>{weatherEnabled ? "Open-Meteo" : "Disabled"}</strong>
                <span className="hint">{weatherStatus}</span>
              </div>
              <div className="monitor-card">
                <span className="mono">Latest Solar Day</span>
                <strong>
                  {latestSolarDay
                    ? `${latestSolarDay.simulatedKwh.toFixed(1)} kWh`
                    : "—"}
                </strong>
                <span className="hint">
                  {latestSolarDay?.actualKwh !== null && latestSolarDay?.actualKwh !== undefined
                    ? `Actual ${latestSolarDay.actualKwh.toFixed(1)} kWh`
                    : "Awaiting feed-in data"}
                </span>
              </div>
            </div>
          </details>
          <details className="monitor-details">
            <summary>Model settings</summary>
            <div className="field">
              <label>Sunrise hour</label>
              <input
                type="number"
                value={solarProfile.sunrise}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, sunrise: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Peak hour</label>
              <input
                type="number"
                value={solarProfile.peak}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, peak: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Evening hour</label>
              <input
                type="number"
                value={solarProfile.evening}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, evening: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Sunset hour</label>
              <input
                type="number"
                value={solarProfile.sunset}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, sunset: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Morning kW</label>
              <input
                type="number"
                step="0.1"
                value={solarProfile.morningKw}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, morningKw: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Peak kW</label>
              <input
                type="number"
                step="0.1"
                value={solarProfile.peakKw}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, peakKw: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Evening kW</label>
              <input
                type="number"
                step="0.1"
                value={solarProfile.eveningKw}
                onChange={(e) =>
                  setSolarProfile({ ...solarProfile, eveningKw: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Forecast overlay</label>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={solarForecast.enabled}
                    onChange={(e) =>
                      setSolarForecast({ ...solarForecast, enabled: e.target.checked })
                    }
                  />
                  <span>Enable forecast</span>
                </label>
                <label className="check">
                  <span>Mode</span>
                  <select
                    value={solarForecast.mode}
                    onChange={(e) =>
                      setSolarForecast({ ...solarForecast, mode: e.target.value })
                    }
                  >
                    <option value="multiplier">Scale</option>
                    <option value="arima">ARIMA</option>
                    <option value="prophet">Prophet</option>
                    <option value="regression">Regression</option>
                  </select>
                </label>
                <label className="check">
                  <span>Multiplier</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0.2"
                    max="1.5"
                    value={solarForecast.multiplier}
                    disabled={solarForecast.mode !== "multiplier"}
                    onChange={(e) =>
                      setSolarForecast({
                        ...solarForecast,
                        multiplier: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="field">
              <label>Weather (Open-Meteo)</label>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={weatherEnabled}
                    onChange={(e) => setWeatherEnabled(e.target.checked)}
                  />
                  <span>Apply cloud cover</span>
                </label>
                <span className="hint">{weatherStatus}</span>
              </div>
            </div>
          </details>
          {solarCurve.length ? (
            <>
              <SolarDailyChart points={solarDaily} />
              <div className="divider" />
              <WeatherChart
                points={solarZoomed}
                label="Solar kW"
                overlay={solarForecastZoomed ?? undefined}
                shade={weatherEnabled ? cloudCoverZoomed : undefined}
                shadeLabel="Cloud cover"
                overlayLabel={
                  solarForecast.mode === "arima"
                    ? "Forecast (ARIMA)"
                    : solarForecast.mode === "prophet"
                      ? "Forecast (Prophet)"
                      : solarForecast.mode === "regression"
                        ? "Forecast (Regression)"
                        : "Forecast (Scale)"
                }
                onRangeSelect={setSolarZoom}
              />
              <div className="row">
                <button className="ghost small" onClick={() => setSolarModalOpen(true)}>
                  Expand charts
                </button>
                <span className="hint">Drag to zoom, double-click to reset.</span>
              </div>
            </>
          ) : (
            <div className="empty">Load data to generate solar curve.</div>
          )}
          {solarModalOpen && (
            <div className="modal-backdrop" onClick={() => setSolarModalOpen(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Solar Contribution – Fullscreen</h3>
                  <button className="ghost small" onClick={() => setSolarModalOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="modal-body">
                  <SolarDailyChart points={solarDaily} width={960} height={320} />
                  <div className="divider" />
                  <WeatherChart
                    points={solarZoomed}
                    label="Solar kW"
                    overlay={solarForecastZoomed ?? undefined}
                    shade={weatherEnabled ? cloudCoverZoomed : undefined}
                    shadeLabel="Cloud cover"
                    overlayLabel={
                      solarForecast.mode === "arima"
                        ? "Forecast (ARIMA)"
                        : solarForecast.mode === "prophet"
                          ? "Forecast (Prophet)"
                          : solarForecast.mode === "regression"
                            ? "Forecast (Regression)"
                            : "Forecast (Scale)"
                    }
                    width={960}
                    height={320}
                    onRangeSelect={setSolarZoom}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

          <section className="panel">
            <h2>Amber API Inspector</h2>
            <div className="hero-actions">
              <button
                className="ghost"
                onClick={() => handleSites().catch((err) => setError(err.message))}
              >
                Load Sites
              </button>
            </div>
            <div className="grid">
              <div className="panel">
                <h3>Sites</h3>
                <pre className="code-block">{formatJson(apiSnapshots.sites)}</pre>
              </div>
              <div className="panel">
                <h3>Prices Response</h3>
                <pre className="code-block">{formatJson(apiSnapshots.prices)}</pre>
              </div>
              <div className="panel">
                <h3>Current Response</h3>
                <pre className="code-block">{formatJson(apiSnapshots.current)}</pre>
              </div>
              <div className="panel">
                <h3>Usage Response</h3>
                <pre className="code-block">{formatJson(apiSnapshots.usage)}</pre>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Decision Timeline</h2>
              <p className="hint">Next 12 slots (1 hour) based on live 5-min prices</p>
            </div>
            {monitorTimeline.length ? (
              <div className="timeline-list">
                {monitorTimeline.map((item, idx) => (
                  <div key={`${item.time}-${idx}`} className="timeline-row">
                    <span className="mono">{new Date(item.time).toLocaleTimeString()}</span>
                    <span>Buy {item.buy.toFixed(1)}c</span>
                    <span>Sell {item.sell.toFixed(1)}c</span>
                    <span className={`pill ${item.action}`}>{item.action.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Forecast unavailable.</div>
            )}
          </section>
          <section className="panel" id="actual-usage-review">
            <ActualUsageReview usage={usagePayload} />
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Daily Decision Review</h2>
              <p className="hint">Replay each day, inspect actions, and summarize performance</p>
            </div>
            <DailyDecisionReview
              points={active?.points || null}
              resolutionMinutes={range.resolution}
            />
          </section>
        </>
      ) : (
        <>
          <section className="panel monitor-overview">
            <div className="panel-header">
              <h2>Monitor Overview</h2>
              <p className="hint">Simple conclusion first, click for the logic.</p>
            </div>
            <div className="overview-grid">
              <div className="overview-card">
                <span className="mono">Recommended</span>
                <strong className={`pill ${monitorDecision?.action || "hold"}`}>
                  {monitorInsights.overview.action}
                </strong>
                <span className="hint">Confidence {monitorInsights.overview.confidence}</span>
                <span className="hint">{monitorInsights.overview.nextStep}</span>
              </div>
              <div className="overview-card">
                <span className="mono">Price Regime</span>
                <strong>{monitorInsights.overview.price}</strong>
                <span className="hint">{monitorInsights.priceHint}</span>
              </div>
              <div className="overview-card">
                <span className="mono">Strategy Pulse</span>
                <strong>{monitorInsights.overview.strategy}</strong>
                <span className="hint">{monitorInsights.strategyHint}</span>
              </div>
              <div className="overview-card">
                <span className="mono">Weather Impact</span>
                <strong>{monitorInsights.overview.weather}</strong>
                <span className="hint">{monitorInsights.weatherHint}</span>
              </div>
              <div className="overview-card">
                <span className="mono">RL Pulse</span>
                <strong>{monitorInsights.rlConclusion}</strong>
                <span className="hint">{monitorInsights.rlHint}</span>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Live Monitor</h2>
              <p className="hint">Amber VPP pricing + battery status (stubbed Modbus)</p>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <span className="mono">Live Buy</span>
                <strong>
                  {currentSummary?.general
                    ? formatAmberPrice(currentSummary.general.perKwh)
                    : "—"}
                </strong>
                <span>
                  {currentSummary?.general?.startTime
                    ? formatTimestamp(currentSummary.general.startTime)
                    : "—"}
                </span>
              </div>
              <div className="summary-card">
                <span className="mono">Live Sell</span>
                <strong>
                  {currentSummary?.feedIn
                    ? formatAmberPrice(currentSummary.feedIn.perKwh)
                    : "—"}
                </strong>
                <span>
                  {currentSummary?.feedIn?.startTime
                    ? formatTimestamp(currentSummary.feedIn.startTime)
                    : "—"}
                </span>
              </div>
              <div className="summary-card">
                <span className="mono">Battery SOC</span>
                <strong>{batteryStatus.socPct.toFixed(0)}%</strong>
                <span>Updated {batteryStatus.updatedAt}</span>
              </div>
              <div className="summary-card projected-card">
                <span className="mono">Projected Profit</span>
                <strong>{projectedProfit !== null ? formatProfit(projectedProfit) : "—"}</strong>
                <span>Next 6–12 hours</span>
              </div>
            </div>
            <details className="monitor-details">
              <summary>View battery details</summary>
              <div className="monitor-grid">
                <div className="monitor-card">
                  <span className="mono">Battery Power</span>
                  <strong>{batteryStatus.powerKw.toFixed(1)} kW</strong>
                  <span className="hint">Charge/Discharge</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Max Charge</span>
                  <strong>{batteryStatus.maxChargeKw.toFixed(1)} kW</strong>
                  <span className="hint">Mock limit</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Reserve SOC</span>
                  <strong>{batteryStatus.reserveSocPct.toFixed(0)}%</strong>
                  <span className="hint">Safety buffer</span>
                </div>
              </div>
            </details>
          </section>

          <section className="panel monitor-price-panel">
            <div className="panel-header">
              <h2>Current Price Pulse</h2>
              <p className="hint">Live price balance, volatility, and short-term drift.</p>
            </div>
            <div className="insight-row">
              <div className="insight-copy">
                <span className="mono">Conclusion</span>
                <strong>{monitorInsights.priceConclusion}</strong>
                <span className="hint">{monitorInsights.priceHint}</span>
                <span className="hint">Next: {monitorInsights.priceNextStep}</span>
              </div>
              <details className="insight-details">
                <summary>View drivers</summary>
                <div className="insight-details-grid">
                  {monitorInsights.priceDrivers.map((driver) => (
                    <div key={driver} className="insight-chip">
                      {driver}
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <div className="decision-strip">
              <div className="decision-card">
                <span className="mono">Verdict</span>
                <strong>{monitorInsights.priceTag}</strong>
                <span className="hint">{monitorInsights.priceConclusion}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Confidence</span>
                <strong>{monitorInsights.priceConfidenceLabel}</strong>
                <span className="hint">{monitorInsights.priceConfidenceHint}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Next Window</span>
                <strong>{monitorPriceWindow ? `Buy ${monitorPriceWindow.buyLabel}` : "Awaiting window"}</strong>
                <span className="hint">
                  {monitorPriceWindow
                    ? `Sell ${monitorPriceWindow.sellLabel} · Δ${monitorPriceWindow.spread.toFixed(1)}c`
                    : "Load current prices to unlock window"}
                </span>
              </div>
            </div>
            <details className="monitor-details">
              <summary>View scorecards</summary>
              <div className="monitor-summary-grid">
                {monitorPricePulse.map((card) => (
                  <div key={card.label} className="monitor-summary-card">
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
              </div>
            </details>
            <details className="monitor-details">
              <summary>View metrics</summary>
              <div className="monitor-grid">
                <div className="monitor-card">
                  <span className="mono">Live Buy</span>
                  <strong>
                    {currentSummary?.general
                      ? formatAmberPrice(currentSummary.general.perKwh)
                      : "—"}
                  </strong>
                  <span className="hint">Vol {monitorPriceStats.buyVol.toFixed(1)} c</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Live Sell</span>
                  <strong>
                    {currentSummary?.feedIn
                      ? formatAmberPrice(currentSummary.feedIn.perKwh)
                      : "—"}
                  </strong>
                  <span className="hint">Vol {monitorPriceStats.sellVol.toFixed(1)} c</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Spread</span>
                  <strong>
                    {monitorPriceStats.spread !== null
                      ? `${monitorPriceStats.spread.toFixed(1)} c`
                      : "—"}
                  </strong>
                  <span className="hint">Sell - Buy</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">5-min Drift</span>
                  <strong
                    className={
                      monitorPriceStats.buyTrend > 0.2
                        ? "pos"
                        : monitorPriceStats.buyTrend < -0.2
                          ? "neg"
                          : ""
                    }
                  >
                    {monitorPriceStats.buyTrend >= 0 ? "+" : ""}
                    {monitorPriceStats.buyTrend.toFixed(1)} c
                  </strong>
                  <span className="hint">Buy series drift</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">30-min Avg</span>
                  <strong>
                    {monitorPriceStats.buy30Avg !== null
                      ? `${monitorPriceStats.buy30Avg.toFixed(1)} c`
                      : "—"}
                  </strong>
                  <span className="hint">Buy average</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">30-min Avg</span>
                  <strong>
                    {monitorPriceStats.sell30Avg !== null
                      ? `${monitorPriceStats.sell30Avg.toFixed(1)} c`
                      : "—"}
                  </strong>
                  <span className="hint">Sell average</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Forecast Buy Med</span>
                  <strong>
                    {monitorForecast?.buyMedian !== undefined && monitorForecast?.buyMedian !== null
                      ? `${monitorForecast.buyMedian.toFixed(1)} c`
                      : "—"}
                  </strong>
                  <span className="hint">Next 6–12h</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Forecast Sell Med</span>
                  <strong>
                    {monitorForecast?.sellMedian !== undefined && monitorForecast?.sellMedian !== null
                      ? `${monitorForecast.sellMedian.toFixed(1)} c`
                      : "—"}
                  </strong>
                  <span className="hint">Next 6–12h</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Forecast Spread</span>
                  <strong>
                    {monitorForecast?.spread !== undefined && monitorForecast?.spread !== null
                      ? `${monitorForecast.spread.toFixed(1)} c`
                      : "—"}
                  </strong>
                  <span className="hint">Window range</span>
                </div>
              </div>
            </details>
            <details className="monitor-details">
              <summary>View timelines</summary>
              {currentSummary ? (
                <div className="timeline-stack">
                  <CurrentMarketTimeline title="Live 5-min" rows={currentPrice} tone="primary" />
                  <CurrentMarketTimeline title="Live 30-min" rows={currentPrice30} tone="secondary" />
                </div>
              ) : (
                <div className="empty">Click “Current Prices” to load.</div>
              )}
            </details>
          </section>

          <section className="panel strategy-panel">
            <div className="panel-header">
              <h2>Strategy Control Tower</h2>
              <p className="hint">Active rules, diagnostics, and the winning backtest.</p>
            </div>
            <div className="insight-row">
              <div className="insight-copy">
                <span className="mono">Conclusion</span>
                <strong>{monitorInsights.strategyConclusion}</strong>
                <span className="hint">{monitorInsights.strategyHint}</span>
                <span className="hint">Next: {monitorInsights.strategyNextStep}</span>
              </div>
              <details className="insight-details">
                <summary>View drivers</summary>
                <div className="insight-details-grid">
                  {monitorInsights.strategyDrivers.map((driver) => (
                    <div key={driver} className="insight-chip">
                      {driver}
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <div className="decision-strip">
              <div className="decision-card">
                <span className="mono">Verdict</span>
                <strong>{monitorInsights.strategyTag}</strong>
                <span className="hint">{monitorInsights.strategyConclusion}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Confidence</span>
                <strong>{monitorInsights.strategyConfidenceLabel}</strong>
                <span className="hint">{monitorInsights.strategyConfidenceHint}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Next Step</span>
                <strong>{monitorInsights.strategyNextStep}</strong>
                <span className="hint">{monitorInsights.strategyHint}</span>
              </div>
            </div>
            <details className="monitor-details">
              <summary>View scorecards</summary>
              <div className="monitor-summary-grid">
                {monitorStrategyPulse.map((card) => (
                  <div key={card.label} className="monitor-summary-card">
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
              </div>
            </details>
            <details className="monitor-details">
              <summary>View metrics</summary>
              <div className="monitor-grid">
                {monitorStrategyCards.map((card) => (
                  <div key={card.label} className="monitor-card">
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
              </div>
            </details>
          </section>

          <section className="panel weather-pulse-panel">
            <div className="panel-header">
              <h2>Weather & Solar Forecast</h2>
              <p className="hint">Cloud impact + solar prediction quality.</p>
            </div>
            <div className="insight-row">
              <div className="insight-copy">
                <span className="mono">Conclusion</span>
                <strong>{monitorInsights.weatherConclusion}</strong>
                <span className="hint">{monitorInsights.weatherHint}</span>
                <span className="hint">Next: {monitorInsights.weatherNextStep}</span>
              </div>
              <details className="insight-details">
                <summary>View drivers</summary>
                <div className="insight-details-grid">
                  {monitorInsights.weatherDrivers.map((driver) => (
                    <div key={driver} className="insight-chip">
                      {driver}
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <div className="decision-strip">
              <div className="decision-card">
                <span className="mono">Solar Outlook</span>
                <strong>{weatherImpact.solarOutlookLabel}</strong>
                <span className="hint">{weatherImpact.solarOutlookNote}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Best Window</span>
                <strong>{weatherImpact.bestWindowLabel}</strong>
                <span className="hint">{weatherImpact.bestWindowNote}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Forecast Confidence</span>
                <strong>{monitorInsights.weatherConfidence}</strong>
                <span className="hint">{monitorInsights.weatherConfidenceHint}</span>
              </div>
            </div>
            <details className="monitor-details">
              <summary>View scorecards</summary>
              <div className="monitor-summary-grid">
                {weatherSummaryCards.map((card) => (
                  <div key={card.label} className="monitor-summary-card">
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
              </div>
            </details>
            <details className="monitor-details">
              <summary>View metrics</summary>
              <div className="monitor-grid">
                {weatherPulseCards.map((card) => (
                  <div key={card.label} className="monitor-card">
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
                <div className="monitor-card">
                  <span className="mono">Forecast Mode</span>
                  <strong>{solarForecast.enabled ? solarForecast.mode.toUpperCase() : "OFF"}</strong>
                  <span className="hint">{solarForecast.enabled ? "Overlay on solar curve" : "Enable to compare"}</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Weather Source</span>
                  <strong>{weatherEnabled ? "Open-Meteo" : "Disabled"}</strong>
                  <span className="hint">{weatherStatus}</span>
                </div>
                <div className="monitor-card">
                  <span className="mono">Latest Solar Day</span>
                  <strong>
                    {latestSolarDay
                      ? `${latestSolarDay.simulatedKwh.toFixed(1)} kWh`
                      : "—"}
                  </strong>
                  <span className="hint">
                    {latestSolarDay?.actualKwh !== null && latestSolarDay?.actualKwh !== undefined
                      ? `Actual ${latestSolarDay.actualKwh.toFixed(1)} kWh`
                      : "Awaiting feed-in data"}
                  </span>
                </div>
              </div>
            </details>
          </section>

          <section className="panel rl-pulse-panel">
            <div className="panel-header">
              <h2>RL Learning Pulse</h2>
              <p className="hint">Policy confidence, rewards, and latest eval signal.</p>
            </div>
            <div className="insight-row">
              <div className="insight-copy">
                <span className="mono">Conclusion</span>
                <strong>{monitorInsights.rlConclusion}</strong>
                <span className="hint">{monitorInsights.rlHint}</span>
                <span className="hint">Next: {monitorInsights.rlNextStep}</span>
              </div>
              <details className="insight-details">
                <summary>View drivers</summary>
                <div className="insight-details-grid">
                  {monitorInsights.rlDrivers.map((driver) => (
                    <div key={driver} className="insight-chip">
                      {driver}
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <div className="decision-strip">
              <div className="decision-card">
                <span className="mono">Policy Action</span>
                <strong>{monitorRlSummary ? monitorRlSummary.action.toUpperCase() : "—"}</strong>
                <span className="hint">{monitorRlPulse[0]?.hint ?? "Awaiting RL context"}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Confidence</span>
                <strong>{monitorInsights.rlConfidence}</strong>
                <span className="hint">{monitorInsights.rlConfidenceHint}</span>
              </div>
              <div className="decision-card">
                <span className="mono">Constraint</span>
                <strong>{monitorRlPulse[1]?.value ?? "—"}</strong>
                <span className="hint">{monitorRlPulse[1]?.hint ?? "Load current prices"}</span>
              </div>
            </div>
            <details className="monitor-details">
              <summary>View scorecards</summary>
              <div className="monitor-summary-grid">
                {monitorRlPulse.map((card) => (
                  <div key={card.label} className="monitor-summary-card">
                    <span className="mono">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="hint">{card.hint}</span>
                  </div>
                ))}
              </div>
            </details>
            {monitorRlSummary ? (
              <details className="monitor-details">
                <summary>View metrics</summary>
                <div className="monitor-grid">
                  <div className="monitor-card">
                    <span className="mono">Action</span>
                    <strong className={`pill ${monitorRlSummary.action}`}>
                      {monitorRlSummary.action.toUpperCase()}
                    </strong>
                    <span className="hint">Policy output</span>
                  </div>
                  <div className="monitor-card">
                    <span className="mono">Policy Split</span>
                    <strong>{monitorRlSummary.policy}</strong>
                    <span className="hint">Softmax over Q</span>
                  </div>
                  <div className="monitor-card">
                    <span className="mono">Expected Return</span>
                    <strong>{monitorRlSummary.expectedReturn.toFixed(2)}</strong>
                    <span className="hint">Max Q</span>
                  </div>
                  <div className="monitor-card">
                    <span className="mono">Immediate Reward</span>
                    <strong>{monitorRlSummary.reward.toFixed(2)} c/kWh</strong>
                    <span className="hint">Live tick</span>
                  </div>
                  <div className="monitor-card">
                    <span className="mono">Q Spread</span>
                    <strong>{monitorRlSummary.qSpread.toFixed(2)}</strong>
                    <span className="hint">Confidence gap</span>
                  </div>
                  <div className="monitor-card">
                    <span className="mono">Last RL Eval</span>
                    <strong>{rlEval ? formatProfit(rlEval.profit) : "—"}</strong>
                    <span className="hint">
                      {rlEval ? `SOC ${rlEval.endSoc.toFixed(1)}%` : "Run RL evaluation"}
                    </span>
                  </div>
                </div>
              </details>
            ) : (
              <div className="empty">Load current prices to compute RL context.</div>
            )}
          </section>

          <section className="panel action-panel">
            <div className="panel-header">
              <h2>Recommended Action</h2>
              <p className="hint">Based on live price, forecast, and backtest lessons</p>
            </div>
            {monitorDecision ? (
              <div className="action-grid">
                <div className={`action-pill ${monitorDecision.action}`}>
                  {monitorDecision.action.toUpperCase()}
                </div>
                <div className="action-details">
                  <div className="stats">
                    <div>
                      <span>Suggested Power</span>
                      <strong>{monitorDecision.powerKw.toFixed(1)} kW</strong>
                    </div>
                    <div>
                      <span>Confidence</span>
                      <strong>{(monitorDecision.confidence * 100).toFixed(0)}%</strong>
                    </div>
                    <div>
                      <span>Strategy Leader</span>
                      <strong>{bestStrategyName || "—"}</strong>
                    </div>
                    <div>
                      <span>Projected Profit</span>
                      <strong>{projectedProfit !== null ? formatProfit(projectedProfit) : "—"}</strong>
                    </div>
                  </div>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => handleSendCommand()}>
                      Send Command
                    </button>
                    <button
                      className="ghost"
                      onClick={() => handleCurrent().catch((err) => setError(err.message))}
                    >
                      Refresh Prices
                    </button>
                  </div>
                  <div className="hint">{monitorStatus}</div>
                  {monitorError && <div className="error">{monitorError}</div>}
                  {lastCommand && <pre className="code-block">{lastCommand}</pre>}
                </div>
              </div>
            ) : (
              <div className="empty">Load current prices to generate an action.</div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Why This Action</h2>
              <p className="hint">RL-style attribution for the current policy decision</p>
            </div>
            {monitorDecision && monitorRl ? (
              <div className="rl-explain">
                <div className="summary-grid">
                  <div className="summary-card">
                    <span className="mono">Q(Charge)</span>
                    <strong>{monitorRl.qValues.charge.toFixed(2)}</strong>
                    <span className={`delta ${monitorDecision.action === "charge" ? "pos" : ""}`}>
                      {monitorDecision.action === "charge" ? "Selected" : "Candidate"}
                    </span>
                  </div>
                  <div className="summary-card">
                    <span className="mono">Q(Discharge)</span>
                    <strong>{monitorRl.qValues.discharge.toFixed(2)}</strong>
                    <span className={`delta ${monitorDecision.action === "discharge" ? "pos" : ""}`}>
                      {monitorDecision.action === "discharge" ? "Selected" : "Candidate"}
                    </span>
                  </div>
                  <div className="summary-card">
                    <span className="mono">Q(Hold)</span>
                    <strong>{monitorRl.qValues.hold.toFixed(2)}</strong>
                    <span className={`delta ${monitorDecision.action === "hold" ? "pos" : ""}`}>
                      {monitorDecision.action === "hold" ? "Selected" : "Candidate"}
                    </span>
                  </div>
                  <div className="summary-card">
                    <span className="mono">Policy</span>
                    <strong>
                      C {Math.round(monitorRl.policy.charge * 100)}% · D {Math.round(monitorRl.policy.discharge * 100)}% · H {Math.round(monitorRl.policy.hold * 100)}%
                    </strong>
                    <span>Softmax over Q</span>
                  </div>
                  <div className="summary-card">
                    <span className="mono">Immediate Reward</span>
                    <strong>{monitorRl.immediateReward.toFixed(2)} c/kWh</strong>
                    <span>Instant signal</span>
                  </div>
                  <div className="summary-card">
                    <span className="mono">Expected Return</span>
                    <strong>{monitorRl.expectedReturn.toFixed(2)}</strong>
                    <span>Max Q</span>
                  </div>
                </div>

                <div className="rl-grid">
                  <div className="rl-card">
                    <h4>State Summary</h4>
                    <div className="rl-row">
                      <span>Buy</span>
                      <strong>{monitorRl.state.buy.toFixed(2)} c/kWh</strong>
                      <span>{Math.round(monitorRl.state.buyPercentile * 100)}th pct</span>
                    </div>
                    <div className="rl-row">
                      <span>Sell</span>
                      <strong>{monitorRl.state.sell.toFixed(2)} c/kWh</strong>
                      <span>{Math.round(monitorRl.state.sellPercentile * 100)}th pct</span>
                    </div>
                    <div className="rl-row">
                      <span>Forecast Median</span>
                      <strong>{monitorRl.state.buyMedian.toFixed(2)} / {monitorRl.state.sellMedian.toFixed(2)}</strong>
                      <span>Buy / Sell</span>
                    </div>
                    <div className="rl-row">
                      <span>Renewables</span>
                      <strong>
                        {monitorRl.state.renewablesPct !== null
                          ? `${Math.round(monitorRl.state.renewablesPct * 100)}%`
                          : "—"}
                      </strong>
                      <span>Grid mix</span>
                    </div>
                    <div className="rl-row">
                      <span>SOC</span>
                      <strong>{monitorRl.state.socPct.toFixed(0)}%</strong>
                      <span>Reserve {monitorRl.state.reservePct}%</span>
                    </div>
                    <div className="rl-row">
                      <span>Time Slot</span>
                      <strong>{monitorRl.state.timeSlot}</strong>
                      <span>Live tick</span>
                    </div>
                  </div>

                  <div className="rl-card">
                    <h4>Constraints</h4>
                    <div className="rl-row">
                      <span>Charge OK</span>
                      <strong className={monitorRl.constraints.socOkToCharge ? "pos" : "neg"}>
                        {monitorRl.constraints.socOkToCharge ? "YES" : "NO"}
                      </strong>
                      <span>Max {monitorRl.constraints.maxChargeKw} kW</span>
                    </div>
                    <div className="rl-row">
                      <span>Discharge OK</span>
                      <strong className={monitorRl.constraints.socOkToDischarge ? "pos" : "neg"}>
                        {monitorRl.constraints.socOkToDischarge ? "YES" : "NO"}
                      </strong>
                      <span>Max {monitorRl.constraints.maxDischargeKw} kW</span>
                    </div>
                    <div className="rl-row">
                      <span>Spread</span>
                      <strong>{monitorRl.state.spread.toFixed(1)}</strong>
                      <span>Forecast range</span>
                    </div>
                  </div>

                  <div className="rl-card">
                    <h4>Counterfactual</h4>
                    <div className="rl-row">
                      <span>Charge vs Hold</span>
                      <strong>{monitorRl.advantage.charge.toFixed(2)}</strong>
                      <span>ΔQ</span>
                    </div>
                    <div className="rl-row">
                      <span>Discharge vs Hold</span>
                      <strong>{monitorRl.advantage.discharge.toFixed(2)}</strong>
                      <span>ΔQ</span>
                    </div>
                    <div className="rl-row">
                      <span>Decision</span>
                      <strong>{monitorDecision.action.toUpperCase()}</strong>
                      <span>Highest expected return</span>
                    </div>
                  </div>
                </div>

                <div className="rl-notes">
                  <h4>Natural Language Rationale</h4>
                  <ul className="reason-list">
                    {monitorDecision.reasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="empty">No decision yet.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
