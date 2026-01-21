const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-amber-token, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const trimmed = url.pathname.replace(/\/+$/, "");
    const segments = trimmed.split("/").filter(Boolean);
    const path = segments.slice(1).join("/") || "config";

    const token = Deno.env.get("AMBER_TOKEN") || req.headers.get("x-amber-token") || "";
    const siteId = url.searchParams.get("siteId") || Deno.env.get("AMBER_SITE_ID") || "";

    if (!token) {
      return json({ error: "Missing AMBER_TOKEN." }, 400);
    }

    if (path === "config") {
      return json({ siteId, hasToken: Boolean(token) }, 200);
    }

    if (path === "sites") {
      const resp = await fetch("https://api.amber.com.au/v1/sites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return proxy(resp);
    }

    if (!siteId) {
      return json({ error: "Missing siteId." }, 400);
    }

    if (path === "current") {
      const previous = url.searchParams.get("previous") || "0";
      const next = url.searchParams.get("next") || "4";
      const resolution = url.searchParams.get("resolution") || "30";
      const params = new URLSearchParams({ previous, next, resolution }).toString();
      const resp = await fetch(
        `https://api.amber.com.au/v1/sites/${siteId}/prices/current?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return proxy(resp);
    }

    if (path === "prices") {
      const startDate = url.searchParams.get("startDate") || "";
      const endDate = url.searchParams.get("endDate") || "";
      const resolution = url.searchParams.get("resolution") || "30";
      if (!startDate || !endDate) {
        return json({ error: "Missing startDate/endDate." }, 400);
      }
      const start = parseDateParam(startDate);
      const end = parseDateParam(endDate);
      if (!start || !end) {
        return json({ error: "Invalid startDate/endDate." }, 400);
      }
      const days = dayDiff(start, end) + 1;
      if (days <= 7) {
        const params = new URLSearchParams({ startDate, endDate, resolution }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/prices?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        return proxy(resp);
      }
      const chunks: unknown[] = [];
      let cursor = start;
      let guard = 0;
      while (cursor.getTime() <= end.getTime()) {
        const chunkEnd = addDays(cursor, 6);
        const sliceEnd = chunkEnd.getTime() > end.getTime() ? end : chunkEnd;
        const params = new URLSearchParams({
          startDate: toDateOnly(cursor),
          endDate: toDateOnly(sliceEnd),
          resolution,
        }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/prices?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) {
          return proxy(resp);
        }
        const payload = await resp.json();
        if (Array.isArray(payload)) {
          chunks.push(...payload);
        }
        cursor = addDays(sliceEnd, 1);
        guard += 1;
        if (guard > 60) break;
      }
      return json(chunks, 200);
    }

    if (path === "usage") {
      const startDate = url.searchParams.get("startDate") || "";
      const endDate = url.searchParams.get("endDate") || "";
      const resolution = url.searchParams.get("resolution") || "30";
      if (!startDate || !endDate) {
        return json({ error: "Missing startDate/endDate." }, 400);
      }

      const start = parseDateParam(startDate);
      const end = parseDateParam(endDate);
      if (!start || !end) {
        return json({ error: "Invalid startDate/endDate." }, 400);
      }

      const days = dayDiff(start, end) + 1;
      if (days <= 7) {
        const params = new URLSearchParams({ startDate, endDate, resolution }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/usage?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        return proxy(resp);
      }

      const chunks: unknown[] = [];
      let cursor = start;
      let guard = 0;
      while (cursor.getTime() <= end.getTime()) {
        const chunkEnd = addDays(cursor, 6);
        const sliceEnd = chunkEnd.getTime() > end.getTime() ? end : chunkEnd;
        const params = new URLSearchParams({
          startDate: toDateOnly(cursor),
          endDate: toDateOnly(sliceEnd),
          resolution,
        }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/usage?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) {
          return proxy(resp);
        }
        const payload = await resp.json();
        if (Array.isArray(payload)) {
          chunks.push(...payload);
        }
        cursor = addDays(sliceEnd, 1);
        guard += 1;
        if (guard > 60) break;
      }
      return json(chunks, 200);
    }

    if (path === "llm") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for LLM requests." }, 405);
      }
      const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") || "";
      if (!openRouterKey) {
        return json({ error: "Missing OPENROUTER_API_KEY." }, 400);
      }
      const body = await req.json().catch(() => null);
      if (!body || !body.messages || !body.model) {
        return json({ error: "Missing model/messages." }, 400);
      }
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          temperature: body.temperature ?? 0.2,
          max_tokens: body.max_tokens ?? 300,
        }),
      });
      return proxy(resp);
    }

    if (path === "weather") {
      const latitude = url.searchParams.get("latitude") || "";
      const longitude = url.searchParams.get("longitude") || "";
      const startDate = url.searchParams.get("startDate") || "";
      const endDate = url.searchParams.get("endDate") || "";
      const timezone = url.searchParams.get("timezone") || "Australia/Canberra";
      if (!latitude || !longitude || !startDate || !endDate) {
        return json({ error: "Missing latitude/longitude/startDate/endDate." }, 400);
      }
      const params = new URLSearchParams({
        latitude,
        longitude,
        hourly: "cloudcover",
        start_date: startDate,
        end_date: endDate,
        timezone,
      }).toString();
      const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      return proxy(resp);
    }

    if (path === "rl/train") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for RL training." }, 405);
      }
      const body = await req.json().catch(() => null);
      if (!body || !body.payload || !body.config) {
        return json({ error: "Missing payload/config." }, 400);
      }
      const algorithm = body.algorithm || "q-learning";
      const episodes = Number(body.episodes ?? 25);
      const gamma = Number(body.gamma ?? 0.9);
      const alpha = Number(body.alpha ?? 0.2);
      const epsilon = Number(body.epsilon ?? 0.1);
      const market = buildMarket(body.payload);
      const solar = Array.isArray(body.solar) ? body.solar : new Array(market.length).fill(0);
      if (algorithm === "policy-gradient") {
        const result = trainPolicyGradient(market, solar, body.config, {
          episodes,
          gamma,
          alpha,
        });
        return json({ algorithm, ...result }, 200);
      }
      const result = trainQLearning(market, solar, body.config, {
        episodes,
        gamma,
        alpha,
        epsilon,
      });
      return json({ algorithm, ...result }, 200);
    }

    if (path === "rl/policy") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for RL policy." }, 405);
      }
      const body = await req.json().catch(() => null);
      if (!body || !body.state || (!body.qTable && !body.weights)) {
        return json({ error: "Missing state and model." }, 400);
      }
      const action = body.qTable
        ? policyFromQ(body.state, body.qTable)
        : policyFromWeights(body.state, body.weights);
      return json({ action }, 200);
    }

    if (path === "rl/eval") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for RL eval." }, 405);
      }
      const body = await req.json().catch(() => null);
      if (!body || !body.payload || !body.config || (!body.qTable && !body.weights)) {
        return json({ error: "Missing payload/config/model." }, 400);
      }
      const market = buildMarket(body.payload);
      const solar = Array.isArray(body.solar) ? body.solar : new Array(market.length).fill(0);
      const result = evalPolicy(market, solar, body.config, body.qTable, body.weights);
      return json(result, 200);
    }

    return json({ error: "Unknown endpoint." }, 404);
  } catch (err) {
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function proxy(resp: Response) {
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseDateParam(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayDiff(start: Date, end: Date) {
  const startStamp = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endStamp = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((endStamp - startStamp) / (24 * 60 * 60 * 1000));
}

type MarketPoint = {
  startTime: Date;
  endTime: Date;
  generalCents: number | null;
  feedinCents: number | null;
};

function buildMarket(
  data: Array<{ startTime: string; endTime: string; channelType: string; perKwh: number }>,
): MarketPoint[] {
  const buckets = new Map<string, MarketPoint>();
  data.forEach((item) => {
    const start = new Date(item.startTime);
    const end = new Date(item.endTime);
    const key = item.startTime;
    if (!buckets.has(key)) {
      buckets.set(key, { startTime: start, endTime: end, generalCents: null, feedinCents: null });
    }
    const entry = buckets.get(key)!;
    if (item.channelType === "general") entry.generalCents = item.perKwh;
    if (item.channelType === "feedIn") entry.feedinCents = Math.abs(item.perKwh);
  });
  return Array.from(buckets.values()).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

function discretizeState(point: MarketPoint, soc: number, solarKw: number) {
  const price = point.generalCents ?? 0;
  const priceBin =
    price < 0 ? "neg" : price < 10 ? "low" : price < 20 ? "mid" : price < 50 ? "high" : "spike";
  const socBin =
    soc < 5 ? "empty" : soc < 15 ? "low" : soc < 30 ? "mid" : soc < 38 ? "high" : "full";
  const hour = point.startTime.getHours();
  const hourBin = hour < 6 ? "night" : hour < 12 ? "am" : hour < 18 ? "pm" : "eve";
  const solarBin = solarKw < 1 ? "none" : solarKw < 4 ? "low" : "high";
  return `${priceBin}|${socBin}|${hourBin}|${solarBin}`;
}

function getEnergyLimit(config: any, hours: number) {
  const maxPower = Math.min(config.maxPowerKw ?? 10, config.inverterMaxKw ?? 10);
  return maxPower * hours;
}

function stepEnv(
  point: MarketPoint,
  action: number,
  soc: number,
  config: any,
  solarKw: number,
) {
  const hours = (point.endTime.getTime() - point.startTime.getTime()) / (1000 * 60 * 60);
  const energyLimit = getEnergyLimit(config, hours);
  let cash = 0;
  if (action === 0) {
    const charge = Math.min(energyLimit, config.capacityKwh - soc);
    soc += charge;
    cash -= charge * (point.generalCents ?? 0) / 100;
  } else if (action === 1) {
    const discharge = Math.min(energyLimit, soc);
    soc -= discharge;
    cash += discharge * (point.feedinCents ?? 0) / 100;
  }
  return { soc, reward: cash };
}

function trainQLearning(market: MarketPoint[], solar: number[], config: any, opts: any) {
  const qTable: Record<string, number[]> = {};
  const episodes = Math.max(1, opts.episodes || 25);
  const alpha = opts.alpha ?? 0.2;
  const gamma = opts.gamma ?? 0.9;
  const epsilon = opts.epsilon ?? 0.1;
  const rewards: number[] = [];
  for (let e = 0; e < episodes; e += 1) {
    let soc = config.startSoc ?? 0;
    let episodeReward = 0;
    for (let i = 0; i < market.length; i += 1) {
      const point = market[i];
      const state = discretizeState(point, soc, solar[i] || 0);
      if (!qTable[state]) qTable[state] = [0, 0, 0];
      const action =
        Math.random() < epsilon
          ? Math.floor(Math.random() * 3)
          : qTable[state].indexOf(Math.max(...qTable[state]));
      const { soc: nextSoc, reward } = stepEnv(point, action, soc, config, solar[i] || 0);
      episodeReward += reward;
      const nextState = discretizeState(point, nextSoc, solar[i] || 0);
      if (!qTable[nextState]) qTable[nextState] = [0, 0, 0];
      const maxNext = Math.max(...qTable[nextState]);
      qTable[state][action] =
        qTable[state][action] + alpha * (reward + gamma * maxNext - qTable[state][action]);
      soc = nextSoc;
    }
    rewards.push(episodeReward);
  }
  return { qTable, episodes, rewards };
}

function trainPolicyGradient(market: MarketPoint[], solar: number[], config: any, opts: any) {
  const episodes = Math.max(1, opts.episodes || 25);
  const alpha = opts.alpha ?? 0.05;
  const weights = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const rewards: number[] = [];
  for (let e = 0; e < episodes; e += 1) {
    let soc = config.startSoc ?? 0;
    let episodeReward = 0;
    for (let i = 0; i < market.length; i += 1) {
      const point = market[i];
      const features = featureVector(point, soc, solar[i] || 0);
      const probs = softmax(weights.map((w) => dot(w, features)));
      const action = sample(probs);
      const { soc: nextSoc, reward } = stepEnv(point, action, soc, config, solar[i] || 0);
      episodeReward += reward;
      for (let a = 0; a < 3; a += 1) {
        const grad = ((a === action ? 1 : 0) - probs[a]) * reward;
        for (let f = 0; f < features.length; f += 1) {
          weights[a][f] += alpha * grad * features[f];
        }
      }
      soc = nextSoc;
    }
    rewards.push(episodeReward);
  }
  return { weights, episodes, rewards };
}

function featureVector(point: MarketPoint, soc: number, solarKw: number) {
  const price = (point.generalCents ?? 0) / 100;
  const hour = point.startTime.getHours() / 23;
  return [1, price, soc / 40, solarKw / 10, hour];
}

function softmax(values: number[]) {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((acc, v) => acc + v, 0) || 1;
  return exps.map((v) => v / sum);
}

function sample(probs: number[]) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < probs.length; i += 1) {
    acc += probs[i];
    if (r <= acc) return i;
  }
  return probs.length - 1;
}

function dot(a: number[], b: number[]) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
}

function policyFromQ(state: any, qTable: Record<string, number[]>) {
  const key = `${state.price}|${state.soc}|${state.hour}|${state.solar}`;
  const q = qTable[key] || [0, 0, 0];
  const action = q.indexOf(Math.max(...q));
  return action === 0 ? "buy" : action === 1 ? "sell" : "hold";
}

function policyFromWeights(state: any, weights: number[][]) {
  const dummyPoint: MarketPoint = {
    startTime: new Date(state.time || new Date()),
    endTime: new Date(state.time || new Date()),
    generalCents: state.price || 0,
    feedinCents: state.feedIn || 0,
  };
  const features = featureVector(dummyPoint, state.soc || 0, state.solar || 0);
  const probs = softmax(weights.map((w) => dot(w, features)));
  const action = probs.indexOf(Math.max(...probs));
  return action === 0 ? "buy" : action === 1 ? "sell" : "hold";
}

function evalPolicy(
  market: MarketPoint[],
  solar: number[],
  config: any,
  qTable?: Record<string, number[]>,
  weights?: number[][],
) {
  let soc = config.startSoc ?? 0;
  let cash = 0;
  for (let i = 0; i < market.length; i += 1) {
    const point = market[i];
    const stateKey = discretizeState(point, soc, solar[i] || 0);
    let action = "hold";
    if (qTable) {
      const q = qTable[stateKey] || [0, 0, 0];
      const idx = q.indexOf(Math.max(...q));
      action = idx === 0 ? "buy" : idx === 1 ? "sell" : "hold";
    } else if (weights) {
      action = policyFromWeights(
        {
          price: point.generalCents ?? 0,
          soc,
          solar: solar[i] || 0,
          time: point.startTime.toISOString(),
        },
        weights,
      );
    }
    const { soc: nextSoc, reward } = stepEnv(
      point,
      action === "buy" ? 0 : action === "sell" ? 1 : 2,
      soc,
      config,
      solar[i] || 0,
    );
    soc = nextSoc;
    cash += reward;
  }
  return { profit: cash, endSoc: soc };
}
