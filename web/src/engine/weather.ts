import { WeatherPoint } from "../core/types";

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function simulateCloudCover(times: string[]): WeatherPoint[] {
  const dailyBase = new Map<string, number>();
  const dayState = new Map<string, number>();
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return times.map((time) => {
    const dayKey = time.slice(0, 10);
    let base = dailyBase.get(dayKey);
    if (base === undefined) {
      const seed = hashString(dayKey);
      const rand = seededRandom(seed);
      base = 0.15 + rand() * 0.6;
      dailyBase.set(dayKey, base);
    }
    const hourKey = time.slice(0, 13);
    const hourSeed = hashString(`${hourKey}-cloud`);
    const hourRand = seededRandom(hourSeed)();
    const hour = new Date(time).getHours();
    const diurnal = 0.12 * Math.sin(((hour - 7) / 12) * Math.PI);
    const noise = (hourRand - 0.5) * 0.14;
    const target = clamp(base + diurnal);
    const prev = dayState.get(dayKey) ?? target;
    const value = clamp(prev * 0.72 + target * 0.28 + noise);
    dayState.set(dayKey, value);
    return { time, value };
  });
}
