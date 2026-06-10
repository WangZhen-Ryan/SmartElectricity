const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, x-amber-token, x-llm-token, x-solcast-api-key, content-type",
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

    const token = req.headers.get("x-amber-token") || "";
    const siteId = url.searchParams.get("siteId") || "";

    if (path === "config") {
      return json({ siteId: "", hasToken: false, requiresAmberConfig: true }, 200);
    }

    if (path === "private-secrets") {
      const user = await requireAuthenticatedUser(req);
      if (req.method === "GET") {
        const row = await readPrivateSecrets(user.id);
        return json(row, 200);
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") {
          return json({ error: "Missing private secrets payload." }, 400);
        }
        await writePrivateSecrets(user.id, body as Record<string, unknown>);
        return json({ ok: true }, 200);
      }
      return json({ error: "Use GET/POST for private secrets." }, 405);
    }

    if (path === "state/self-iteration") {
      if (req.method === "GET") {
        const record = await readAppState("self-iteration");
        if (!record) {
          return json({ ok: true, payload: null, savedAt: null }, 200);
        }
        return json({ ok: true, payload: record.payload, savedAt: record.savedAt }, 200);
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!body || !body.payload) {
          return json({ error: "Missing payload." }, 400);
        }
        const saved = await writeAppState("self-iteration", body.payload);
        return json({ ok: true, savedAt: saved.savedAt }, 200);
      }
      return json({ error: "Use GET/POST for self-iteration state." }, 405);
    }

    if (path === "llm") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for LLM requests." }, 405);
      }
      const openRouterKey = req.headers.get("x-llm-token") || "";
      if (!openRouterKey) {
        return json({ error: "Missing LLM API token. Configure it in Config or set OPENROUTER_API_KEY." }, 400);
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
      const provider = (url.searchParams.get("provider") || "auto").toLowerCase();
      if (!latitude || !longitude || !startDate || !endDate) {
        return json({ error: "Missing latitude/longitude/startDate/endDate." }, 400);
      }
      if (!["auto", "openmeteo", "solcast"].includes(provider)) {
        return json({ error: "Invalid provider. Use auto|openmeteo|solcast." }, 400);
      }
      if (provider === "solcast" || provider === "auto") {
        const solcastResult = await fetchSolcastCloudCover({
          latitude,
          longitude,
          startDate,
          endDate,
          timezone,
          apiKey: req.headers.get("x-solcast-api-key") || "",
        });
        if (solcastResult.ok) {
          return json(
            {
              providerUsed: "solcast",
              fallbackReason: null,
              hourly: solcastResult.hourly,
            },
            200,
          );
        }
        if (provider === "solcast") {
          return json(
            {
              error: "Solcast unavailable.",
              detail: solcastResult.reason,
            },
            502,
          );
        }
        const openMeteoFallback = await fetchOpenMeteoCloudCover({
          latitude,
          longitude,
          startDate,
          endDate,
          timezone,
        });
        return json(
          {
            providerUsed: "openmeteo",
            fallbackReason: solcastResult.reason || "Solcast fetch failed",
            hourly: openMeteoFallback.hourly,
          },
          200,
        );
      }
      const openMeteo = await fetchOpenMeteoCloudCover({
        latitude,
        longitude,
        startDate,
        endDate,
        timezone,
      });
      return json(
        {
          providerUsed: "openmeteo",
          fallbackReason: null,
          hourly: openMeteo.hourly,
        },
        200,
      );
    }

    if (path === "device/command") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for device commands." }, 405);
      }
      const body = await req.json().catch(() => null);
      if (!body || !body.action) {
        return json({ error: "Missing action." }, 400);
      }
      console.log("Device command (stub):", body);
      // TODO: Replace with Modbus TCP bridge integration.
      return json({ ok: true, received: body }, 200);
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

    if (!token) {
      return json({ error: "Missing AMBER_TOKEN." }, 400);
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

async function fetchOpenMeteoCloudCover(params: {
  latitude: string;
  longitude: string;
  startDate: string;
  endDate: string;
  timezone: string;
}) {
  const todayStr = todayInTimezone(params.timezone);
  const paramsBase = {
    latitude: params.latitude,
    longitude: params.longitude,
    hourly: "cloudcover",
    timezone: params.timezone,
  };
  const fetchWeather = async (baseUrl: string, rangeStart: string, rangeEnd: string) => {
    const query = new URLSearchParams({
      ...paramsBase,
      start_date: rangeStart,
      end_date: rangeEnd,
    }).toString();
    const resp = await fetch(`${baseUrl}?${query}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Open-Meteo error ${resp.status}: ${text}`);
    }
    return (await resp.json()) as any;
  };
  const mergeHourly = (primary: any, secondary: any) => {
    if (!primary) return secondary;
    if (!secondary) return primary;
    if (!primary.hourly || !secondary.hourly) {
      return { ...primary, ...secondary };
    }
    const merged = { ...primary, hourly: { ...primary.hourly } };
    Object.keys(secondary.hourly).forEach((key) => {
      const left = Array.isArray(primary.hourly[key]) ? primary.hourly[key] : [];
      const right = Array.isArray(secondary.hourly[key]) ? secondary.hourly[key] : [];
      merged.hourly[key] = left.concat(right);
    });
    return merged;
  };
  if (params.endDate < todayStr) {
    return await fetchWeather("https://archive-api.open-meteo.com/v1/archive", params.startDate, params.endDate);
  }
  if (params.startDate > todayStr) {
    return await fetchWeather("https://api.open-meteo.com/v1/forecast", params.startDate, params.endDate);
  }
  const todayDate = dateOnlyToDate(todayStr);
  const archiveJson = await fetchWeather(
    "https://archive-api.open-meteo.com/v1/archive",
    params.startDate,
    todayStr,
  );
  const nextDay = toDateOnly(addDays(todayDate, 1));
  if (nextDay > params.endDate) {
    return archiveJson;
  }
  const forecastJson = await fetchWeather(
    "https://api.open-meteo.com/v1/forecast",
    nextDay,
    params.endDate,
  );
  return mergeHourly(archiveJson, forecastJson);
}

