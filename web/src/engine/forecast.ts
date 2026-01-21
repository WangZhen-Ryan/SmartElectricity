function ar1Coefficient(series: number[]) {
  if (series.length < 2) return 0;
  const xs = series.slice(0, -1);
  const ys = series.slice(1);
  const xMean = average(xs);
  const yMean = average(ys);
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - xMean) * (ys[i] - yMean);
    den += (x - xMean) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

export function arimaForecast(values: number[], horizon: number) {
  if (values.length < 3) return values.slice(-horizon);
  const diffs = values.slice(1).map((v, i) => v - values[i]);
  const phi = ar1Coefficient(diffs);
  const forecasts: number[] = [];
  let last = values[values.length - 1];
  let diff = diffs[diffs.length - 1] || 0;
  for (let i = 0; i < horizon; i += 1) {
    diff = phi * diff;
    last += diff;
    forecasts.push(last);
  }
  return forecasts;
}

export function prophetForecast(values: number[], horizon: number, period: number) {
  if (!values.length) return [];
  const n = values.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const design = xs.map((t) => [
    1,
    t,
    Math.sin((2 * Math.PI * t) / period),
    Math.cos((2 * Math.PI * t) / period),
  ]);
  const coeffs = linearRegression(design, values);
  const forecasts = [];
  for (let i = 0; i < horizon; i += 1) {
    const t = n + i;
    const row = [
      1,
      t,
      Math.sin((2 * Math.PI * t) / period),
      Math.cos((2 * Math.PI * t) / period),
    ];
    forecasts.push(dot(row, coeffs));
  }
  return forecasts;
}

function linearRegression(matrix: number[][], y: number[]) {
  const xtx = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const xty = [0, 0, 0, 0];
  matrix.forEach((row, i) => {
    for (let r = 0; r < 4; r += 1) {
      xty[r] += row[r] * y[i];
      for (let c = 0; c < 4; c += 1) {
        xtx[r][c] += row[r] * row[c];
      }
    }
  });
  const inv = invert4x4(xtx);
  return multiplyMatrixVector(inv, xty);
}

function invert4x4(m: number[][]) {
  const a = m.map((row) => row.slice());
  const inv = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let i = 0; i < 4; i += 1) {
    let pivot = a[i][i];
    if (pivot === 0) pivot = 1e-6;
    for (let j = 0; j < 4; j += 1) {
      a[i][j] /= pivot;
      inv[i][j] /= pivot;
    }
    for (let k = 0; k < 4; k += 1) {
      if (k === i) continue;
      const factor = a[k][i];
      for (let j = 0; j < 4; j += 1) {
        a[k][j] -= factor * a[i][j];
        inv[k][j] -= factor * inv[i][j];
      }
    }
  }
  return inv;
}

function multiplyMatrixVector(m: number[][], v: number[]) {
  return m.map((row) => dot(row, v));
}

function dot(a: number[], b: number[]) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}
