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
import { predictSolar, trainSolarRegression } from "./engine/solar_model";
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
  WeatherChart,
} from "./gui/charts";
import { CurrentMarketAxis } from "./gui/CurrentMarketAxis";

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

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const currentAutoRef = useRef(false);
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
      range.start,
      range.end,
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
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (loadingRef.current.current) return;
      handleCurrent().catch((err) => setError(err.message));
    }, 120000);
    return () => window.clearInterval(interval);
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
    const adjusted = weatherEnabled ? applyCloudCover(base, cloudCover) : base;
    setSolarCurve(adjusted);
  }, [payload, solarProfile, cloudCover, weatherEnabled]);

  useEffect(() => {
    if (!payload || !weatherEnabled) return;
    setWeatherStatus("Fetching weather...");
    fetchCloudCover(apiBase, anonKey, {
      startDate: range.start,
      endDate: range.end,
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
    if (solarForecast.mode === "arima") {
      forecastTemps = arimaForecast(temps, temps.length);
    } else if (solarForecast.mode === "prophet") {
      forecastTemps = prophetForecast(temps, temps.length, 24);
    } else if (solarForecast.mode === "regression") {
      if (!usagePayload?.length || !cloudCover.length) {
        forecastTemps = temps;
      } else {
        const intervalHours =
          payload && payload.length > 1
            ? Math.abs(
                (new Date(payload[1].startTime).getTime() -
                  new Date(payload[0].startTime).getTime()) /
                  (1000 * 60 * 60),
              )
            : range.resolution / 60;
        const samples = usagePayload
          .filter((row) => row.channelType === "feedIn")
          .map((row) => ({
            time: row.startTime,
            cloudCover:
              cloudCover.find((point) => point.time.slice(0, 13) === row.startTime.slice(0, 13))
                ?.value ?? 0,
            solarKw: row.kwh / intervalHours,
          }));
        const model = trainSolarRegression(samples);
        forecastTemps = model
          ? predictSolar(model, solarCurve.map((point) => point.time), cloudCover)
          : temps;
      }
    } else {
      forecastTemps = temps.map((value) => value * solarForecast.multiplier);
    }
    if (!forecastTemps.length) return null;
    const padded = forecastTemps.length < temps.length
      ? temps.slice(0, temps.length - forecastTemps.length).concat(forecastTemps)
      : forecastTemps.slice(0, temps.length);
    return solarCurve.map((point, idx) => {
      const adjusted = padded[idx] ?? point.value;
      return {
        time: point.time,
        value: adjusted,
      };
    });
  }, [solarCurve, solarForecast, usagePayload, payload, range.resolution, cloudCover]);

  const cloudCoverCurve = useMemo(() => cloudCover, [cloudCover]);
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
  const backtestSignals = useMemo(() => {
    if (!activeDiagnostics) return [];
    const signals: string[] = [];
    if (activeDiagnostics.days < 2) {
      signals.push("Sample window is short. Extend the range for more reliable signals.");
    }
    if (activeDiagnostics.missingIntervals > 0) {
      signals.push(`Data gaps detected. Consider reloading prices to fill ${activeDiagnostics.missingIntervals} missing intervals.`);
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

  const monitorSeries = useMemo(() => {
    const source = payload?.length ? payload : currentPrice?.length ? currentPrice : [];
    if (!source.length) return { buy: [], sell: [], lastTime: null as string | null };
    const maxHistory = Math.max(48, Math.round((24 * 7 * 60) / range.resolution));
    const sliced = source.slice(-maxHistory);
    return buildSeries(sliced);
  }, [payload, currentPrice, range.resolution]);

  const bestStrategyName = bestLeaderboard || active?.name || "";
  const bestStrategyNote = bestStrategyName ? noteForStrategy(bestStrategyName) : "";

  const monitorInputs = useMemo(
    () => ({
      currentBuy: currentSummary?.general?.perKwh ?? null,
      currentSell: currentSummary?.feedIn ? Math.abs(currentSummary.feedIn.perKwh) : null,
      buySeries: monitorSeries.buy,
      sellSeries: monitorSeries.sell,
      lastTimeIso: monitorSeries.lastTime,
      resolutionMinutes: range.resolution,
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
      range.resolution,
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
        resolutionMinutes: range.resolution,
      }),
    [monitorSeries.buy, monitorSeries.sell, monitorSeries.lastTime, currentSummary?.timestamp, range.resolution],
  );

  const monitorDecision: MonitorDecision | null = useMemo(() => {
    if (!monitorInputs.currentBuy && !monitorInputs.currentSell) return null;
    return decideMonitorAction(monitorInputs, monitorForecast);
  }, [monitorInputs, monitorForecast]);

  const monitorTimeline = useMemo(
    () => buildDecisionTimeline(monitorForecast, monitorInputs),
    [monitorForecast, monitorInputs],
  );

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
      const startDate = range.start.split("T")[0];
      const endDate = range.end.split("T")[0];
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
    try {
      const headers = buildAmberHeaders(token, anonKey);
      const [current5, current30] = await Promise.all([
        fetchCurrent(
          apiBase,
          {
            siteId,
            previous: "0",
            next: "4",
            resolution: "5",
          },
          headers,
        ),
        fetchCurrent(
          apiBase,
          {
            siteId,
            previous: "0",
            next: "4",
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
          <>
            <div className="axis-stack">
              <CurrentMarketAxis title="Live 5-min" rows={currentPrice} variant="solid" />
              <CurrentMarketAxis title="Live 30-min" rows={currentPrice30} variant="ghost" />
            </div>
          </>
        ) : (
          <div className="empty">Click “Current Prices” to load.</div>
        )}
      </section>

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
              value={range.start}
              onChange={(e) => setRange({ ...range, start: e.target.value })}
            />
          </div>
          <div className="field">
            <label>End</label>
            <input
              type="date"
              value={range.end}
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

        <div className="panel">
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

      <section className="panel">
        <div className="panel-header">
          <h2>Backtest Command Center</h2>
          <p className="hint">Performance, data quality, efficiency, and optimization signals</p>
        </div>
        {activeDiagnostics ? (
          <>
            <div className="summary-grid">
              <div className="summary-card">
                <span className="mono">Quality Score</span>
                <strong className="quality-score">{activeDiagnostics.qualityScore.toFixed(0)}</strong>
                <span>0–100 composite</span>
              </div>
              <div className="summary-card">
                <span className="mono">Total Profit</span>
                <strong>{formatProfit(activeDiagnostics.profit)}</strong>
                <span>{range.start} → {range.end}</span>
              </div>
              <div className="summary-card">
                <span className="mono">Avg Daily Profit</span>
                <strong>{formatProfit(activeDiagnostics.avgDailyProfit)}</strong>
                <span>
                  {activeDiagnostics.days} days · {range.resolution} min
                </span>
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
                <span className="mono">Coverage</span>
                <strong>{(activeDiagnostics.coveragePct * 100).toFixed(1)}%</strong>
                <span>
                  {activeDiagnostics.missingIntervals > 0
                    ? `${activeDiagnostics.missingIntervals} missing`
                    : "No gaps detected"}
                </span>
              </div>
              <div className="summary-card">
                <span className="mono">Profit / kWh</span>
                <strong>{formatProfit(activeDiagnostics.profitPerKwh)}</strong>
                <span>Throughput efficiency</span>
              </div>
              <div className="summary-card">
                <span className="mono">Utilization</span>
                <strong>{(activeDiagnostics.utilizationPct * 100).toFixed(1)}%</strong>
                <div className="meter">
                  <div
                    className="meter-bar"
                    style={{ width: `${Math.min(activeDiagnostics.utilizationPct * 100, 100)}%` }}
                  />
                </div>
                <span>Buy kWh vs capacity</span>
              </div>
              <div className="summary-card">
                <span className="mono">Edge vs Baseline</span>
                <strong
                  className={`delta ${
                    baselineEdge !== null && baselineEdge >= 0 ? "pos" : "neg"
                  }`}
                >
                  {baselineEdge !== null ? formatProfit(baselineEdge) : "—"}
                </strong>
                <span>{baseline?.name || "Baseline"}</span>
              </div>
              <div className="summary-card">
                <span className="mono">Best Strategy</span>
                <strong>{bestComparison || bestLeaderboard || "—"}</strong>
                <span>Highest profit</span>
              </div>
            </div>

            <div className="insight-grid">
              <div className="insight-card">
                <span className="mono">Backtest Health</span>
                <strong className={`health ${healthStatus?.className || ""}`}>
                  {healthStatus?.label || "—"}
                </strong>
                <span>{healthStatus?.detail || "Load data to evaluate."}</span>
              </div>
              {optimizationBrief?.map((item, idx) => (
                <div key={idx} className={`insight-card ${item.tone}`}>
                  <span className="mono">Optimization {idx + 1}</span>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>

            <ul className="insight-list">
              {backtestSignals.map((signal, idx) => (
                <li key={idx}>{signal}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty">Run a backtest to unlock insights.</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Strategy Comparison</h2>
          <p className="hint">Backtest multiple strategies side-by-side</p>
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
        {compareLeft && compareRight ? (
          <CompareChart
            left={compareLeft}
            right={compareRight}
            winner={compareWinner}
            baseline={baseline?.points}
            baselineLabel={baselineName}
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
              }`}
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
              <button className="ghost" onClick={() => handleSites().catch((err) => setError(err.message))}>
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
        </>
      ) : (
        <>
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
              <div className="summary-card">
                <span className="mono">Battery Power</span>
                <strong>{batteryStatus.powerKw.toFixed(1)} kW</strong>
                <span>Charge/Discharge</span>
              </div>
              <div className="summary-card">
                <span className="mono">Max Charge</span>
                <strong>{batteryStatus.maxChargeKw.toFixed(1)} kW</strong>
                <span>Mock limit</span>
              </div>
              <div className="summary-card">
                <span className="mono">Reserve SOC</span>
                <strong>{batteryStatus.reserveSocPct.toFixed(0)}%</strong>
                <span>Safety buffer</span>
              </div>
            </div>
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
              <p className="hint">Backtest lessons translated into live guidance</p>
            </div>
            {monitorDecision ? (
              <ul className="reason-list">
                {monitorDecision.reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            ) : (
              <div className="empty">No decision yet.</div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Decision Timeline</h2>
              <p className="hint">Next 6-12 hours forecasted guidance</p>
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
        </>
      )}
    </div>
  );
}
