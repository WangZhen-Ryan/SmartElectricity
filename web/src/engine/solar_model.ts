import { WeatherPoint } from "../core/types";

type SolarSample = {
  time: string;
  cloudCover: number;
  solarKw: number;
};

export type SolarRegressionModel = {
  weights: number[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const hourAngle2 = 2 * hourAngle;
  const seasonAngle2 = 2 * seasonAngle;
  const daylight = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
  const cover = clamp(cloudCover, 0, 1);
  const cover2 = cover * cover;
  return [
    1,
    Math.sin(hourAngle),
    Math.cos(hourAngle),
    Math.sin(hourAngle2),
    Math.cos(hourAngle2),
    Math.sin(seasonAngle),
    Math.cos(seasonAngle),
    Math.sin(seasonAngle2),
    Math.cos(seasonAngle2),
    daylight,
    1 - cover,
    cover,
    cover2,
    daylight * (1 - cover),
    daylight * cover,
  ];
}

export function trainSolarRegression(samples: SolarSample[], ridge = 0.12): SolarRegressionModel | null {
  if (samples.length < 12) return null;
  const x = samples.map((s) => features(new Date(s.time), s.cloudCover));
  const y = samples.map((s) => s.solarKw);
  const xtx = Array.from({ length: x[0].length }, () => Array(x[0].length).fill(0));
  const xty = Array(x[0].length).fill(0);
  x.forEach((row, i) => {
    const weight = Math.max(0.4, Math.min(1.4, y[i] / 4));
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
  return { weights };
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
    const x = features(date, cover);
    return Math.max(0, dot(x, model.weights));
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
