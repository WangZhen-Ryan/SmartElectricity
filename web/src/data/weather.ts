import { WeatherPoint } from "../core/types";

type WeatherResponse = {
  hourly?: {
    time?: string[];
    cloudcover?: number[];
  };
};

export async function fetchCloudCover(
  apiBase: string,
  anonKey: string | undefined,
  params: {
    startDate: string;
    endDate: string;
    latitude: number;
    longitude: number;
    timezone: string;
  },
): Promise<WeatherPoint[]> {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    latitude: String(params.latitude),
    longitude: String(params.longitude),
    timezone: params.timezone,
  }).toString();
  const headers: Record<string, string> = {};
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
  const resp = await fetch(`${apiBase}/weather?${query}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Weather error ${resp.status}: ${text}`);
  }
  const json = (await resp.json()) as WeatherResponse;
  const times = json.hourly?.time || [];
  const covers = json.hourly?.cloudcover || [];
  return times.map((time, idx) => ({
    time,
    value: Math.min(1, Math.max(0, (covers[idx] ?? 0) / 100)),
  }));
}
