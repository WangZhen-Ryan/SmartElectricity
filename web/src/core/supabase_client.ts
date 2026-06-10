export type SupabaseSessionUser = {
  id: string;
  email?: string;
};

export type SupabaseSessionState = {
  accessToken: string;
  refreshToken: string | null;
  user: SupabaseSessionUser;
};

export type SupabaseStrategyProfileRow = {
  id: string;
  user_id: string;
  name: string;
  mode: string;
  is_active: boolean;
  config: Record<string, unknown>;
  latest_profit_aud: number | null;
  latest_score: number | null;
  latest_backtest_at: string | null;
};

export type SupabasePrivateSecretsRow = {
  id: string;
  user_id: string;
  amber_token: string | null;
  solcast_api_key: string | null;
  llm_api_token: string | null;
};

const SUPABASE_AUTH_STORAGE_KEY = "supabase_auth_session_v1";
const SUPABASE_PRESENCE_CLIENT_KEY = "supabase_presence_client_v1";

export function inferSupabaseProjectUrl(functionsUrl: string) {
  if (!functionsUrl || !functionsUrl.includes(".functions.supabase.co")) return null;
  try {
    const parsed = new URL(functionsUrl);
    return `${parsed.protocol}//${parsed.host.replace(".functions.supabase.co", ".supabase.co")}`;
  } catch {
    return null;
  }
}

function encodeFilterValue(value: string) {
  return encodeURIComponent(`eq.${value}`);
}

async function fetchSupabaseJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed: T | { message?: string } | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed && parsed.message) ||
      text ||
      `Request failed (${response.status})`;
    throw new Error(String(message));
  }
  return parsed as T;
}

export function persistSupabaseSession(session: SupabaseSessionState | null) {
  try {
    if (!session) {
      localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore local storage failures.
  }
}

export function readStoredSupabaseSession() {
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SupabaseSessionState;
    if (!parsed?.accessToken || !parsed?.user?.id) {
      localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      return null;
    }
    const payloadPart = parsed.accessToken.split(".")[1];
    if (payloadPart) {
      try {
        const json = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")));
        const exp = Number(json?.exp || 0);
        if (exp && Date.now() >= exp * 1000) {
          localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
          return null;
        }
      } catch {
        // Ignore malformed JWT payloads and let the server verify them.
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getPresenceClientId() {
  try {
    const existing = localStorage.getItem(SUPABASE_PRESENCE_CLIENT_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `presence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SUPABASE_PRESENCE_CLIENT_KEY, next);
    return next;
  } catch {
    return `presence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function supabasePasswordSignIn(
  projectUrl: string,
  anonKey: string,
  email: string,
  password: string,
) {
  return fetchSupabaseJson<{
    access_token: string;
    refresh_token: string;
    user: SupabaseSessionUser;
  }>(`${projectUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
}

export async function supabasePasswordSignUp(
  projectUrl: string,
  anonKey: string,
  email: string,
  password: string,
  metadata?: {
    display_name?: string;
    region?: string;
    postcode?: string;
    timezone?: string;
  },
) {
  return fetchSupabaseJson<{
    access_token?: string;
    refresh_token?: string;
    user: SupabaseSessionUser;
  }>(`${projectUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email,
      password,
      ...(metadata ? { data: metadata } : {}),
    }),
  });
}

export async function supabaseSendPasswordReset(
  projectUrl: string,
  anonKey: string,
  email: string,
  redirectTo?: string,
) {
  const recoverUrl = redirectTo
    ? `${projectUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`
    : `${projectUrl}/auth/v1/recover`;
  return fetchSupabaseJson<{
    message?: string;
  }>(recoverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email,
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
    }),
  });
}

export async function supabaseGetUser(projectUrl: string, anonKey: string, accessToken: string) {
  return fetchSupabaseJson<SupabaseSessionUser>(`${projectUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function supabaseSignOut(projectUrl: string, anonKey: string, accessToken: string) {
  await fetchSupabaseJson<null>(`${projectUrl}/auth/v1/logout`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function supabaseUpdatePassword(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  password: string,
) {
  return fetchSupabaseJson<{
    id?: string;
    email?: string;
  }>(`${projectUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ password }),
  });
}

export async function supabaseEnsureProfile(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  payload: {
    id: string;
    display_name: string;
    region: string;
    timezone: string;
    is_public: boolean;
  },
) {
  await fetchSupabaseJson<unknown>(`${projectUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });
}

export async function supabaseLoadDefaultConfig(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  userId: string,
) {
  return fetchSupabaseJson<any[]>(
    `${projectUrl}/rest/v1/user_energy_configs?user_id=${encodeFilterValue(
      userId,
    )}&is_default=eq.true&select=*`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
}

export async function supabaseLoadPrivateSecrets(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  userId: string,
) {
  return fetchSupabaseJson<SupabasePrivateSecretsRow[]>(
    `${projectUrl}/rest/v1/user_private_secrets?user_id=${encodeFilterValue(userId)}&select=*`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
}

export async function supabaseSavePrivateSecrets(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  payload: {
    user_id: string;
    amber_token: string | null;
    solcast_api_key: string | null;
    llm_api_token: string | null;
  },
) {
  await fetchSupabaseJson<unknown>(
    `${projectUrl}/rest/v1/user_private_secrets?user_id=${encodeFilterValue(payload.user_id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        amber_token: payload.amber_token,
        solcast_api_key: payload.solcast_api_key,
        llm_api_token: payload.llm_api_token,
      }),
    },
  );
}

