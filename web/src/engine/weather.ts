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
  return times.map((time) => {
    const dayKey = time.slice(0, 10);
    let base = dailyBase.get(dayKey);
    if (base === undefined) {
      const seed = hashString(dayKey);
      const rand = seededRandom(seed);
      base = 0.18 + rand() * 0.55;
      dailyBase.set(dayKey, base);
    }
    const hourKey = time.slice(0, 13);
    const hourSeed = hashString(hourKey);
    const hourRand = seededRandom(hourSeed)();
    const hour = new Date(time).getHours();
    const diurnal = 0.08 * Math.sin(((hour - 6) / 12) * Math.PI);
    const noise = (hourRand - 0.5) * 0.18;
    const value = Math.min(1, Math.max(0, base + diurnal + noise));
    return { time, value };
  });
}