async function fetchSolcastCloudCover(params: {
  latitude: string;
  longitude: string;
  startDate: string;
  endDate: string;
  timezone: string;
  apiKey?: string;
}): Promise<
  | { ok: true; hourly: { time: string[]; cloudcover: number[] } }
  | { ok: false; reason: string }
> {
  const apiKey = params.apiKey || Deno.env.get("SOLCAST_API_KEY") || "";
  if (!apiKey) {
    return { ok: false, reason: "Missing SOLCAST_API_KEY." };
  }
  const url = new URL("https://api.solcast.com.au/world_radiation/forecasts");
  url.searchParams.set("latitude", params.latitude);
  url.searchParams.set("longitude", params.longitude);
  url.searchParams.set("format", "json");
  url.searchParams.set("hours", "168");
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, reason: `Solcast error ${resp.status}: ${text}` };
  }
  const json = (await resp.json()) as any;
  const forecasts = Array.isArray(json?.forecasts) ? json.forecasts : [];
  if (!forecasts.length) {
    return { ok: false, reason: "Solcast returned empty forecasts." };
  }
  const start = dateOnlyToDate(params.startDate);
  const end = dateOnlyToDate(params.endDate);
  const startMs = start.getTime();
  const endMs = addDays(end, 1).getTime();
  const hourlyMap = new Map<string, { sum: number; count: number }>();
  forecasts.forEach((row: any) => {
    const ts = row?.period_end;
    if (!ts) return;
    const at = new Date(ts).getTime();
    if (!Number.isFinite(at) || at < startMs || at >= endMs) return;
    const hourKey = new Date(at).toISOString().slice(0, 13) + ":00:00Z";
    const cloudOpacity =
      typeof row?.cloud_opacity === "number"
        ? row.cloud_opacity
        : typeof row?.cloudOpacity === "number"
          ? row.cloudOpacity
          : null;
    if (cloudOpacity === null) return;
    const bucket = hourlyMap.get(hourKey) || { sum: 0, count: 0 };
    bucket.sum += cloudOpacity;
    bucket.count += 1;
    hourlyMap.set(hourKey, bucket);
  });
  const times = Array.from(hourlyMap.keys()).sort();
  const cloudcover = times.map((time) => {
    const bucket = hourlyMap.get(time)!;
    const avg = bucket.count > 0 ? bucket.sum / bucket.count : 0;
    return Math.max(0, Math.min(100, avg));
  });
  if (!times.length) {
    return { ok: false, reason: "No Solcast rows in requested date range." };
  }
  return { ok: true, hourly: { time: times, cloudcover } };
}

