import { useMemo, useState } from "react";

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
  time: Date;
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

const sampleJsonName = "amber_cache.json";

export default function App() {
  const [siteId, setSiteId] = useState("");
  const [token, setToken] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [config, setConfig] = useState(defaultConfig);
  const [payload, setPayload] = useState<RawInterval[] | null>(null);
  const [status, setStatus] = useState("Load data to begin.");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    profit: 0,
    buyKwh: 0,
    sellKwh: 0,
    endSoc: 0,
  });

  const market = useMemo(() => (payload ? buildMarket(payload) : []), [payload]);
  const backtest = useMemo(() => {
    if (!market.length) return [];
    return runBacktest(market, config);
  }, [market, config]);

  const chart = useMemo(() => {
    if (!backtest.length) return null;
    const buy = backtest.map((p) => p.buy);
    const sell = backtest.map((p) => p.sell);
    const soc = backtest.map((p) => p.soc);
    return {
      buy: rangeValues(buy),
      sell: rangeValues(sell),
      soc: rangeValues(soc),
    };
  }, [backtest]);

  async function handleUpload(file: File) {
    setError(null);
    const text = await file.text();
    const json = JSON.parse(text);
    const data = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(data)) {
      throw new Error("Unsupported JSON payload shape.");
    }
    setPayload(data as RawInterval[]);
    setStatus(`Loaded ${data.length} intervals.`);
  }

  async function handleFetch() {
    setError(null);
    setStatus("Fetching Amber API...");
    const query = new URLSearchParams({
      startDate: range.start,
      endDate: range.end,
      resolution: String(range.resolution),
    }).toString();

    const url = `https://api.amber.com.au/v1/sites/${siteId}/prices?${query}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!resp.ok) {
      throw new Error(`API error ${resp.status}`);
    }
    const json = await resp.json();
    const data = Array.isArray(json) ? json : json.data;
    setPayload(data as RawInterval[]);
    setStatus(`Fetched ${data.length} intervals.`);
  }

  const summary = useMemo(() => {
    if (!backtest.length) return null;
    const totals = summarize(backtest, config.dailyChargeAud);
    setStats(totals);
    return totals;
  }, [backtest, config.dailyChargeAud]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Amber Battery Lab</p>
          <h1>
            Visual backtesting for dynamic electricity pricing.
            <span> Launch your battery trading plan in minutes.</span>
          </h1>
          <p className="subhead">
            Connect Amber prices, run a simple strategy, and inspect how SOC and
            profit move through time.
          </p>
        </div>
        <div className="status-card">
          <p className="mono">Status</p>
          <p>{status}</p>
          {error && <p className="error">{error}</p>}
          {summary && (
            <div className="stats">
              <div>
                <span>Net Profit</span>
                <strong>${stats.profit.toFixed(2)}</strong>
              </div>
              <div>
                <span>Buy kWh</span>
                <strong>{stats.buyKwh.toFixed(1)}</strong>
              </div>
              <div>
                <span>Sell kWh</span>
                <strong>{stats.sellKwh.toFixed(1)}</strong>
              </div>
              <div>
                <span>End SOC</span>
                <strong>{stats.endSoc.toFixed(1)}</strong>
              </div>
            </div>
          )}
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>Data Inputs</h2>
          <div className="field">
            <label>Load JSON</label>
            <div className="row">
              <input type="file" accept=".json" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleUpload(file).catch((err) => setError(err.message));
                }
              }} />
              <span className="hint">Try {sampleJsonName}</span>
            </div>
          </div>

          <div className="divider" />

          <h3>Amber API</h3>
          <div className="field">
            <label>Site ID</label>
            <input value={siteId} onChange={(e) => setSiteId(e.target.value)} />
          </div>
          <div className="field">
            <label>Token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
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
          <button
            className="primary"
            onClick={() => handleFetch().catch((err) => setError(err.message))}
          >
            Fetch from Amber
          </button>
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

      <section className="panel chart-panel">
        <div className="chart-header">
          <div>
            <h2>Backtest Timeline</h2>
            <p className="hint">Prices vs SOC per interval</p>
          </div>
          <div className="chip">
            {backtest.length ? `${backtest.length} intervals` : "No data yet"}
          </div>
        </div>
        {backtest.length ? (
          <Chart points={backtest} ranges={chart!} />
        ) : (
          <div className="empty">Upload JSON or fetch from Amber.</div>
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
  };
}) {
  const width = 860;
  const height = 280;
  const padding = 32;

  const xStep = (width - padding * 2) / (points.length - 1);
  const [buyMin, buyMax] = ranges.buy;
  const [sellMin, sellMax] = ranges.sell;
  const [socMin, socMax] = ranges.soc;

  const buyPath = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.buy, buyMin, buyMax, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const sellPath = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.sell, sellMin, sellMax, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const socPath = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = scale(p.soc, socMin, socMax, height - padding, padding);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
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
        <path d={buyPath} stroke="url(#buyLine)" strokeWidth="3" fill="none" />
        <path d={sellPath} stroke="url(#sellLine)" strokeWidth="3" fill="none" />
        <path d={socPath} stroke="url(#socLine)" strokeWidth="2" fill="none" />
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
      </div>
    </div>
  );
}

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
      time: m.startTime,
      soc,
      buy: m.generalCents ?? 0,
      sell: m.feedinCents ?? 0,
    };
  });
}

function summarize(points: BacktestPoint[], dailyCharge: number) {
  const buyKwh = points.reduce((acc, p, idx) => {
    if (idx === 0) return acc;
    return acc + Math.max(0, points[idx].soc - points[idx - 1].soc);
  }, 0);
  const sellKwh = points.reduce((acc, p, idx) => {
    if (idx === 0) return acc;
    return acc + Math.max(0, points[idx - 1].soc - points[idx].soc);
  }, 0);
  const profit = -dailyCharge + (sellKwh * average(points.map((p) => p.sell)) -
    buyKwh * average(points.map((p) => p.buy))) / 100;
  const endSoc = points[points.length - 1].soc;
  return { profit, buyKwh, sellKwh, endSoc };
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
