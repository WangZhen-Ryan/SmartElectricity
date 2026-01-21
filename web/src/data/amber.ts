import { CacheEntry, RawInterval, UsageInterval } from "../core/types";

type FetchResult<T> = {
  json: unknown;
  data: T[];
};

function extractData<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object" && Array.isArray((json as any).data)) {
    return (json as any).data as T[];
  }
  return [];
}

export function buildAmberHeaders(token?: string, anonKey?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["x-amber-token"] = token;
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
  return headers;
}

export async function fetchPrices(
  apiBase: string,
  params: { startDate: string; endDate: string; resolution: string; siteId: string },
  headers: Record<string, string>,
): Promise<FetchResult<RawInterval>> {
  const query = new URLSearchParams(params).toString();
  const resp = await fetch(`${apiBase}/prices?${query}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return { json, data: extractData<RawInterval>(json) };
}

export async function fetchPricesWithFallback(
  apiBase: string,
  params: { startDate: string; endDate: string; resolution: string; siteId: string },
  fallback: { siteId: string; previous: string; next: string; resolution: string },
  headers: Record<string, string>,
): Promise<{ json: unknown; data: RawInterval[]; usedFallback: boolean }> {
  try {
    const result = await fetchPrices(apiBase, params, headers);
    return { ...result, usedFallback: false };
  } catch (err) {
    const query = new URLSearchParams(fallback).toString();
    const resp = await fetch(`${apiBase}/current?${query}`, { headers });
    if (!resp.ok) {
      throw err;
    }
    const json = await resp.json();
    return { json, data: extractData<RawInterval>(json), usedFallback: true };
  }
}

export async function fetchUsage(
  apiBase: string,
  params: { startDate: string; endDate: string; resolution: string; siteId: string },
  headers: Record<string, string>,
): Promise<FetchResult<UsageInterval>> {
  const query = new URLSearchParams(params).toString();
  const resp = await fetch(`${apiBase}/usage?${query}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Usage error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return { json, data: extractData<UsageInterval>(json) };
}

export async function fetchCurrent(
  apiBase: string,
  params: { siteId: string; previous: string; next: string; resolution: string },
  headers: Record<string, string>,
): Promise<FetchResult<RawInterval>> {
  const query = new URLSearchParams(params).toString();
  const resp = await fetch(`${apiBase}/current?${query}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Current prices error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return { json, data: extractData<RawInterval>(json) };
}

export async function fetchSites(apiBase: string, anonKey?: string) {
  const resp = await fetch(`${apiBase}/sites`, {
    headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
  });
  if (!resp.ok) {
    throw new Error("Failed to fetch sites.");
  }
  return resp.json();
}

export async function fetchServerCaches(apiBase: string, anonKey?: string) {
  const resp = await fetch(`${apiBase}/caches`, {
    headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  const list = Array.isArray(data) ? data : [];
  return list.map((entry: CacheEntry) => ({
    ...entry,
    source: "server" as const,
  }));
}

export async function fetchCacheFile(apiBase: string, name: string, anonKey?: string) {
  const resp = await fetch(`${apiBase}/cache?name=${encodeURIComponent(name)}`, {
    headers: anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined,
  });
  if (!resp.ok) {
    throw new Error("Failed to load cache file.");
  }
  return resp.json();
}
