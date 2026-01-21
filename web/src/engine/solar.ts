import { WeatherPoint } from "../core/types";

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
    coverByHour.set(key, point.value);
  });
  return curve.map((point) => {
    const key = point.time.slice(0, 13);
    const cover = coverByHour.get(key) ?? 0;
    return { ...point, value: point.value * (1 - cover) };
  });
}
