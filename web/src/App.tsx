import { useEffect, useMemo, useRef, useState } from "react";

type RawInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
};

type UsageInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
  kwh: number;
  cost: number;
  nemTime?: string;
  date?: string;
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
  inverterMaxKw: number;
  dailyChargeAud: number;
  startSoc: number;
  buyThreshold: number;
  sellThreshold: number;
  windowSize: number;
  buyPercentile: number;
  sellPercentile: number;
  mode: StrategyMode;
};

type CacheEntry = {
  name: string;
  modified: number;
  size: number;
  source?: "local" | "server";
  kind?: "prices" | "usage";
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

type CustomRule = {
  field: "buy" | "sell" | "hour" | "solar";
  op: "<" | "<=" | ">" | ">=";
  value: number;
};

type WeatherPoint = {
  time: string;
  temperature: number;
};

type DailySolarPoint = {
  date: string;
  simulatedKwh: number;
  actualKwh: number | null;
};

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
  const [windowStart, setWindowStart] = useState(0);
  const [windowSize, setWindowSize] = useState(240);
  const [maxPoints, setMaxPoints] = useState(400);
  const [currentPrice, setCurrentPrice] = useState<RawInterval[] | null>(null);
  const [usagePayload, setUsagePayload] = useState<UsageInterval[] | null>(null);
  const [apiSnapshots, setApiSnapshots] = useState({
    sites: null as unknown,
    prices: null as unknown,
    current: null as unknown,
    usage: null as unknown,
  });
  const [solarProfile, setSolarProfile] = useState({
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
  const [llmConfig, setLlmConfig] = useState({
    enabled: false,
    model: "deepseek/deepseek-r1-0528:free",
    cadence: "per-hour",
    outputFormat: `{"action":"buy|sell|hold","confidence":0.0,"reason":"..."}`,
  });
  const [llmResponse, setLlmResponse] = useState<string>("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmShowRaw, setLlmShowRaw] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [solarModalOpen, setSolarModalOpen] = useState(false);
  const [llmOverlay, setLlmOverlay] = useState({
    enabled: true,
    bands: true,
    arrows: true,
    opacity: 0.18,
  });
  const [rlConfig, setRlConfig] = useState({
    enabled: false,
    state: {
      price: true,
      soc: true,
      solar: true,
      time: true,
    },
    actionSpace: "discrete",
    training: "offline",
    baseline: "q-learning",
  });

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

  function storageAvailable() {
    try {
      return typeof window !== "undefined" && "localStorage" in window;
    } catch {
      return false;
    }
  }

  function loadLocalCaches() {
    if (!storageAvailable()) return [];
    try {
      const raw = localStorage.getItem("amberLocalCaches");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((entry: CacheEntry) => ({ ...entry, source: "local" as const }))
        : [];
    } catch {
      return [];
    }
  }

  function persistLocalCaches(caches: CacheEntry[]) {
    if (!storageAvailable()) return;
    try {
      localStorage.setItem("amberLocalCaches", JSON.stringify(caches));
    } catch {
      return;
    }
  }

  function saveLocalCache(kind: "prices" | "usage", data: unknown) {
    if (!storageAvailable()) return;
    const base = `${kind}_${range.start}_${range.end}`;
    const existing = new Set(localCaches.map((entry) => entry.name));
    const name = existing.has(base) ? `${base}_${Date.now()}` : base;
    const body = JSON.stringify(data, null, 2);
    try {
      localStorage.setItem(`amberLocalCache:${name}`, body);
    } catch {
      return;
    }
    const entry: CacheEntry = {
      name,
      modified: Date.now(),
      size: body.length,
      source: "local",
      kind,
    };
    const next = [entry, ...localCaches];
    setLocalCaches(next);
    persistLocalCaches(next);
    setSelectedCache(cacheId(entry));
  }

  async function copyJson(data: unknown) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard unavailable in this browser.");
    }
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  }

  useEffect(() => {
    workerRef.current = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    return () => workerRef.current?.terminate();
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
    if (!apiBase) return;
    setLocalCaches(loadLocalCaches());
    if (apiBase.includes("functions.supabase.co")) return;
    fetch(apiPath("/caches"), {
      headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
    })
      .then((resp) => (resp.ok ? resp.json() : []))
      .then((data: CacheEntry[]) => {
        const list = (Array.isArray(data) ? data : []).map((entry) => ({
          ...entry,
          source: "server" as const,
        }));
        setServerCaches(list);
      })
      .catch(() => setServerCaches([]));
  }, [apiBase, anonKey]);

  useEffect(() => {
    const combined = [...localCaches, ...serverCaches];
    if (!combined.length) return;
    setSelectedCache((prev) => prev || cacheId(combined[0]));
  }, [localCaches, serverCaches]);

  useEffect(() => {
    if (!payload) return;
    const curve = payload.map((item) => ({
      time: item.startTime,
      temperature: solarForTime(new Date(item.startTime), solarProfile),
    }));
    setSolarCurve(curve);
  }, [payload, solarProfile]);

  const solarForecastCurve = useMemo(() => {
    if (!solarCurve.length || !solarForecast.enabled) return null;
    const temps = solarCurve.map((point) => point.temperature);
    let forecastTemps = temps;
    if (solarForecast.mode === "arima") {
      forecastTemps = arimaForecast(temps, temps.length);
    } else if (solarForecast.mode === "prophet") {
      forecastTemps = prophetForecast(temps, temps.length, 24);
    } else {
      forecastTemps = temps.map((value) => value * solarForecast.multiplier);
    }
    if (!forecastTemps.length) return null;
    const padded = forecastTemps.length < temps.length
      ? temps.slice(0, temps.length - forecastTemps.length).concat(forecastTemps)
      : forecastTemps.slice(0, temps.length);
    return solarCurve.map((point, idx) => ({
      time: point.time,
      temperature: padded[idx] ?? point.temperature,
    }));
  }, [solarCurve, solarForecast]);

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

  const leaderboard = useMemo(() => {
    return strategies
      .map((s) => ({
        name: s.name,
        profit: s.summary.profit,
        drawdown: maxDrawdown(s.points.map((p) => p.cumulativeProfit)),
        winRate: winRate(s.points.map((p) => p.cumulativeProfit)),
      }))
      .map((row) => {
        const score = row.profit - row.drawdown * 0.5 + row.winRate * 10;
        return { ...row, score, comment: strategyComment(row.profit, row.drawdown, row.winRate) };
      })
      .sort((a, b) => b.score - a.score);
  }, [strategies]);

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
    return {
      buy: {
        kde: kdeEstimate(buy, 64),
        box: boxStats(buy),
      },
      sell: {
        kde: kdeEstimate(sell, 64),
        box: boxStats(sell),
      },
    };
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
      const query = new URLSearchParams({
        startDate,
        endDate,
        resolution: String(range.resolution),
        siteId,
      }).toString();

      const headers: Record<string, string> = {};
      if (token) headers["x-amber-token"] = token;
      if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
      const resp = await fetch(`${apiPath("/prices")}?${query}`, { headers });
      if (!resp.ok) {
        const fallbackQuery = new URLSearchParams({
          siteId,
          previous: "96",
          next: "96",
          resolution: String(range.resolution),
        }).toString();
        const fallback = await fetch(`${apiPath("/current")}?${fallbackQuery}`, { headers });
        if (!fallback.ok) {
          const text = await resp.text();
          throw new Error(`API error ${resp.status}: ${text}`);
        }
        const json = await fallback.json();
        setApiSnapshots((prev) => ({ ...prev, prices: json }));
        const data = Array.isArray(json) ? json : json.data;
        setPayload(data as RawInterval[]);
        return;
      }
      const json = await resp.json();
      setApiSnapshots((prev) => ({ ...prev, prices: json }));
      const data = Array.isArray(json) ? json : json.data;
      setPayload(data as RawInterval[]);
      try {
        const usageResp = await fetch(`${apiPath("/usage")}?${query}`, { headers });
        if (usageResp.ok) {
          const usageJson = await usageResp.json();
          setApiSnapshots((prev) => ({ ...prev, usage: usageJson }));
          const usageData = Array.isArray(usageJson) ? usageJson : usageJson.data;
          setUsagePayload(usageData as UsageInterval[]);
        } else {
          setUsagePayload(null);
        }
      } catch {
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
      const query = new URLSearchParams({
        siteId,
        previous: "0",
        next: "4",
        resolution: String(range.resolution),
      }).toString();
      const headers: Record<string, string> = {};
      if (token) headers["x-amber-token"] = token;
      if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
      const resp = await fetch(`${apiPath("/current")}?${query}`, { headers });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Current prices error ${resp.status}: ${text}`);
      }
      const json = await resp.json();
      setApiSnapshots((prev) => ({ ...prev, current: json }));
      setCurrentPrice(json);
    } finally {
      setLoading((prev) => ({ ...prev, current: false }));
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
    const series = (payload || currentPrice || []).slice(-24).map((item) => ({
      startTime: item.startTime,
      general: item.channelType === "general" ? item.perKwh : undefined,
      feedIn: item.channelType === "feedIn" ? item.perKwh : undefined,
    }));
    const prompt = {
      cadence: llmConfig.cadence,
      outputFormat: llmConfig.outputFormat,
      stateFeatures: ["price", "soc", "solar", "time"],
      config: {
        capacityKwh: config.capacityKwh,
        maxPowerKw: config.maxPowerKw,
        dailyChargeAud: config.dailyChargeAud,
      },
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
    const resp = await fetch(apiPath("/sites"), {
      headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
    });
    if (!resp.ok) throw new Error("Failed to fetch sites.");
    const json = await resp.json();
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
        const raw = localStorage.getItem(`amberLocalCache:${entry.name}`);
        if (!raw) throw new Error("Local cache missing.");
        const json = JSON.parse(raw);
        if (entry.kind === "usage") {
          setApiSnapshots((prev) => ({ ...prev, usage: json }));
          setUsagePayload(json as UsageInterval[]);
        } else {
          setApiSnapshots((prev) => ({ ...prev, prices: json }));
          const data = Array.isArray(json) ? json : json.data;
          setPayload(data as RawInterval[]);
        }
      } else {
        const resp = await fetch(`${apiPath("/cache")}?name=${encodeURIComponent(entry.name)}`, {
          headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
        });
        if (!resp.ok) {
          throw new Error("Failed to load cache file.");
        }
        const json = await resp.json();
        setApiSnapshots((prev) => ({ ...prev, prices: json }));
        const data = Array.isArray(json) ? json : json.data;
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
              className="primary"
              onClick={() => handleFetch().catch((err) => setError(err.message))}
              disabled={loading.fetch}
            >
              {loading.fetch ? (
                <>
                  <span className="spinner" /> Fetching...
                </>
              ) : (
                "Fetch from Amber"
              )}
            </button>
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
          {strategies.map((strategy) => (
            <div
              key={strategy.name}
              className={`table-row${strategy.name === baselineName ? " baseline" : ""}`}
              title={noteForStrategy(strategy.name)}
            >
              <span className="strategy-name">
                {strategy.name}
                <i className="note" title={noteForStrategy(strategy.name)}>ⓘ</i>
              </span>
              <span>{formatProfit(strategy.summary.profit)}</span>
              <span>{strategy.summary.buyKwh.toFixed(1)}</span>
              <span>{strategy.summary.sellKwh.toFixed(1)}</span>
              <span>{strategy.summary.endSoc.toFixed(1)}</span>
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
              }
            }}
          >
            Parse DSL
          </button>
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
          </div>
        </div>
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

      <section className="panel">
        <div className="panel-header">
          <h2>RL Strategy (Baseline Setup)</h2>
          <p className="hint">Configure reinforcement learning inputs and training mode</p>
        </div>
        <div className="field">
          <label>Enable RL training</label>
          <label className="check">
            <input
              type="checkbox"
              checked={rlConfig.enabled}
              onChange={(e) => setRlConfig({ ...rlConfig, enabled: e.target.checked })}
            />
            <span>Use RL agent for backtesting</span>
          </label>
        </div>
        <div className="field">
          <label>State features</label>
          <div className="row">
            {[
              { key: "price", label: "Price" },
              { key: "soc", label: "SOC" },
              { key: "solar", label: "Solar" },
              { key: "time", label: "Time" },
            ].map((item) => (
              <label key={item.key} className="check">
                <input
                  type="checkbox"
                  checked={rlConfig.state[item.key as keyof typeof rlConfig.state]}
                  onChange={(e) =>
                    setRlConfig({
                      ...rlConfig,
                      state: { ...rlConfig.state, [item.key]: e.target.checked },
                    })
                  }
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Action space</label>
          <select
            value={rlConfig.actionSpace}
            onChange={(e) => setRlConfig({ ...rlConfig, actionSpace: e.target.value })}
          >
            <option value="discrete">Discrete (buy / sell / hold)</option>
            <option value="continuous">Continuous (power dispatch)</option>
          </select>
        </div>
        <div className="field">
          <label>Training mode</label>
          <select
            value={rlConfig.training}
            onChange={(e) => setRlConfig({ ...rlConfig, training: e.target.value })}
          >
            <option value="offline">Offline (historical replay)</option>
            <option value="online">Online (live learning)</option>
            <option value="evaluation">Evaluation only</option>
          </select>
        </div>
        <div className="field">
          <label>Baseline algorithm</label>
          <select
            value={rlConfig.baseline}
            onChange={(e) => setRlConfig({ ...rlConfig, baseline: e.target.value })}
          >
            <option value="q-learning">Q-Learning (tabular)</option>
            <option value="policy-gradient">Policy Gradient</option>
          </select>
        </div>
        <div className="hint">
          RL execution is a placeholder for now; wiring will follow after backend training is added.
        </div>
      </section>

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
            <div key={row.name} className="table-row">
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
          {solarCurve.length ? (
            <>
              <SolarDailyChart points={solarDaily} />
              <div className="divider" />
              <WeatherChart
                points={solarCurve}
                label="Solar kW"
                overlay={solarForecastCurve ?? undefined}
                overlayLabel={
                  solarForecast.mode === "arima"
                    ? "Forecast (ARIMA)"
                    : solarForecast.mode === "prophet"
                      ? "Forecast (Prophet)"
                      : "Forecast (Scale)"
                }
              />
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
                    points={solarCurve}
                    label="Solar kW"
                    overlay={solarForecastCurve ?? undefined}
                    overlayLabel={
                      solarForecast.mode === "arima"
                        ? "Forecast (ARIMA)"
                        : solarForecast.mode === "prophet"
                          ? "Forecast (Prophet)"
                          : "Forecast (Scale)"
                    }
                    width={960}
                    height={320}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Current Market Snapshot</h2>
        {currentPrice ? (
          <div className="current-grid">
            {currentPrice.map((item, idx) => (
              <div key={`${item.channelType}-${idx}`} className="current-card">
                <span className="mono">{item.channelType}</span>
                <strong>{item.perKwh.toFixed(2)} c/kWh</strong>
                <span>{item.startTime}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Click “Current Prices” to load.</div>
        )}
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
    </div>
  );
}

function Chart({
  points,
  ranges,
  baseline,
  llmOverlay,
  llmResponse,
}: {
  points: BacktestPoint[];
  ranges: {
    buy: [number, number];
    sell: [number, number];
    soc: [number, number];
    profit: [number, number];
    baseline: [number, number];
  };
  baseline?: BacktestPoint[];
  llmOverlay?: {
    enabled: boolean;
    bands: boolean;
    arrows: boolean;
    opacity: number;
  };
  llmResponse?: string;
}) {
  const width = 860;
  const height = 280;
  const padding = 32;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const [buyMin, buyMax] = ranges.buy;
  const [sellMin, sellMax] = ranges.sell;
  const [socMin, socMax] = ranges.soc;
  const [profitMin, profitMax] = ranges.profit;
  const [baseMin, baseMax] = ranges.baseline;

  const buyPath = buildPath(points, (p) =>
    scale(p.buy, buyMin, buyMax, height - padding, padding),
    padding,
    xStep,
  );
  const sellPath = buildPath(points, (p) =>
    scale(p.sell, sellMin, sellMax, height - padding, padding),
    padding,
    xStep,
  );
  const socPath = buildPath(points, (p) =>
    scale(p.soc, socMin, socMax, height - padding, padding),
    padding,
    xStep,
  );
  const profitPath = buildPath(points, (p) =>
    scale(p.cumulativeProfit, profitMin, profitMax, height - padding, padding),
    padding,
    xStep,
  );
  const baselinePath =
    baseline && baseline.length
      ? buildPath(baseline, (p) =>
          scale(p.cumulativeProfit, baseMin, baseMax, height - padding, padding),
        padding,
        xStep,
      )
      : "";

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX =
    hoverIndex !== null ? padding + hoverIndex * xStep : padding;

  const overlaySegments = llmOverlay?.enabled
    ? buildActionSegments(points, llmResponse)
    : [];
  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <defs>
          <linearGradient id="buyLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#61e4ff" />
            <stop offset="100%" stopColor="#2b8dff" />
          </linearGradient>
          <linearGradient id="sellLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#ffd36b" />
            <stop offset="100%" stopColor="#ff6b4a" />
          </linearGradient>
          <linearGradient id="socLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#d4ff80" />
            <stop offset="100%" stopColor="#21c98a" />
          </linearGradient>
          <linearGradient id="profitLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#f472b6" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="18"
          fill="rgba(15, 23, 42, 0.3)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {llmOverlay?.enabled &&
          llmOverlay.bands &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep;
            const w = Math.max(1, (seg.end - seg.start + 1) * xStep);
            return (
              <rect
                key={`band-${idx}`}
                x={x}
                y={padding}
                width={w}
                height={height - padding * 2}
                fill={actionColor(seg.action, llmOverlay.opacity)}
              />
            );
          })}
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.45)"
            strokeDasharray="4 6"
          />
        )}
        <path d={buyPath} stroke="url(#buyLine)" strokeWidth="2" fill="none" />
        <path d={sellPath} stroke="url(#sellLine)" strokeWidth="2" fill="none" />
        <path d={socPath} stroke="url(#socLine)" strokeWidth="2" fill="none" />
        <path d={profitPath} stroke="url(#profitLine)" strokeWidth="2" fill="none" />
        {baselinePath && (
          <path d={baselinePath} stroke="#facc15" strokeWidth="2" fill="none" strokeDasharray="6 4" />
        )}
        {llmOverlay?.enabled &&
          llmOverlay.arrows &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep + 6;
            const y = padding + 12;
            return (
              <text
                key={`arrow-${idx}`}
                x={x}
                y={y}
                fill={actionColor(seg.action, 1)}
                fontSize="12"
              >
                {seg.action === "buy" ? "▲" : seg.action === "sell" ? "▼" : "•"}
              </text>
            );
          })}
      </svg>
      <div className="legend">
        <span className="legend-item">
          <i className="dot buy" /> Buy price
        </span>
        <span className="legend-item">
          <i className="dot sell" /> Sell price
        </span>
        <span className="legend-item">
          <i className="dot soc" /> SOC
        </span>
        <span className="legend-item">
          <i className="dot profit" /> Profit
        </span>
        {baselinePath && (
          <span className="legend-item">
            <i className="dot baseline" /> Baseline
          </span>
        )}
      </div>
      {hoverPoint && (
        <div className="tooltip">
          <span className="mono">{new Date(hoverPoint.time).toISOString()}</span>
          <span>Buy: {hoverPoint.buy.toFixed(2)} c</span>
          <span>Sell: {hoverPoint.sell.toFixed(2)} c</span>
          <span>SOC: {hoverPoint.soc.toFixed(2)} kWh</span>
          <span>P/L: {hoverPoint.cumulativeProfit.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function CompareChart({
  left,
  right,
  winner,
  baseline,
  baselineLabel,
  llmOverlay,
  llmResponse,
}: {
  left: StrategyResult;
  right: StrategyResult;
  winner: string;
  baseline?: BacktestPoint[];
  baselineLabel?: string;
  llmOverlay?: {
    enabled: boolean;
    bands: boolean;
    arrows: boolean;
    opacity: number;
  };
  llmResponse?: string;
}) {
  const width = 860;
  const height = 260;
  const padding = 32;
  const maxLen = Math.min(left.points.length, right.points.length);
  const leftPoints = left.points.slice(0, maxLen);
  const rightPoints = right.points.slice(0, maxLen);
  const baselinePoints = baseline ? baseline.slice(0, maxLen) : null;
  const values = [
    ...leftPoints,
    ...rightPoints,
    ...(baselinePoints ?? []),
  ].map((p) => p.cumulativeProfit);
  const [min, max] = rangeValues(values);
  const xStep = (width - padding * 2) / (maxLen - 1 || 1);
  const leftPath = leftPoints
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.cumulativeProfit, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const rightPath = rightPoints
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.cumulativeProfit, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const leftColor = left.name === winner ? "#34d399" : "#60a5fa";
  const rightColor = right.name === winner ? "#34d399" : "#f97316";
  const baselinePath =
    baselinePoints && baselinePoints.length
      ? baselinePoints
          .map((p, i) => {
            const x = padding + i * xStep;
            const y = scale(p.cumulativeProfit, min, max, height - padding, padding);
            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
          })
          .join(" ")
      : "";
  const overlaySegments = llmOverlay?.enabled
    ? buildActionSegments(leftPoints, llmResponse)
    : [];
  return (
    <div className="chart compare-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="18"
          fill="rgba(15, 23, 42, 0.3)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {llmOverlay?.enabled &&
          llmOverlay.bands &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep;
            const w = Math.max(1, (seg.end - seg.start + 1) * xStep);
            return (
              <rect
                key={`cmp-band-${idx}`}
                x={x}
                y={padding}
                width={w}
                height={height - padding * 2}
                fill={actionColor(seg.action, llmOverlay.opacity)}
              />
            );
          })}
        <path d={leftPath} stroke={leftColor} strokeWidth="2.5" fill="none" />
        <path d={rightPath} stroke={rightColor} strokeWidth="2.5" fill="none" />
        {baselinePath && (
          <path d={baselinePath} stroke="#facc15" strokeWidth="2" fill="none" strokeDasharray="6 4" />
        )}
        {llmOverlay?.enabled &&
          llmOverlay.arrows &&
          overlaySegments.map((seg, idx) => {
            const x = padding + seg.start * xStep + 6;
            const y = padding + 12;
            return (
              <text
                key={`cmp-arrow-${idx}`}
                x={x}
                y={y}
                fill={actionColor(seg.action, 1)}
                fontSize="12"
              >
                {seg.action === "buy" ? "▲" : seg.action === "sell" ? "▼" : "•"}
              </text>
            );
          })}
        <text x={12} y={16} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={12} y={height - 8} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      <div className="legend">
        <span className="legend-item">
          <i className="dot" style={{ background: leftColor }} /> {left.name}
        </span>
        <span className="legend-item">
          <i className="dot" style={{ background: rightColor }} /> {right.name}
        </span>
        {baselinePath && (
          <span className="legend-item">
            <i className="dot baseline" /> {baselineLabel || "Baseline"}
          </span>
        )}
      </div>
    </div>
  );
}

function LineChart({
  points,
  dataKey,
  color,
  label,
}: {
  points: BacktestPoint[];
  dataKey: "cumulativeProfit" | "soc";
  color: string;
  label: string;
}) {
  const width = 420;
  const height = 220;
  const padding = 32;
  const values = points.map((p) => p[dataKey]);
  const [min, max] = rangeValues(values);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p[dataKey], min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="14"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.5)"
            strokeDasharray="4 6"
          />
        )}
        <path d={path} stroke={color} strokeWidth="2.5" fill="none" />
        <text x={10} y={18} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={10} y={height - 10} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      {hoverPoint && (
        <div className="mini-tooltip">
          <span className="mono">{new Date(hoverPoint.time).toISOString()}</span>
          <span>
            {label}: {hoverPoint[dataKey].toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}

function KdeBoxPlot({
  buy,
  sell,
}: {
  buy: { kde: KDEPoint[]; box: BoxStats };
  sell: { kde: KDEPoint[]; box: BoxStats };
}) {
  return (
    <div className="histogram">
      <div>
        <span className="hint">Buy price</span>
        <KDEChart points={buy.kde} color="#38bdf8" />
        <BoxPlot stats={buy.box} color="#38bdf8" />
      </div>
      <div>
        <span className="hint">Sell price</span>
        <KDEChart points={sell.kde} color="#fb7185" />
        <BoxPlot stats={sell.box} color="#fb7185" />
      </div>
    </div>
  );
}

type KDEPoint = { x: number; y: number };
type BoxStats = { min: number; q1: number; median: number; q3: number; max: number };

function KDEChart({ points, color }: { points: KDEPoint[]; color: string }) {
  const width = 360;
  const height = 120;
  const padding = 16;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX] = rangeValues(xs);
  const [minY, maxY] = rangeValues(ys);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.y, minY, maxY, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="10"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.45)"
            strokeDasharray="4 6"
          />
        )}
        <path d={path} stroke={color} strokeWidth="2" fill="none" />
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {maxY.toFixed(2)}
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          {minY.toFixed(2)}
        </text>
        <text x={padding} y={height - 6} fill="#94a3b8" fontSize="9">
          {minX.toFixed(1)}
        </text>
        <text x={width - padding} y={height - 6} fill="#94a3b8" fontSize="9" textAnchor="end">
          {maxX.toFixed(1)}
        </text>
      </svg>
      {hoverPoint && (
        <div className="mini-tooltip">
          <span>
            x: {hoverPoint.x.toFixed(2)} | y: {hoverPoint.y.toFixed(4)}
          </span>
        </div>
      )}
    </div>
  );
}

function BoxPlot({ stats, color }: { stats: BoxStats; color: string }) {
  const width = 360;
  const height = 60;
  const padding = 20;
  const scaleX = (value: number) =>
    padding + ((value - stats.min) / (stats.max - stats.min || 1)) * (width - padding * 2);
  const minX = scaleX(stats.min);
  const maxX = scaleX(stats.max);
  const q1X = scaleX(stats.q1);
  const q3X = scaleX(stats.q3);
  const medX = scaleX(stats.median);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <line x1={minX} x2={maxX} y1={height / 2} y2={height / 2} stroke={color} />
      <rect
        x={q1X}
        y={height / 2 - 10}
        width={q3X - q1X}
        height={20}
        fill="rgba(148, 163, 184, 0.2)"
        stroke={color}
      />
      <line x1={medX} x2={medX} y1={height / 2 - 12} y2={height / 2 + 12} stroke={color} />
      <text x={minX} y={height - 6} fill="#94a3b8" fontSize="9">
        {stats.min.toFixed(1)}
      </text>
      <text x={medX} y={height - 6} fill="#94a3b8" fontSize="9" textAnchor="middle">
        {stats.median.toFixed(1)}
      </text>
      <text x={maxX} y={height - 6} fill="#94a3b8" fontSize="9" textAnchor="end">
        {stats.max.toFixed(1)}
      </text>
    </svg>
  );
}

function ForecastPanel({
  forecasts,
}: {
  forecasts: { buy: number[]; sell: number[]; profit: number[] };
}) {
  return (
    <div className="forecast-grid">
      <div>
        <span className="hint">Buy trend</span>
        <ForecastLine values={forecasts.buy} color="#38bdf8" />
      </div>
      <div>
        <span className="hint">Sell trend</span>
        <ForecastLine values={forecasts.sell} color="#f97316" />
      </div>
      <div>
        <span className="hint">Profit trend</span>
        <ForecastLine values={forecasts.profit} color="#c084fc" />
      </div>
    </div>
  );
}

function ForecastLine({ values, color }: { values: number[]; color: string }) {
  const width = 240;
  const height = 120;
  const padding = 16;
  const [min, max] = rangeValues(values);
  const xStep = (width - padding * 2) / (values.length - 1 || 1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const path = values
    .map((value, i) => {
      const x = padding + i * xStep;
      const y = scale(value, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const hoverValue = hoverIndex !== null ? values[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < values.length) {
            setHoverIndex(index);
          }
        }}
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.45)"
            strokeDasharray="4 6"
          />
        )}
        <path d={path} stroke={color} strokeWidth="2" fill="none" />
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      {hoverValue !== null && (
        <div className="mini-tooltip">
          <span>Step {hoverIndex} · {hoverValue.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function WeatherChart({
  points,
  label,
  overlay,
  overlayLabel,
  width = 420,
  height = 200,
}: {
  points: WeatherPoint[];
  label: string;
  overlay?: WeatherPoint[];
  overlayLabel?: string;
  width?: number;
  height?: number;
}) {
  const padding = 24;
  const temps = points.map((p) => p.temperature);
  const overlayTemps = overlay ? overlay.map((p) => p.temperature) : [];
  const allTemps = temps.concat(overlayTemps);
  const [min, max] = rangeValues(allTemps.length ? allTemps : temps);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.temperature, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const overlayPath =
    overlay && overlay.length
      ? overlay
          .map((p, i) => {
            const x = padding + i * xStep;
            const y = scale(p.temperature, min, max, height - padding, padding);
            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
          })
          .join(" ")
      : "";
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverOverlay = hoverIndex !== null && overlay ? overlay[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? padding + hoverIndex * xStep : padding;
  return (
    <div className="mini-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = (event.target as SVGSVGElement).getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = Math.round((x - padding) / xStep);
          if (index >= 0 && index < points.length) {
            setHoverIndex(index);
          }
        }}
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {hoverIndex !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding}
            y2={height - padding}
            stroke="rgba(148, 163, 184, 0.45)"
            strokeDasharray="4 6"
          />
        )}
        <path d={path} stroke="#22d3ee" strokeWidth="2" fill="none" />
        {overlayPath && (
          <path
            d={overlayPath}
            stroke="#facc15"
            strokeWidth="2"
            fill="none"
            strokeDasharray="5 4"
          />
        )}
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {max.toFixed(2)}
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          {min.toFixed(2)}
        </text>
      </svg>
      {hoverPoint && (
        <div className="mini-tooltip">
          <span className="mono">{hoverPoint.time}</span>
          <span>{label}: {hoverPoint.temperature.toFixed(2)}</span>
          {hoverOverlay && overlayLabel && (
            <span>{overlayLabel}: {hoverOverlay.temperature.toFixed(2)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function SolarDailyChart({
  points,
  width = 420,
  height = 200,
}: {
  points: DailySolarPoint[];
  width?: number;
  height?: number;
}) {
  const padding = 28;
  if (!points.length) {
    return <div className="empty">No solar data.</div>;
  }
  const maxVal = Math.max(
    ...points.map((p) => Math.max(p.simulatedKwh, p.actualKwh ?? 0)),
    1,
  );
  const barWidth = (width - padding * 2) / points.length;
  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          fill="rgba(15, 23, 42, 0.35)"
          stroke="rgba(148, 163, 184, 0.2)"
        />
        {points.map((point, i) => {
          const x = padding + i * barWidth + 4;
          const simHeight = (point.simulatedKwh / maxVal) * (height - padding * 2);
          const actHeight = point.actualKwh
            ? (point.actualKwh / maxVal) * (height - padding * 2)
            : 0;
          const ySim = height - padding - simHeight;
          const yAct = height - padding - actHeight;
          return (
            <g key={point.date}>
              <rect
                x={x}
                y={ySim}
                width={Math.max(6, barWidth * 0.45)}
                height={simHeight}
                fill="rgba(34, 211, 238, 0.7)"
                rx="4"
              />
              {point.actualKwh !== null && (
                <rect
                  x={x + Math.max(8, barWidth * 0.5)}
                  y={yAct}
                  width={Math.max(6, barWidth * 0.45)}
                  height={actHeight}
                  fill="rgba(250, 204, 21, 0.75)"
                  rx="4"
                />
              )}
            </g>
          );
        })}
        <text x={8} y={14} fill="#94a3b8" fontSize="10">
          {maxVal.toFixed(1)} kWh
        </text>
        <text x={8} y={height - 6} fill="#94a3b8" fontSize="10">
          0
        </text>
      </svg>
      <div className="legend">
        <span className="legend-item">
          <i className="dot" style={{ background: "#22d3ee" }} /> Simulated kWh/day
        </span>
        <span className="legend-item">
          <i className="dot baseline" /> Actual feed-in kWh/day
        </span>
      </div>
    </div>
  );
}

function solarForTime(date: Date, profile: {
  sunrise: number;
  peak: number;
  evening: number;
  sunset: number;
  morningKw: number;
  peakKw: number;
  eveningKw: number;
}) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < profile.sunrise || hour > profile.sunset) return 0;
  if (hour <= profile.peak) {
    const t = (hour - profile.sunrise) / (profile.peak - profile.sunrise || 1);
    return profile.morningKw + t * (profile.peakKw - profile.morningKw);
  }
  if (hour <= profile.evening) {
    const t = (hour - profile.peak) / (profile.evening - profile.peak || 1);
    return profile.peakKw + t * (profile.eveningKw - profile.peakKw);
  }
  const t = (hour - profile.evening) / (profile.sunset - profile.evening || 1);
  return profile.eveningKw + t * (0 - profile.eveningKw);
}

function buildSolarDaily(
  curve: WeatherPoint[],
  payload: RawInterval[] | null,
  usagePayload: UsageInterval[] | null,
  resolution: number,
): DailySolarPoint[] {
  const intervalHours =
    payload && payload.length > 1
      ? Math.abs(
          (new Date(payload[1].startTime).getTime() - new Date(payload[0].startTime).getTime()) /
            (1000 * 60 * 60),
        )
      : resolution / 60;
  const dailySim = new Map<string, number>();
  curve.forEach((point) => {
    const date = new Date(point.time).toISOString().slice(0, 10);
    const kwh = point.temperature * intervalHours;
    dailySim.set(date, (dailySim.get(date) || 0) + kwh);
  });
  const dailyActual = new Map<string, number>();
  if (usagePayload?.length) {
    usagePayload.forEach((row) => {
      if (row.channelType !== "feedIn") return;
      const date = row.date || row.nemTime?.slice(0, 10) || row.startTime.slice(0, 10);
      dailyActual.set(date, (dailyActual.get(date) || 0) + row.kwh);
    });
  }
  const totalSim = Array.from(dailySim.values()).reduce((acc, v) => acc + v, 0);
  const totalActual = Array.from(dailyActual.values()).reduce((acc, v) => acc + v, 0);
  const scale = totalSim > 0 && totalActual > 0 ? totalActual / totalSim : 1;
  return Array.from(dailySim.entries())
    .map(([date, sim]) => ({
      date,
      simulatedKwh: sim * scale,
      actualKwh: dailyActual.has(date) ? dailyActual.get(date)! : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatJson(data: unknown) {
  if (!data) return "No data loaded.";
  try {
    return JSON.stringify(data, null, 2);
  } catch (_err) {
    return "Failed to render JSON.";
  }
}

function parseDsl(input: string): CustomRule[] {
  const rules: CustomRule[] = [];
  const parts = input.split(";").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(/(BUY|SELL)\s+when\s+(buy|sell|hour|solar)\s*(<=|>=|<|>)\s*([\d.]+)/i);
    if (!match) continue;
    const field = match[2].toLowerCase() as CustomRule["field"];
    const op = match[3] as CustomRule["op"];
    const value = Number(match[4]);
    if (Number.isNaN(value)) continue;
    rules.push({ field, op, value });
  }
  return rules;
}

function maxDrawdown(values: number[]) {
  let peak = values[0] || 0;
  let maxDd = 0;
  values.forEach((v) => {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  });
  return maxDd;
}

function winRate(values: number[]) {
  if (values.length < 2) return 0;
  let wins = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] >= values[i - 1]) wins += 1;
  }
  return wins / (values.length - 1);
}

function strategyComment(profit: number, drawdown: number, winRateValue: number) {
  if (profit <= 0) return "Losing edge. Needs tuning.";
  if (drawdown > profit * 0.9) return "High risk. Consider tighter exits.";
  if (winRateValue > 0.6 && drawdown < profit * 0.4) return "Strong and stable performer.";
  if (winRateValue > 0.5) return "Solid but improvable.";
  return "Low consistency. Try different thresholds.";
}

function downsample(points: BacktestPoint[], maxPoints: number): BacktestPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const sampled: BacktestPoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    sampled.push(points[i]);
  }
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
}

function rangeValues(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

function scale(value: number, min: number, max: number, outMin: number, outMax: number) {
  if (max - min === 0) return (outMin + outMax) / 2;
  return outMax - ((value - min) / (max - min)) * (outMax - outMin);
}

function buildPath(
  points: BacktestPoint[],
  calcY: (point: BacktestPoint) => number,
  padding: number,
  step: number,
) {
  return points
    .map((point, i) => {
      const x = padding + i * step;
      const y = calcY(point);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function kdeEstimate(values: number[], steps: number): KDEPoint[] {
  if (!values.length) return [];
  const [min, max] = rangeValues(values);
  const bandwidth = (max - min || 1) / 10;
  const points: KDEPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const x = min + ((max - min) * i) / (steps - 1 || 1);
    const y =
      values.reduce((acc, v) => acc + gaussian((x - v) / bandwidth), 0) /
      (values.length * bandwidth);
    points.push({ x, y });
  }
  return points;
}

function gaussian(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function boxStats(values: number[]): BoxStats {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx] ?? 0;
  };
  return {
    min: sorted[0] ?? 0,
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function arimaForecast(values: number[], horizon: number) {
  if (values.length < 3) return values.slice(-horizon);
  const diffs = values.slice(1).map((v, i) => v - values[i]);
  const phi = ar1Coefficient(diffs);
  const forecasts: number[] = [];
  let last = values[values.length - 1];
  let diff = diffs[diffs.length - 1] || 0;
  for (let i = 0; i < horizon; i += 1) {
    diff = phi * diff;
    last += diff;
    forecasts.push(last);
  }
  return forecasts;
}

function ar1Coefficient(series: number[]) {
  if (series.length < 2) return 0;
  const xs = series.slice(0, -1);
  const ys = series.slice(1);
  const xMean = average(xs);
  const yMean = average(ys);
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - xMean) * (ys[i] - yMean);
    den += (x - xMean) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

function prophetForecast(values: number[], horizon: number, period: number) {
  if (!values.length) return [];
  const n = values.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const design = xs.map((t) => [
    1,
    t,
    Math.sin((2 * Math.PI * t) / period),
    Math.cos((2 * Math.PI * t) / period),
  ]);
  const coeffs = linearRegression(design, values);
  const forecasts = [];
  for (let i = 0; i < horizon; i += 1) {
    const t = n + i;
    const row = [
      1,
      t,
      Math.sin((2 * Math.PI * t) / period),
      Math.cos((2 * Math.PI * t) / period),
    ];
    forecasts.push(dot(row, coeffs));
  }
  return forecasts;
}

function linearRegression(matrix: number[][], y: number[]) {
  const xtx = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const xty = [0, 0, 0, 0];
  matrix.forEach((row, i) => {
    for (let r = 0; r < 4; r += 1) {
      xty[r] += row[r] * y[i];
      for (let c = 0; c < 4; c += 1) {
        xtx[r][c] += row[r] * row[c];
      }
    }
  });
  const inv = invert4x4(xtx);
  return multiplyMatrixVector(inv, xty);
}

function invert4x4(m: number[][]) {
  const a = m.map((row) => row.slice());
  const inv = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let i = 0; i < 4; i += 1) {
    let pivot = a[i][i];
    if (pivot === 0) pivot = 1e-6;
    for (let j = 0; j < 4; j += 1) {
      a[i][j] /= pivot;
      inv[i][j] /= pivot;
    }
    for (let k = 0; k < 4; k += 1) {
      if (k === i) continue;
      const factor = a[k][i];
      for (let j = 0; j < 4; j += 1) {
        a[k][j] -= factor * a[i][j];
        inv[k][j] -= factor * inv[i][j];
      }
    }
  }
  return inv;
}

function multiplyMatrixVector(m: number[][], v: number[]) {
  return m.map((row) => dot(row, v));
}

function dot(a: number[], b: number[]) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function formatProfit(value: number) {
  const abs = Math.abs(value).toFixed(2);
  return value >= 0 ? `+$${abs}` : `-$${abs}`;
}

function summarizeLlm(raw: string) {
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
        return {
          action: String(inner.action || "").toUpperCase(),
          confidence: Number.isFinite(inner.confidence) ? Number(inner.confidence) : null,
          reason: inner.reason ? String(inner.reason) : "",
        };
      } catch {
        return { ...empty, reason: content };
      }
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

function actionColor(action: string, opacity: number) {
  const alpha = Math.min(1, Math.max(0, opacity));
  if (action === "buy") return `rgba(34, 197, 94, ${alpha})`;
  if (action === "sell") return `rgba(239, 68, 68, ${alpha})`;
  return `rgba(148, 163, 184, ${alpha})`;
}

function parseLlmTimeline(raw: string): Array<{ time: string; action: string }> {
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
        .filter((item) => item && item.time && item.action)
        .map((item) => ({ time: String(item.time), action: String(item.action).toLowerCase() }));
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

function buildActionSegments(points: BacktestPoint[], raw: string | undefined) {
  if (!points.length) return [];
  const timeline = parseLlmTimeline(raw || "");
  const hourlyFallback = timeline.length === 1 ? timeline[0].action : "hold";
  const actions = points.map((point) => {
    const t = new Date(point.time);
    const isHour = t.getMinutes() === 0;
    let action = hourlyFallback;
    if (timeline.length > 1) {
      const match = timeline.find((item) => item.time && item.time === point.time);
      if (match) action = match.action;
    }
    return isHour ? action : action;
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

function countDays(points: BacktestPoint[]) {
  if (!points.length) return 0;
  const start = new Date(points[0].time);
  const end = new Date(points[points.length - 1].time);
  const startStamp = toDayStamp(start);
  const endStamp = toDayStamp(end);
  return dayDiff(startStamp, endStamp) + 1;
}

function toDayStamp(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayDiff(startStamp: number, endStamp: number) {
  const ms = endStamp - startStamp;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