function parseDateParam(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnlyToDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function todayInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = lookup.get("year") || "1970";
  const month = lookup.get("month") || "01";
  const day = lookup.get("day") || "01";
  return `${year}-${month}-${day}`;
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

type AppStateRecord = {
  payload: unknown;
  savedAt: string;
};

type PrivateSecretsRow = {
  id: string;
  user_id: string;
  amber_token: string | null;
  solcast_api_key: string | null;
  llm_api_token: string | null;
};

type AuthenticatedUser = {
  id: string;
  email?: string;
};

async function readAppState(key: string): Promise<AppStateRecord | null> {
  const { url, serviceRole } = getSupabaseAdminConfig();
  const resp = await fetch(
    `${url}/rest/v1/app_state?key=eq.${encodeURIComponent(key)}&select=payload,updated_at&limit=1`,
    {
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to read app_state: ${resp.status} ${text}`);
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    payload: rows[0].payload,
    savedAt: rows[0].updated_at,
  };
}

async function writeAppState(key: string, payload: unknown): Promise<{ savedAt: string }> {
  const { url, serviceRole } = getSupabaseAdminConfig();
  const savedAt = new Date().toISOString();
  const resp = await fetch(`${url}/rest/v1/app_state`, {
    method: "POST",
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([
      {
        key,
        payload,
        updated_at: savedAt,
      },
    ]),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to write app_state: ${resp.status} ${text}`);
  }
  return { savedAt };
}

async function requireAuthenticatedUser(req: Request): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = match?.[1]?.trim();
  if (!accessToken) {
    throw new Error("Missing bearer token.");
  }
  const { url, serviceRole } = getSupabaseAdminConfig();
  const requestApiKey = req.headers.get("apikey")?.trim();
  const publicApiKey = requestApiKey || Deno.env.get("SUPABASE_ANON_KEY") || serviceRole;
  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: publicApiKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Unauthorized: ${text || resp.status}`);
  }
  const user = await resp.json();
  if (!user?.id) {
    throw new Error("Unauthorized: missing user id.");
  }
  return { id: String(user.id), email: typeof user.email === "string" ? user.email : undefined };
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getSecretsCryptoKey() {
  const { serviceRole } = getSupabaseAdminConfig();
  const raw = Deno.env.get("PRIVATE_SECRETS_KEY") || serviceRole;
  const material = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const key = await getSecretsCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(value);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return `v1:${base64Encode(iv)}:${base64Encode(cipher)}`;
}

async function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("v1:")) return value;
  const [, ivPart, cipherPart] = value.split(":");
  if (!ivPart || !cipherPart) return null;
  const key = await getSecretsCryptoKey();
  const iv = base64Decode(ivPart);
  const cipher = base64Decode(cipherPart);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plaintext);
}

async function readPrivateSecrets(userId: string): Promise<PrivateSecretsRow | null> {
  const { url, serviceRole } = getSupabaseAdminConfig();
  const resp = await fetch(
    `${url}/rest/v1/user_private_secrets?user_id=eq.${encodeURIComponent(
      userId,
    )}&select=id,user_id,amber_token,solcast_api_key,llm_api_token&limit=1`,
    {
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to read private secrets: ${resp.status} ${text}`);
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    amber_token: await decryptSecret(row.amber_token),
    solcast_api_key: await decryptSecret(row.solcast_api_key),
    llm_api_token: await decryptSecret(row.llm_api_token),
  };
}

