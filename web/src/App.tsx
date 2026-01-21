import { useEffect, useMemo, useRef, useState } from "react";

type RawInterval = {
  startTime: string;
  endTime: string;
  channelType: "general" | "feedIn";
  perKwh: number;
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

type CacheEntry = {
  name: string;
  modified: number;
  size: number;
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

type WeatherPoint = {
  time: string;
  temperature: number;
};

const defaultConfig: BacktestConfig = {
  capacityKwh: 40,
  maxPowerKw: 10,
  dailyChargeAud: 0.98,
  startSoc: 0,
  buyThreshold: 15,
  sellThreshold: 60,
  windowSize: 48,
  buyPercentile: 0.2,
  sellPercentile: 0.8,
  mode: "threshold",
};

const defaultRange = {
  start: "2026-01-20T00:00:00+10:00",
  end: "2026-01-22T00:00:00+10:00",
  resolution: 30,
};

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const [siteId, setSiteId] = useState("");
  const [token, setToken] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [config, setConfig] = useState(defaultConfig);
  const [payload, setPayload] = useState<RawInterval[] | null>(null);
  const [status, setStatus] = useState("Load data to begin.");
  const [error, setError] = useState<string | null>(null);
  const [caches, setCaches] = useState<CacheEntry[]>([]);
  const [selectedCache, setSelectedCache] = useState("");
  const [strategies, setStrategies] = useState<StrategyResult[]>([]);
  const [activeStrategy, setActiveStrategy] = useState("Threshold");
  const [windowStart, setWindowStart] = useState(0);
  const [windowSize, setWindowSize] = useState(240);
  const [maxPoints, setMaxPoints] = useState(400);
  const [currentPrice, setCurrentPrice] = useState<RawInterval[] | null>(null);
  const [weather, setWeather] = useState<WeatherPoint[]>([]);
  const [location, setLocation] = useState({ lat: -35.2809, lon: 149.13 });

  useEffect(() => {
    workerRef.current = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((resp) => resp.json())
      .then((data) => {
        if (data.siteId) setSiteId(data.siteId);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetch("/api/caches")
      .then((resp) => resp.json())
      .then((data: CacheEntry[]) => {
        setCaches(data);
        if (data.length) {
          setSelectedCache(data[0].name);
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!payload || !workerRef.current) return;
    setStatus("Crunching backtest...");
    workerRef.current.onmessage = (event) => {
      setStrategies(event.data.strategies);
      if (event.data.strategies.length) {
        setActiveStrategy(event.data.strategies[0].name);
      }
      setWindowStart(0);
      setStatus(`Loaded ${event.data.strategies[0]?.points.length || 0} intervals.`);
    };
    workerRef.current.postMessage({ payload, config });
  }, [payload, config]);

  const active = useMemo(
    () => strategies.find((s) => s.name === activeStrategy) || strategies[0],
    [strategies, activeStrategy],
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
    return {
      buy: rangeValues(buy),
      sell: rangeValues(sell),
      soc: rangeValues(soc),
      profit: rangeValues(profit),
    };
  }, [sampledPoints]);

  const distribution = useMemo(() => {
    if (!active?.points.length) return null;
    const buy = active.points.map((p) => p.buy);
    const sell = active.points.map((p) => p.sell);
    return {
      buy: histogram(buy, 12),
      sell: histogram(sell, 12),
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
    const query = new URLSearchParams({
      startDate: range.start,
      endDate: range.end,
      resolution: String(range.resolution),
      siteId,
    }).toString();

    const resp = await fetch(`/api/prices?${query}`, {
      headers: token ? { "x-amber-token": token } : undefined,
    });
    if (!resp.ok) {
      throw new Error(`API error ${resp.status}`);
    }
    const json = await resp.json();
    const data = Array.isArray(json) ? json : json.data;
    setPayload(data as RawInterval[]);
  }

  async function handleCurrent() {
    setError(null);
    const query = new URLSearchParams({
      siteId,
      previous: "0",
      next: "4",
      resolution: String(range.resolution),
    }).toString();
    const resp = await fetch(`/api/current?${query}`, {
      headers: token ? { "x-amber-token": token } : undefined,
    });
    if (!resp.ok) throw new Error("Failed to fetch current prices.");
    const json = await resp.json();
    setCurrentPrice(json);
  }

  async function handleLoadCache() {
    if (!selectedCache) return;
    setError(null);
    const resp = await fetch(`/api/cache?name=${encodeURIComponent(selectedCache)}`);
    if (!resp.ok) {
      throw new Error("Failed to load cache file.");
    }
    const json = await resp.json();
    const data = Array.isArray(json) ? json : json.data;
    setPayload(data as RawInterval[]);
  }

  async function handleWeather() {
    setError(null);
    const startDate = range.start.split("T")[0];
    const endDate = range.end.split("T")[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&start_date=${startDate}&end_date=${endDate}&hourly=temperature_2m&timezone=auto`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Weather request failed.");
    const json = await resp.json();
    const points: WeatherPoint[] = json.hourly.time.map((time: string, idx: number) => ({
      time,
      temperature: json.hourly.temperature_2m[idx],
    }));
    setWeather(points);
  }

  const forecasts = useMemo(() => {
    if (!active?.points.length) return null;
    return {
      buy: trendForecast(active.points.map((p) => p.buy), 12),
      sell: trendForecast(active.points.map((p) => p.sell), 12),
      profit: trendForecast(active.points.map((p) => p.cumulativeProfit), 12),
    };
  }, [active]);

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
            <button className="primary" onClick={() => handleFetch().catch((err) => setError(err.message))}>
              Fetch from Amber
            </button>
            <button className="ghost" onClick={() => handleLoadCache().catch((err) => setError(err.message))}>
              Load Cache
            </button>
            <button className="ghost" onClick={() => handleCurrent().catch((err) => setError(err.message))}>
              Current Prices
            </button>
          </div>
        </div>
        <div className="status-card">
          <p className="mono">Status</p>
          <p>{status}</p>
          {error && <p className="error">{error}</p>}
          <div className="stats">
            <div>
              <span>Active Strategy</span>
              <strong>{active?.name || "—"}</strong>
            </div>
            <div>
              <span>Net Profit</span>
              <strong>${active?.summary.profit.toFixed(2) || "0.00"}</strong>
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
              <select value={selectedCache} onChange={(e) => setSelectedCache(e.target.value)}>
                <option value="">Select a cache file</option>
                {caches.map((cache) => (
                  <option key={cache.name} value={cache.name}>
                    {cache.name}
                  </option>
                ))}
              </select>
              <button className="ghost small" onClick={() => handleLoadCache().catch((err) => setError(err.message))}>
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
              value={range.start}
              onChange={(e) => setRange({ ...range, start: e.target.value })}
            />
          </div>
          <div className="field">
            <label>End</label>
            <input
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
        <div className="table">
          <div className="table-row head">
            <span>Strategy</span>
            <span>Profit</span>
            <span>Buy kWh</span>
            <span>Sell kWh</span>
            <span>End SOC</span>
          </div>
          {strategies.map((strategy) => (
            <div key={strategy.name} className="table-row">
              <span>{strategy.name}</span>
              <span>${strategy.summary.profit.toFixed(2)}</span>
              <span>{strategy.summary.buyKwh.toFixed(1)}</span>
              <span>{strategy.summary.sellKwh.toFixed(1)}</span>
              <span>{strategy.summary.endSoc.toFixed(1)}</span>
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
          <Chart points={sampledPoints} ranges={ranges!} />
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
            />
          ) : (
            <div className="empty">Load data to see profit curve.</div>
          )}
        </div>
        <div className="panel">
          <h2>Price Distribution</h2>
          {distribution ? (
            <Histogram buy={distribution.buy} sell={distribution.sell} />
          ) : (
            <div className="empty">Load data to see distribution.</div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Forecast (Trend)</h2>
          {forecasts ? (
            <ForecastPanel forecasts={forecasts} />
          ) : (
            <div className="empty">Load data to see forecasts.</div>
          )}
        </div>
        <div className="panel">
          <h2>Weather Impact</h2>
          <div className="field">
            <label>Latitude</label>
            <input
              type="number"
              value={location.lat}
              onChange={(e) => setLocation({ ...location, lat: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Longitude</label>
            <input
              type="number"
              value={location.lon}
              onChange={(e) => setLocation({ ...location, lon: Number(e.target.value) })}
            />
          </div>
          <button className="ghost" onClick={() => handleWeather().catch((err) => setError(err.message))}>
            Load Weather
          </button>
          {weather.length ? (
            <WeatherChart points={weather} />
          ) : (
            <div className="empty">Fetch weather to see temperature trend.</div>
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
    </div>
  );
}

function Chart({
  points,
  ranges,
}: {
  points: BacktestPoint[];
  ranges: {
    buy: [number, number];
    sell: [number, number];
    soc: [number, number];
    profit: [number, number];
  };
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

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX =
    hoverIndex !== null ? padding + hoverIndex * xStep : padding;

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

function LineChart({
  points,
  dataKey,
  color,
}: {
  points: BacktestPoint[];
  dataKey: "cumulativeProfit" | "soc";
  color: string;
}) {
  const width = 420;
  const height = 220;
  const padding = 28;
  const values = points.map((p) => p[dataKey]);
  const [min, max] = rangeValues(values);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p[dataKey], min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        rx="14"
        fill="rgba(15, 23, 42, 0.35)"
        stroke="rgba(148, 163, 184, 0.2)"
      />
      <path d={path} stroke={color} strokeWidth="2.5" fill="none" />
    </svg>
  );
}

function Histogram({ buy, sell }: { buy: number[]; sell: number[] }) {
  return (
    <div className="histogram">
      <div>
        <span className="hint">Buy price</span>
        <Bars values={buy} color="#38bdf8" />
      </div>
      <div>
        <span className="hint">Sell price</span>
        <Bars values={sell} color="#fb7185" />
      </div>
    </div>
  );
}

function Bars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  return (
    <div className="bars">
      {values.map((value, idx) => (
        <span
          key={idx}
          style={{
            height: `${(value / max) * 100}%`,
            background: color,
          }}
        />
      ))}
    </div>
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
  const path = values
    .map((value, i) => {
      const x = padding + i * xStep;
      const y = scale(value, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
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
      <path d={path} stroke={color} strokeWidth="2" fill="none" />
    </svg>
  );
}

function WeatherChart({ points }: { points: WeatherPoint[] }) {
  const width = 420;
  const height = 200;
  const padding = 24;
  const temps = points.map((p) => p.temperature);
  const [min, max] = rangeValues(temps);
  const xStep = (width - padding * 2) / (points.length - 1 || 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.temperature, min, max, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
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
      <path d={path} stroke="#22d3ee" strokeWidth="2" fill="none" />
    </svg>
  );
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

function histogram(values: number[], buckets: number) {
  const [min, max] = rangeValues(values);
  const size = (max - min) / buckets || 1;
  const counts = Array.from({ length: buckets }, () => 0);
  values.forEach((value) => {
    const idx = Math.min(buckets - 1, Math.floor((value - min) / size));
    counts[idx] += 1;
  });
  return counts;
}

function trendForecast(values: number[], horizon: number) {
  if (!values.length) return [];
  const xs = values.map((_, i) => i);
  const xMean = average(xs);
  const yMean = average(values);
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - xMean) * (values[i] - yMean);
    den += (x - xMean) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return Array.from({ length: horizon }, (_, i) => {
    const x = values.length + i;
    return slope * x + intercept;
  });
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}
