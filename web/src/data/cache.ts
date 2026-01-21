import { CacheEntry } from "../core/types";

export function storageAvailable() {
  try {
    return typeof window !== "undefined" && "localStorage" in window;
  } catch {
    return false;
  }
}

export function readLocalCacheList(): CacheEntry[] {
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

export function writeLocalCacheList(caches: CacheEntry[]) {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem("amberLocalCaches", JSON.stringify(caches));
  } catch {
    return;
  }
}

export function saveLocalCache(
  kind: "prices" | "usage",
  data: unknown,
  range: { start: string; end: string },
  existing: CacheEntry[],
): CacheEntry | null {
  if (!storageAvailable()) return null;
  const base = `${kind}_${range.start}_${range.end}`;
  const existingNames = new Set(existing.map((entry) => entry.name));
  const name = existingNames.has(base) ? `${base}_${Date.now()}` : base;
  const body = JSON.stringify(data, null, 2);
  try {
    localStorage.setItem(`amberLocalCache:${name}`, body);
  } catch {
    return null;
  }
  return {
    name,
    modified: Date.now(),
    size: body.length,
    source: "local",
    kind,
  };
}

export function readLocalCacheData(name: string) {
  if (!storageAvailable()) return null;
  const raw = localStorage.getItem(`amberLocalCache:${name}`);
  if (!raw) return null;
  return JSON.parse(raw);
}
