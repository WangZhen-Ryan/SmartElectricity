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

export type SolarRegressionOptions = {
  ridge?: number;
  minSamples?: number;
};

export type SolarPredictOptions = {
  smooth?: boolean;
  smoothAlpha?: number;
  maxClamp?: number;
};

function features(date: Date, cloudCover: number) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const dayOfYear = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) /
      (24 * 60 * 60 * 1000),
  );
  const hourAngle = (2 * Math.PI * hour) / 24;
  const seasonAngle = (2 * Math.PI * dayOfYear) / 365;
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const cover = Math.min(1, Math.max(0, cloudCover));
  const clearSky = daylight * (0.55 + 0.45 * Math.cos(seasonAngle));
  const attenuated = clearSky * (1 - cover);
  return [
    1,
    Math.sin(hourAngle),
    Math.cos(hourAngle),
    Math.sin(seasonAngle),
    Math.cos(seasonAngle),
    daylight,
    daylight * daylight,
    clearSky,
    attenuated,
    1 - cover,
    Math.pow(1 - cover, 2),
    cover,
    cover * cover,
    daylight * cover,
  ];
}

export function trainSolarRegression(
  samples: SolarSample[],
  options: SolarRegressionOptions = {},
): SolarRegressionModel | null {
  const minSamples = options.minSamples ?? 12;
  if (samples.length < minSamples) return null;
  const positiveSamples = samples.filter((s) => s.solarKw > 0);
  const maxKw = percentile(
    (positiveSamples.length ? positiveSamples : samples).map((s) => s.solarKw),
    0.95,
  );
  const minKw = 0;
  const ridge = options.ridge ?? 0.2;
  const x = samples.map((s) => features(new Date(s.time), s.cloudCover));
  const y = samples.map((s) => s.solarKw);
  const weights = samples.map((s) => {
    const hour = new Date(s.time).getHours() + new Date(s.time).getMinutes() / 60;
    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const solarWeight = maxKw > 0 ? clamp(s.solarKw / maxKw, 0.4, 1.2) : 1;
    return clamp(0.25 + daylight * 0.9, 0.25, 1.15) * solarWeight;
  });
  const xtx = Array.from({ length: x[0].length }, () => Array(x[0].length).fill(0));
  const xty = Array(x[0].length).fill(0);
  x.forEach((row, i) => {
    const weight = weights[i] ?? 1;
    for (let r = 0; r < row.length; r += 1) {
      xty[r] += row[r] * y[i] * weight;
      for (let c = 0; c < row.length; c += 1) {
        xtx[r][c] += row[r] * row[c] * weight;
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
  options: SolarPredictOptions = {},
) {
  const coverByHour = new Map<string, number>();
  cloudCover.forEach((point) => {
    coverByHour.set(point.time.slice(0, 13), point.value);
  });
  const maxClamp = options.maxClamp ?? model.maxKw * 1.08;
  const raw = times.map((time) => {
    const date = new Date(time);
    const cover = coverByHour.get(time.slice(0, 13)) ?? 0;
    const x = features(date, cover);
    const estimate = dot(x, model.weights);
    return Math.max(model.minKw, Math.min(maxClamp, estimate));
  });
  if (!options.smooth) return raw;
  return smoothSeries(raw, options.smoothAlpha ?? 0.35);
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function smoothSeries(values: number[], alpha: number) {
  if (values.length < 2) return values;
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}
