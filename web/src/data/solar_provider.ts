import { WeatherPoint } from "../core/types";

export type SolarProvider = "openmeteo" | "solcast" | "auto";

type ProviderWeatherResponse = {
  providerUsed?: "openmeteo" | "solcast";
  fallbackReason?: string | null;
  hourly?: {
    time?: string[];
    cloudcover?: number[];
  };
};

export type ProviderWeatherResult = {
  points: WeatherPoint[];
  providerUsed: "openmeteo" | "solcast";
  fallbackReason?: string | null;
};

export async function fetchCloudCoverFromProvider(
  apiBase: string,
  anonKey: string | undefined,
  params: {
    startDate: string;
    endDate: string;
    latitude: number;
    longitude: number;
    timezone: string;
    provider: SolarProvider;
  },
  solcastApiKey?: string,
): Promise<ProviderWeatherResult> {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    latitude: String(params.latitude),
    longitude: String(params.longitude),
    timezone: params.timezone,
    provider: params.provider,
  }).toString();
  const headers: Record<string, string> = {};
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
  if (solcastApiKey?.trim()) headers["x-solcast-api-key"] = solcastApiKey.trim();
  const resp = await fetch(`${apiBase}/weather?${query}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Weather error ${resp.status}: ${text}`);
  }
  const json = (await resp.json()) as ProviderWeatherResponse;
  const times = json.hourly?.time || [];
  const covers = json.hourly?.cloudcover || [];
  const points = times.map((time, idx) => ({
    time,
    value: Math.min(1, Math.max(0, (covers[idx] ?? 0) / 100)),
  }));
  return {
    points,
    providerUsed: json.providerUsed || (params.provider === "solcast" ? "solcast" : "openmeteo"),
    fallbackReason: json.fallbackReason ?? null,
  };
}