async function writePrivateSecrets(userId: string, payload: Record<string, unknown>) {
  const { url, serviceRole } = getSupabaseAdminConfig();
  const body = [
    {
      user_id: userId,
      amber_token: await encryptSecret(
        typeof payload.amber_token === "string" ? payload.amber_token : null,
      ),
      solcast_api_key: await encryptSecret(
        typeof payload.solcast_api_key === "string" ? payload.solcast_api_key : null,
      ),
      llm_api_token: await encryptSecret(
        typeof payload.llm_api_token === "string" ? payload.llm_api_token : null,
      ),
    },
  ];
  const resp = await fetch(`${url}/rest/v1/user_private_secrets?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to write private secrets: ${resp.status} ${text}`);
  }
}

function getSupabaseAdminConfig() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url, serviceRole };
}

type MarketPoint = {
  startTime: Date;
  endTime: Date;
  generalCents: number | null;
  feedinCents: number | null;
  renewablesPct: number | null;
};

function buildMarket(
  data: Array<{
    startTime: string;
    endTime: string;
    channelType: string;
    perKwh: number;
    renewables?: number;
  }>,
): MarketPoint[] {
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
        renewablesPct: null,
      });
    }
    const entry = buckets.get(key)!;
    if (item.channelType === "general") entry.generalCents = item.perKwh;
    if (item.channelType === "feedIn") entry.feedinCents = Math.abs(item.perKwh);
    if (typeof item.renewables === "number") entry.renewablesPct = item.renewables;
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
  const renew = point.renewablesPct;
  const renewBin =
    renew === null
      ? "unk"
      : renew < 20
        ? "low"
        : renew < 40
          ? "mid"
          : renew < 60
            ? "high"
            : renew < 80
              ? "vhigh"
              : "max";
  return `${priceBin}|${socBin}|${hourBin}|${solarBin}|${renewBin}`;
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
  const dailyCharge = Number(config.dailyChargeAud ?? 0);
  const rewards: number[] = [];
  for (let e = 0; e < episodes; e += 1) {
    let soc = config.startSoc ?? 0;
    let episodeReward = 0;
    let currentDay = "";
    for (let i = 0; i < market.length; i += 1) {
      const point = market[i];
      const dayStamp = toDateOnly(point.startTime);
      if (dayStamp !== currentDay) {
        currentDay = dayStamp;
        if (dailyCharge) episodeReward -= dailyCharge;
      }
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
  const dailyCharge = Number(config.dailyChargeAud ?? 0);
  const featureCount = featureVector(
    {
      startTime: new Date(),
      endTime: new Date(),
      generalCents: 0,
      feedinCents: 0,
      renewablesPct: 0,
    },
    0,
    0,
  ).length;
  const weights = Array.from({ length: 3 }, () => new Array(featureCount).fill(0));
  const rewards: number[] = [];
  for (let e = 0; e < episodes; e += 1) {
    let soc = config.startSoc ?? 0;
    let episodeReward = 0;
    let currentDay = "";
    for (let i = 0; i < market.length; i += 1) {
      const point = market[i];
      const dayStamp = toDateOnly(point.startTime);
      if (dayStamp !== currentDay) {
        currentDay = dayStamp;
        if (dailyCharge) episodeReward -= dailyCharge;
      }
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
  const renew = (point.renewablesPct ?? 0) / 100;
  return [1, price, soc / 40, solarKw / 10, hour, renew];
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
  const key = `${state.price}|${state.soc}|${state.hour}|${state.solar}|${state.renewables}`;
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
    renewablesPct: state.renewables ?? null,
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
  const dailyCharge = Number(config.dailyChargeAud ?? 0);
  let currentDay = "";
  const actions: string[] = [];
  const points: Array<{ time: string; soc: number; profit: number }> = [];
  for (let i = 0; i < market.length; i += 1) {
    const point = market[i];
    const dayStamp = toDateOnly(point.startTime);
    if (dayStamp !== currentDay) {
      currentDay = dayStamp;
      if (dailyCharge) cash -= dailyCharge;
    }
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
          renewables: point.renewablesPct ?? 0,
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
    actions.push(action);
    points.push({
      time: point.startTime.toISOString(),
      soc,
      profit: cash,
    });
  }
  return { profit: cash, endSoc: soc, actions, points };
}
