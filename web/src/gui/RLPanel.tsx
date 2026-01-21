import { useMemo, useState } from "react";
import { BacktestConfig, RawInterval } from "../core/types";
import { evalRl, RlAlgorithm, RlModel, trainRl } from "../engine/rl";

type Props = {
  apiBase: string;
  anonKey?: string;
  payload: RawInterval[] | null;
  solar: number[];
  config: BacktestConfig;
  onError: (message: string) => void;
};

type RlConfig = {
  enabled: boolean;
  state: {
    price: boolean;
    soc: boolean;
    solar: boolean;
    time: boolean;
  };
  actionSpace: "discrete" | "continuous";
  training: "offline" | "online" | "evaluation";
  baseline: RlAlgorithm;
};

const defaultConfig: RlConfig = {
  enabled: false,
  state: { price: true, soc: true, solar: true, time: true },
  actionSpace: "discrete",
  training: "offline",
  baseline: "q-learning",
};

const defaultHyper = {
  episodes: 25,
  alpha: 0.2,
  gamma: 0.9,
  epsilon: 0.1,
};

function storageAvailable() {
  try {
    return typeof window !== "undefined" && "localStorage" in window;
  } catch {
    return false;
  }
}

export default function RLPanel({ apiBase, anonKey, payload, solar, config, onError }: Props) {
  const [rlConfig, setRlConfig] = useState<RlConfig>(defaultConfig);
  const [hyper, setHyper] = useState(defaultHyper);
  const [model, setModel] = useState<RlModel | null>(null);
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);
  const [evalResult, setEvalResult] = useState<{ profit: number; endSoc: number } | null>(null);
  const [trainProgress, setTrainProgress] = useState(0);

  const canTrain = Boolean(apiBase && payload?.length);

  const modelSummary = useMemo(() => {
    if (!model) return "No model loaded.";
    if (model.algorithm === "q-learning") {
      return `Q-table states: ${Object.keys(model.qTable || {}).length}`;
    }
    return `Policy weights: ${model.weights?.length || 0}x${model.weights?.[0]?.length || 0}`;
  }, [model]);

  async function handleTrain() {
    if (!payload?.length) {
      onError("Load data before training.");
      return;
    }
    setLoading(true);
    setStatus("Training...");
    setTrainProgress(5);
    const timer = window.setInterval(() => {
      setTrainProgress((prev) => (prev < 90 ? prev + 5 : prev));
    }, 600);
    try {
      const result = await trainRl(apiBase, anonKey, payload, solar, config, {
        algorithm: rlConfig.baseline,
        episodes: hyper.episodes,
        alpha: hyper.alpha,
        gamma: hyper.gamma,
        epsilon: hyper.epsilon,
      });
      setModel({ algorithm: rlConfig.baseline, qTable: result.qTable, weights: result.weights });
      setStatus(`Trained (${result.episodes || hyper.episodes} episodes)`);
      setEvalResult(null);
      setTrainProgress(100);
    } catch (err) {
      onError(err instanceof Error ? err.message : "RL training failed.");
      setStatus("Training failed");
    } finally {
      window.clearInterval(timer);
      window.setTimeout(() => setTrainProgress(0), 800);
      setLoading(false);
    }
  }

  async function handleEval() {
    if (!payload?.length || !model) {
      onError("Train or load a model before evaluation.");
      return;
    }
    setLoading(true);
    setStatus("Evaluating...");
    try {
      const result = await evalRl(apiBase, anonKey, payload, solar, config, model);
      setEvalResult(result);
      setStatus("Evaluation done");
    } catch (err) {
      onError(err instanceof Error ? err.message : "RL evaluation failed.");
      setStatus("Evaluation failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSaveModel() {
    if (!model) return;
    if (!storageAvailable()) {
      onError("Local storage unavailable.");
      return;
    }
    localStorage.setItem("rlModel", JSON.stringify(model));
    setStatus("Model saved to local storage.");
  }

  function handleLoadModel() {
    if (!storageAvailable()) {
      onError("Local storage unavailable.");
      return;
    }
    const raw = localStorage.getItem("rlModel");
    if (!raw) {
      onError("No saved model found.");
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setModel(parsed);
      setStatus("Model loaded from local storage.");
    } catch {
      onError("Failed to parse saved model.");
    }
  }

  function handleDownloadModel() {
    if (!model) return;
    const blob = new Blob([JSON.stringify(model, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rl_model.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>RL Strategy (Backend Training)</h2>
        <p className="hint">Train and evaluate via Supabase Functions</p>
      </div>
      <div className="field">
        <label>Enable RL training</label>
        <label className="check">
          <input
            type="checkbox"
            checked={rlConfig.enabled}
            onChange={(e) => setRlConfig({ ...rlConfig, enabled: e.target.checked })}
          />
          <span>Use RL agent for backtesting</span>
        </label>
      </div>
      <div className="field">
        <label>State features</label>
        <div className="row">
          {[
            { key: "price", label: "Price" },
            { key: "soc", label: "SOC" },
            { key: "solar", label: "Solar" },
            { key: "time", label: "Time" },
          ].map((item) => (
            <label key={item.key} className="check">
              <input
                type="checkbox"
                checked={rlConfig.state[item.key as keyof typeof rlConfig.state]}
                onChange={(e) =>
                  setRlConfig({
                    ...rlConfig,
                    state: { ...rlConfig.state, [item.key]: e.target.checked },
                  })
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Action space</label>
        <select
          value={rlConfig.actionSpace}
          onChange={(e) => setRlConfig({ ...rlConfig, actionSpace: e.target.value as RlConfig["actionSpace"] })}
        >
          <option value="discrete">Discrete (buy / sell / hold)</option>
          <option value="continuous">Continuous (power dispatch)</option>
        </select>
      </div>
      <div className="field">
        <label>Training mode</label>
        <select
          value={rlConfig.training}
          onChange={(e) => setRlConfig({ ...rlConfig, training: e.target.value as RlConfig["training"] })}
        >
          <option value="offline">Offline (historical replay)</option>
          <option value="online">Online (live learning)</option>
          <option value="evaluation">Evaluation only</option>
        </select>
      </div>
      <div className="field">
        <label>Baseline algorithm</label>
        <select
          value={rlConfig.baseline}
          onChange={(e) => setRlConfig({ ...rlConfig, baseline: e.target.value as RlAlgorithm })}
        >
          <option value="q-learning">Q-Learning (tabular)</option>
          <option value="policy-gradient">Policy Gradient</option>
        </select>
      </div>
      <div className="field">
        <label>Hyperparameters</label>
        <div className="row">
          <input
            type="number"
            value={hyper.episodes}
            onChange={(e) => setHyper({ ...hyper, episodes: Number(e.target.value) })}
            placeholder="Episodes"
          />
          <input
            type="number"
            value={hyper.alpha}
            step="0.05"
            onChange={(e) => setHyper({ ...hyper, alpha: Number(e.target.value) })}
            placeholder="Alpha"
          />
          <input
            type="number"
            value={hyper.gamma}
            step="0.05"
            onChange={(e) => setHyper({ ...hyper, gamma: Number(e.target.value) })}
            placeholder="Gamma"
          />
          <input
            type="number"
            value={hyper.epsilon}
            step="0.05"
            onChange={(e) => setHyper({ ...hyper, epsilon: Number(e.target.value) })}
            placeholder="Epsilon"
          />
        </div>
      </div>
      <div className="hero-actions">
        <button className="primary" onClick={() => handleTrain()} disabled={!canTrain || loading}>
          {loading ? "Training..." : "Train RL"}
        </button>
        <button className="ghost" onClick={() => handleEval()} disabled={!model || loading}>
          Evaluate
        </button>
        <button className="ghost" onClick={handleSaveModel} disabled={!model}>
          Save Model
        </button>
        <button className="ghost" onClick={handleLoadModel}>
          Load Model
        </button>
        <button className="ghost" onClick={handleDownloadModel} disabled={!model}>
          Download Model
        </button>
      </div>
      {trainProgress > 0 && (
        <div className="progress-bar" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${trainProgress}%` }} />
        </div>
      )}
      <div className="stats">
        <div>
          <span>Status</span>
          <strong>{status}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{modelSummary}</strong>
        </div>
        <div>
          <span>Eval Profit</span>
          <strong>{evalResult ? evalResult.profit.toFixed(2) : "—"}</strong>
        </div>
        <div>
          <span>Eval End SOC</span>
          <strong>{evalResult ? evalResult.endSoc.toFixed(2) : "—"}</strong>
        </div>
      </div>
    </section>
  );
}
