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

export type SolarAttenuationModel = {
  scale: number;
  alpha: number;
  beta: number;
  minKw: number;
  maxKw: number;
};

type SolarAttenuationSample = {
  time: string;
  cloudCover: number;
  baselineKw: number;
  solarKw: number;
};

function daylightFactor(date: Date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
}

function features(date: Date, cloudCover: number) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const dayOfYear = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) /
      (24 * 60 * 60 * 1000),
  );
  const hourAngle = (2 * Math.PI * hour) / 24;
  const seasonAngle = (2 * Math.PI * dayOfYear) / 365;
  const daylight = daylightFactor(date);
  const cover = Math.min(1, Math.max(0, cloudCover));
  const clear = 1 - cover;
  return [
    1,
    Math.sin(hourAngle),
    Math.cos(hourAngle),
    Math.sin(hourAngle * 2),
    Math.cos(hourAngle * 2),
    Math.sin(seasonAngle),
    Math.cos(seasonAngle),
    Math.sin(seasonAngle * 2),
    Math.cos(seasonAngle * 2),
    daylight,
    daylight * daylight,
    clear,
    Math.pow(clear, 2),
    Math.pow(clear, 3),
    daylight * clear,
    daylight * Math.pow(clear, 2),
    daylight * daylight * clear,
  ];
}

export function trainSolarRegression(samples: SolarSample[], ridge = 0.1): SolarRegressionModel | null {
  if (samples.length < 8) return null;
  const positiveSamples = samples.filter((s) => s.solarKw > 0);
  const maxKw = percentile(
    (positiveSamples.length ? positiveSamples : samples).map((s) => s.solarKw),
    0.95,
  );
  const minKw = 0;
  const x = samples.map((s) => features(new Date(s.time), s.cloudCover));
  const y = samples.map((s) => s.solarKw);
  const xtx = Array.from({ length: x[0].length }, () => Array(x[0].length).fill(0));
  const xty = Array(x[0].length).fill(0);
  x.forEach((row, i) => {
    const daylight = row[9];
    const weight = 0.6 + 0.8 * daylight;
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
) {
  const coverByHour = new Map<string, number>();
  cloudCover.forEach((point) => {
    coverByHour.set(point.time.slice(0, 13), point.value);
  });
  return times.map((time) => {
    const date = new Date(time);
    const cover = coverByHour.get(time.slice(0, 13)) ?? 0;
    const daylight = daylightFactor(date);
    if (daylight <= 0.02) return 0;
    const x = features(date, cover);
    const estimate = dot(x, model.weights);
    const clearBoost = 1.05 + 0.12 * (1 - cover);
    const nightFactor = Math.max(0, Math.min(1, (daylight - 0.05) / 0.95));
    const adjusted = estimate * nightFactor;
    const clamped = Math.max(model.minKw, Math.min(model.maxKw * clearBoost, adjusted));
    return Math.max(0, clamped);
  });
}

export function trainSolarAttenuation(
  samples: SolarAttenuationSample[],
  ridge = 0.08,
): SolarAttenuationModel | null {
  const usable = samples.filter((s) => s.baselineKw > 0.05 && s.solarKw >= 0);
  if (usable.length < 8) return null;
  const maxKw = percentile(usable.map((s) => s.solarKw), 0.95);
  const x = usable.map((s) => {
    const cover = Math.min(1, Math.max(0, s.cloudCover));
    return [1, cover, cover * cover];
  });
  const y = usable.map((s) => {
    const ratio = s.baselineKw > 0 ? s.solarKw / s.baselineKw : 0;
    return Math.max(0, Math.min(1.6, ratio));
  });
  const xtx = Array.from({ length: x[0].length }, () => Array(x[0].length).fill(0));
  const xty = Array(x[0].length).fill(0);
  x.forEach((row, i) => {
    const daylight = daylightFactor(new Date(usable[i].time));
    const weight = 0.55 + 0.9 * daylight;
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
  const scale = clamp(weights[0], 0.2, 1.6);
  const alpha = clamp(-weights[1] / scale, 0, 1.5);
  const beta = clamp(-weights[2] / scale, 0, 1.5);
  return {
    scale,
    alpha,
    beta,
    minKw: 0,
    maxKw: Math.max(0.1, maxKw),
  };
}

export function predictSolarAttenuation(
  model: SolarAttenuationModel,
  clearSky: WeatherPoint[],
  cloudCover: WeatherPoint[],
) {
  const coverByHour = new Map<string, number>();
  cloudCover.forEach((point) => {
    coverByHour.set(point.time.slice(0, 13), point.value);
  });
  return clearSky.map((point) => {
    const baseline = point.value;
    if (baseline <= 0) return { ...point, value: 0 };
    const cover = coverByHour.get(point.time.slice(0, 13)) ?? 0;
    const attenuation = clamp(1 - model.alpha * cover - model.beta * cover * cover, 0.05, 1.12);
    const estimate = baseline * model.scale * attenuation;
    const clamped = Math.max(model.minKw, Math.min(model.maxKw * 1.1, estimate));
    return { ...point, value: Math.max(0, clamped) };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
