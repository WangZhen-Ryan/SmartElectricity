import {
  DailySolarPoint,
  RawInterval,
  UsageInterval,
  WeatherPoint,
} from "../core/types";

export type SolarProfile = {
  sunrise: number;
  peak: number;
  evening: number;
  sunset: number;
  morningKw: number;
  peakKw: number;
  eveningKw: number;
};

export function solarForTime(date: Date, profile: SolarProfile) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < profile.sunrise || hour > profile.sunset) return 0;
  if (hour <= profile.peak) {
    const t = (hour - profile.sunrise) / (profile.peak - profile.sunrise || 1);
    return profile.morningKw + t * (profile.peakKw - profile.morningKw);
  }
  if (hour <= profile.evening) {
    const t = (hour - profile.peak) / (profile.evening - profile.peak || 1);
    return profile.peakKw + t * (profile.eveningKw - profile.peakKw);
  }
  const t = (hour - profile.evening) / (profile.sunset - profile.evening || 1);
  return profile.eveningKw + t * (0 - profile.eveningKw);
}

export function applyCloudCover(curve: WeatherPoint[], cloudCover: WeatherPoint[]) {
  if (!cloudCover.length) return curve;
  const coverByHour = new Map<string, number>();
  cloudCover.forEach((point) => {
    const key = point.time.slice(0, 13);
    coverByHour.set(key, Math.min(1, Math.max(0, point.value)));
  });
  return curve.map((point, idx) => {
    const key = point.time.slice(0, 13);
    const cover = coverByHour.get(key) ?? 0;
    const prev = idx > 0 ? coverByHour.get(curve[idx - 1].time.slice(0, 13)) ?? cover : cover;
    const next =
      idx < curve.length - 1
        ? coverByHour.get(curve[idx + 1].time.slice(0, 13)) ?? cover
        : cover;
    const smoothCover = (prev + cover * 2 + next) / 4;
    const attenuation = Math.max(0.12, 1 - 0.85 * Math.pow(smoothCover, 1.35));
    return { ...point, value: point.value * attenuation };
  });
}

export function buildSolarDaily(
  curve: WeatherPoint[],
  payload: RawInterval[] | null,
  usagePayload: UsageInterval[] | null,
  resolution: number,
): DailySolarPoint[] {
  const intervalHours =
    payload && payload.length > 1
      ? Math.abs(
          (new Date(payload[1].startTime).getTime() - new Date(payload[0].startTime).getTime()) /
            (1000 * 60 * 60),
        )
      : resolution / 60;
  const dailySim = new Map<string, number>();
  curve.forEach((point) => {
    const date = new Date(point.time).toISOString().slice(0, 10);
    const kwh = point.value * intervalHours;
    dailySim.set(date, (dailySim.get(date) || 0) + kwh);
  });
  const dailyActual = new Map<string, number>();
  if (usagePayload?.length) {
    usagePayload.forEach((row) => {
      if (row.channelType !== "feedIn") return;
      const date = row.date || row.nemTime?.slice(0, 10) || row.startTime.slice(0, 10);
      dailyActual.set(date, (dailyActual.get(date) || 0) + row.kwh);
    });
  }
  const totalSim = Array.from(dailySim.values()).reduce((acc, v) => acc + v, 0);
  const totalActual = Array.from(dailyActual.values()).reduce((acc, v) => acc + v, 0);
  const scale = totalSim > 0 && totalActual > 0 ? totalActual / totalSim : 1;
  return Array.from(dailySim.entries())
    .map(([date, sim]) => ({
      date,
      simulatedKwh: sim * scale,
      actualKwh: dailyActual.has(date) ? dailyActual.get(date)! : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