export async function supabaseSaveDefaultConfig(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  payload: Record<string, unknown>,
) {
  const userId = typeof payload.user_id === "string" ? payload.user_id : null;
  if (userId) {
    const existing = await supabaseLoadDefaultConfig(projectUrl, anonKey, accessToken, userId);
    if (existing[0]?.id) {
      await fetchSupabaseJson<unknown>(
        `${projectUrl}/rest/v1/user_energy_configs?id=${encodeFilterValue(String(existing[0].id))}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify(payload),
        },
      );
      return;
    }
  }
  await fetchSupabaseJson<unknown>(`${projectUrl}/rest/v1/user_energy_configs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
}

export async function supabaseFetchRegionActivity(projectUrl: string, anonKey: string) {
  return fetchSupabaseJson<
    Array<{ region: string; online_now: number | null; latest_seen_at: string | null }>
  >(`${projectUrl}/rest/v1/region_activity?select=region,online_now,latest_seen_at&order=region.asc`, {
    headers: {
      apikey: anonKey,
    },
  });
}

export async function supabaseFetchLeaderboardEntries(
  projectUrl: string,
  anonKey: string,
  bucket = "daily",
) {
  return fetchSupabaseJson<
    Array<{
      id: string;
      user_id: string;
      region: string;
      bucket: string;
      bucket_start: string;
      score: number;
      profit_aud: number;
      roi_pct: number;
      efficiency_score: number;
      cycles: number;
      export_kwh: number;
      import_kwh: number;
      telemetry_quality: string;
      details?: Record<string, unknown>;
    }>
  >(
    `${projectUrl}/rest/v1/leaderboard_entries?bucket=${encodeFilterValue(
      bucket,
    )}&select=id,user_id,region,bucket,bucket_start,score,profit_aud,roi_pct,efficiency_score,cycles,export_kwh,import_kwh,telemetry_quality,details&order=score.desc&limit=25`,
    {
      headers: {
        apikey: anonKey,
      },
    },
  );
}

export async function supabaseUpsertPresenceSession(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  payload: {
    user_id: string;
    region: string;
    page: string;
    is_online: boolean;
    client_id: string;
    meta: Record<string, unknown>;
    last_seen_at: string;
  },
) {
  const existing = await fetchSupabaseJson<Array<{ id: string }>>(
    `${projectUrl}/rest/v1/presence_sessions?user_id=${encodeFilterValue(
      payload.user_id,
    )}&client_id=${encodeFilterValue(payload.client_id)}&select=id&limit=1`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (existing[0]?.id) {
    await fetchSupabaseJson<unknown>(
      `${projectUrl}/rest/v1/presence_sessions?id=${encodeFilterValue(existing[0].id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      },
    );
    return;
  }
  await fetchSupabaseJson<unknown>(`${projectUrl}/rest/v1/presence_sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
}

export async function supabaseUpsertLeaderboardEntry(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  payload: {
    user_id: string;
    region: string;
    bucket: string;
    bucket_start: string;
    score: number;
    profit_aud: number;
    roi_pct: number;
    efficiency_score: number;
    cycles: number;
    export_kwh: number;
    import_kwh: number;
    telemetry_quality: string;
    details: Record<string, unknown>;
  },
) {
  await fetchSupabaseJson<unknown>(
    `${projectUrl}/rest/v1/leaderboard_entries?on_conflict=user_id,bucket,bucket_start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function supabaseLoadStrategyProfiles(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  userId: string,
) {
  return fetchSupabaseJson<SupabaseStrategyProfileRow[]>(
    `${projectUrl}/rest/v1/strategy_profiles?user_id=${encodeFilterValue(
      userId,
    )}&select=id,user_id,name,mode,is_active,config,latest_profit_aud,latest_score,latest_backtest_at&order=updated_at.desc`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
}

export async function supabaseSaveStrategyProfile(
  projectUrl: string,
  anonKey: string,
  accessToken: string,
  payload: {
    user_id: string;
    name: string;
    mode: string;
    is_active: boolean;
    config: Record<string, unknown>;
    latest_profit_aud: number | null;
    latest_score: number | null;
    latest_backtest_at: string | null;
  },
) {
  const existing = await supabaseLoadStrategyProfiles(
    projectUrl,
    anonKey,
    accessToken,
    payload.user_id,
  );
  const current = existing.find((row) => row.name === payload.name);
  if (payload.is_active) {
    await Promise.all(
      existing
        .filter((row) => row.is_active && row.id !== current?.id)
        .map((row) =>
          fetchSupabaseJson<unknown>(
            `${projectUrl}/rest/v1/strategy_profiles?id=${encodeFilterValue(row.id)}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                apikey: anonKey,
                Authorization: `Bearer ${accessToken}`,
                Prefer: "return=representation",
              },
              body: JSON.stringify({ is_active: false }),
            },
          ),
        ),
    );
  }
  if (current?.id) {
    await fetchSupabaseJson<unknown>(
      `${projectUrl}/rest/v1/strategy_profiles?id=${encodeFilterValue(current.id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      },
    );
    return;
  }
  await fetchSupabaseJson<unknown>(`${projectUrl}/rest/v1/strategy_profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
}
