import { WeatherPoint } from "../core/types";

type SolarSample = {
  time: string;
  cloudCover: number;
  solarKw: number;
};

export type SolarRegressionModel = {
  weights: number[];
  minKw: number;
  maxKw: number;
};

function featureVector(date: Date, cloudCover: number) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const dayOfYear = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) /
      (24 * 60 * 60 * 1000),
  );
  const hourAngle = (2 * Math.PI * hour) / 24;
  const hourAngle2 = (4 * Math.PI * hour) / 24;
  const seasonAngle = (2 * Math.PI * dayOfYear) / 365;
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const cover = Math.min(1, Math.max(0, cloudCover));
  const clear = 1 - cover;
  return {
    daylight,
    x: [
    1,
    Math.sin(hourAngle),
    Math.cos(hourAngle),
      Math.sin(hourAngle2),
      Math.cos(hourAngle2),
    Math.sin(seasonAngle),
    Math.cos(seasonAngle),
    daylight,
      daylight * daylight,
    clear,
    Math.pow(clear, 2),
    daylight * clear,
      daylight * daylight * clear,
      cover,
    ],
  };
}

export function trainSolarRegression(samples: SolarSample[], ridge = 0.1): SolarRegressionModel | null {
  if (samples.length < 8) return null;
  const positiveSamples = samples.filter((s) => s.solarKw > 0);
  const maxKw = percentile(
    (positiveSamples.length ? positiveSamples : samples).map((s) => s.solarKw),
    0.95,
  );
  const minKw = 0;
  const rows = samples.map((s) => featureVector(new Date(s.time), s.cloudCover));
  const y = samples.map((s) => s.solarKw);
  const featureCount = rows[0].x.length;
  const xtx = Array.from({ length: featureCount }, () => Array(featureCount).fill(0));
  const xty = Array(featureCount).fill(0);
  rows.forEach((row, i) => {
    const daylightWeight = 0.35 + 0.65 * row.daylight;
    const solarWeight = y[i] > 0 ? 1 : 0.6;
    const weight = daylightWeight * solarWeight;
    for (let r = 0; r < row.x.length; r += 1) {
      xty[r] += weight * row.x[r] * y[i];
      for (let c = 0; c < row.x.length; c += 1) {
        xtx[r][c] += weight * row.x[r] * row.x[c];
      }
    }
  });
  for (let i = 0; i < xtx.length; i += 1) {
    xtx[i][i] += ridge;
  }
  const inv = invert(xtx);
  const weights = multiply(inv, xty);
  return { weights, minKw, maxKw: Math.max(minKw + 0.1, maxKw) };
}

export function predictSolar(
  model: SolarRegressionModel,
  times: string[],
  cloudCover: WeatherPoint[],
) {
  const coverByHour = new Map<string, number>();
  cloudCover.forEach((point) => {
    coverByHour.set(point.time.slice(0, 13), point.value);
  });
  return times.map((time) => {
    const date = new Date(time);
    const cover = coverByHour.get(time.slice(0, 13)) ?? 0;
    const { x } = featureVector(date, cover);
    const estimate = dot(x, model.weights);
    const nonNegative = Math.max(0, estimate);
    const clamped = Math.max(model.minKw, Math.min(model.maxKw * 1.1, nonNegative));
    return clamped;
  });
}

function invert(m: number[][]) {
  const size = m.length;
  const a = m.map((row) => row.slice());
  const inv = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_v, j) => (i === j ? 1 : 0)),
  );
  for (let i = 0; i < size; i += 1) {
    let pivot = a[i][i];
    if (pivot === 0) pivot = 1e-6;
    for (let j = 0; j < size; j += 1) {
      a[i][j] /= pivot;
      inv[i][j] /= pivot;
    }
    for (let k = 0; k < size; k += 1) {
      if (k === i) continue;
      const factor = a[k][i];
      for (let j = 0; j < size; j += 1) {
        a[k][j] -= factor * a[i][j];
        inv[k][j] -= factor * inv[i][j];
      }
    }
  }
  return inv;
}

function multiply(m: number[][], v: number[]) {
  return m.map((row) => dot(row, v));
}

function dot(a: number[], b: number[]) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(pct * (sorted.length - 1))));
  return sorted[idx];
}
