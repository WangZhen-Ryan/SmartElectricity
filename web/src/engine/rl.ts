import { BacktestConfig, RawInterval } from "../core/types";

export type RlAlgorithm = "q-learning" | "policy-gradient";

export type RlModel = {
  algorithm: RlAlgorithm;
  qTable?: Record<string, number[]>;
  weights?: number[][];
  episodes?: number;
};

export type RlTrainResponse = RlModel & {
  error?: string;
};

export type RlEvalResponse = {
  profit: number;
  endSoc: number;
};

type RlTrainOptions = {
  algorithm: RlAlgorithm;
  episodes: number;
  alpha: number;
  gamma: number;
  epsilon: number;
};

function buildHeaders(anonKey?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
  return headers;
}

export async function trainRl(
  apiBase: string,
  anonKey: string | undefined,
  payload: RawInterval[],
  solar: number[],
  config: BacktestConfig,
  options: RlTrainOptions,
): Promise<RlTrainResponse> {
  const resp = await fetch(`${apiBase}/rl/train`, {
    method: "POST",
    headers: buildHeaders(anonKey),
    body: JSON.stringify({
      payload,
      solar,
      config,
      algorithm: options.algorithm,
      episodes: options.episodes,
      alpha: options.alpha,
      gamma: options.gamma,
      epsilon: options.epsilon,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`RL train error ${resp.status}: ${text}`);
  }
  return resp.json();
}

export async function evalRl(
  apiBase: string,
  anonKey: string | undefined,
  payload: RawInterval[],
  solar: number[],
  config: BacktestConfig,
  model: RlModel,
): Promise<RlEvalResponse> {
  const resp = await fetch(`${apiBase}/rl/eval`, {
    method: "POST",
    headers: buildHeaders(anonKey),
    body: JSON.stringify({
      payload,
      solar,
      config,
      qTable: model.qTable,
      weights: model.weights,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`RL eval error ${resp.status}: ${text}`);
  }
  return resp.json();
}
