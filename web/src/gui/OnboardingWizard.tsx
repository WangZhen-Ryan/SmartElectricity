import { useMemo, useState } from "react";
import { buildAmberHeaders, fetchCurrent } from "../data/amber";

type ModbusConfig = {
  bridgeUrl: string;
  host: string;
  port: number;
  unitId: number;
  baseAddr: number;
  byteOrder: "ABCD" | "BADC" | "CDAB" | "DCBA";
};

type TestStatus = {
  state: "idle" | "testing" | "ok" | "error";
  message: string;
};

type OnboardingWizardProps = {
  apiBase: string;
  anonKey?: string;
  defaultSiteId: string;
  defaultToken: string;
  onApply: (next: { siteId: string; token: string; modbus: ModbusConfig }) => void;
  onConnectionEvent?: (event: {
    service: "amber" | "modbus";
    status: "ok" | "error" | "testing";
    message: string;
  }) => void;
};

const stepLabels = ["Amber", "Modbus", "Finish"] as const;

export default function OnboardingWizard({
  apiBase,
  anonKey,
  defaultSiteId,
  defaultToken,
  onApply,
  onConnectionEvent,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [siteId, setSiteId] = useState(defaultSiteId);
  const [token, setToken] = useState(defaultToken);
  const [modbus, setModbus] = useState<ModbusConfig>({
    bridgeUrl: "",
    host: "",
    port: 0,
    unitId: 0,
    baseAddr: 0,
    byteOrder: "ABCD",
  });
  const [amberStatus, setAmberStatus] = useState<TestStatus>({
    state: "idle",
    message: "Use your Amber Site ID + token, then test.",
  });
  const [modbusStatus, setModbusStatus] = useState<TestStatus>({
    state: "idle",
    message: "Provide bridge URL + device info, then test.",
  });

  const defaultsHint = useMemo(() => {
    if (!defaultSiteId && !defaultToken) {
      return "Start with your own Amber site ID and token.";
    }
    const hintSite = defaultSiteId ? `Site ${defaultSiteId}` : "Site ID not loaded";
    const hintToken = defaultToken ? "Token loaded" : "Token stored server-side";
    return `${hintSite} · ${hintToken}`;
  }, [defaultSiteId, defaultToken]);

  async function handleAmberTest() {
    if (!apiBase) {
      setAmberStatus({ state: "error", message: "Missing API base URL." });
      return;
    }
    if (!siteId.trim()) {
      setAmberStatus({ state: "error", message: "Enter a Site ID first." });
      return;
    }
    setAmberStatus({ state: "testing", message: "Testing Amber API..." });
    onConnectionEvent?.({
      service: "amber",
      status: "testing",
      message: "Testing Amber API...",
    });
    try {
      const headers = buildAmberHeaders(token.trim(), anonKey);
      const result = await fetchCurrent(
        apiBase,
        {
          siteId: siteId.trim(),
          previous: "0",
          next: "1",
          resolution: "30",
        },
        headers,
      );
      const count = result.data.length;
      setAmberStatus({
        state: "ok",
        message: count ? `Success: ${count} interval(s) received.` : "Success: empty response.",
      });
      onConnectionEvent?.({
        service: "amber",
        status: "ok",
        message: count ? `Amber ok (${count} interval)` : "Amber ok (empty response)",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Amber test failed.";
      setAmberStatus({ state: "error", message });
      onConnectionEvent?.({
        service: "amber",
        status: "error",
        message,
      });
    }
  }

  async function handleModbusTest() {
    if (!modbus.bridgeUrl.trim()) {
      setModbusStatus({ state: "error", message: "Enter bridge URL first." });
      return;
    }
    setModbusStatus({ state: "testing", message: "Testing Modbus bridge..." });
    onConnectionEvent?.({
      service: "modbus",
      status: "testing",
      message: "Testing Modbus bridge...",
    });
    const base = modbus.bridgeUrl.replace(/\/+$/, "");
    try {
      const validateResp = await fetch(`${base}/api/config/validate`);
      const validateJson = await validateResp.json().catch(() => null);
      if (validateJson && (validateJson.errors?.length || validateJson.warnings?.length)) {
        if (!validateResp.ok || validateJson.errors?.length) {
          const message = [
            validateJson.message || "Bridge config is incomplete.",
            ...(Array.isArray(validateJson.errors) ? validateJson.errors : []),
          ].join(" ");
          setModbusStatus({ state: "error", message });
          onConnectionEvent?.({
            service: "modbus",
            status: "error",
            message,
          });
          return;
        }
      }
    } catch (_err) {
      // Older bridges may not implement /api/config/validate yet.
    }
    const telemetryUrl = `${base}/api/battery/telemetry?provider=generic-modbus&host=${encodeURIComponent(
      modbus.host,
    )}&port=${encodeURIComponent(String(modbus.port))}&unitId=${encodeURIComponent(
      String(modbus.unitId),
    )}&byteOrder=${encodeURIComponent(modbus.byteOrder)}&baseAddr=${encodeURIComponent(
      String(modbus.baseAddr),
    )}`;
    const metricsUrl = `${base}/api/modbus/metrics?host=${encodeURIComponent(
      modbus.host,
    )}&port=${encodeURIComponent(String(modbus.port))}&unitId=${encodeURIComponent(
      String(modbus.unitId),
    )}&byteOrder=${encodeURIComponent(modbus.byteOrder)}&baseAddr=${encodeURIComponent(
      String(modbus.baseAddr),
    )}`;
    try {
      const telemetryResp = await fetch(telemetryUrl);
      if (telemetryResp.ok) {
        const telemetryJson = await telemetryResp.json().catch(() => null);
        if (
          telemetryJson &&
          (telemetryJson.ok ||
            telemetryJson.metrics ||
            telemetryJson.socPct !== undefined ||
            telemetryJson.live !== undefined)
        ) {
          setModbusStatus({ state: "ok", message: "Battery telemetry bridge succeeded." });
          onConnectionEvent?.({
            service: "modbus",
            status: "ok",
            message: "Battery telemetry bridge succeeded.",
          });
          return;
        }
      }
      const resp = await fetch(metricsUrl);
      if (resp.ok) {
        const json = await resp.json();
        if (json && (json.ok || json.metrics)) {
          setModbusStatus({ state: "ok", message: "Modbus read succeeded." });
          onConnectionEvent?.({
            service: "modbus",
            status: "ok",
            message: "Modbus read succeeded.",
          });
          return;
        }
      }
      const healthResp = await fetch(`${base}/api/health`);
      if (healthResp.ok) {
        setModbusStatus({
          state: "error",
          message:
            "Bridge reachable, but telemetry endpoint is missing. Start your Home Assistant or Generic Modbus bridge and implement /api/battery/telemetry.",
        });
        onConnectionEvent?.({
          service: "modbus",
          status: "error",
          message: "Bridge reachable but /api/battery/telemetry missing.",
        });
        return;
      }
      setModbusStatus({ state: "error", message: "Bridge not reachable." });
      onConnectionEvent?.({
        service: "modbus",
        status: "error",
        message: "Bridge not reachable.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Modbus test failed.";
      setModbusStatus({ state: "error", message });
      onConnectionEvent?.({
        service: "modbus",
        status: "error",
        message,
      });
    }
  }

  return (
    <section className="panel onboarding">
      <div className="panel-header">
        <div>
          <h2>Onboarding Wizard</h2>
          <p className="hint">
            Configure Amber + your local battery bridge. Launch support is Home Assistant or
            Generic Modbus only.
          </p>
        </div>
        <div className="wizard-defaults">
          <span className="mono">Current defaults</span>
          <span className="hint">{defaultsHint}</span>
        </div>
      </div>

      <div className="wizard-steps">
        {stepLabels.map((label, idx) => (
          <button
            key={label}
            className={`wizard-step ${idx === step ? "active" : ""}`}
            onClick={() => setStep(idx)}
            type="button"
          >
            <span className="mono">Step {idx + 1}</span>
            <strong>{label}</strong>
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="wizard-card">
          <h3>Amber Account</h3>
          <div className="field">
            <label>Site ID</label>
            <input
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              placeholder="your-site-id"
            />
          </div>
          <div className="field">
            <label>Token</label>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              placeholder="Amber API token"
            />
          </div>
          <div className="row">
            <button className="primary" type="button" onClick={handleAmberTest}>
              {amberStatus.state === "testing" ? "Testing..." : "Test Amber"}
            </button>
            <span className={`hint status-${amberStatus.state}`}>{amberStatus.message}</span>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-card">
          <h3>Modbus (Read-only)</h3>
          <div className="field">
            <label>Bridge URL</label>
            <input
              value={modbus.bridgeUrl}
              onChange={(event) =>
                setModbus((prev) => ({ ...prev, bridgeUrl: event.target.value }))
              }
              placeholder="http://localhost:5174"
            />
          </div>
          <div className="field">
            <label>Host</label>
            <input
              value={modbus.host}
              onChange={(event) =>
                setModbus((prev) => ({ ...prev, host: event.target.value }))
              }
              placeholder="192.168.0.188"
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Port</label>
              <input
                type="number"
                value={modbus.port}
                onChange={(event) =>
                  setModbus((prev) => ({ ...prev, port: Number(event.target.value) }))
                }
              />
            </div>
            <div className="field">
              <label>Unit ID</label>
              <input
                type="number"
                value={modbus.unitId}
                onChange={(event) =>
                  setModbus((prev) => ({ ...prev, unitId: Number(event.target.value) }))
                }
              />
            </div>
            <div className="field">
              <label>Base Addr</label>
              <input
                type="number"
                value={modbus.baseAddr}
                onChange={(event) =>
                  setModbus((prev) => ({ ...prev, baseAddr: Number(event.target.value) }))
                }
              />
            </div>
            <div className="field">
              <label>Byte Order</label>
              <select
                value={modbus.byteOrder}
                onChange={(event) =>
                  setModbus((prev) => ({
                    ...prev,
                    byteOrder: event.target.value as ModbusConfig["byteOrder"],
                  }))
                }
              >
                <option value="ABCD">ABCD</option>
                <option value="BADC">BADC</option>
                <option value="CDAB">CDAB</option>
                <option value="DCBA">DCBA</option>
              </select>
            </div>
          </div>
          <div className="row">
            <button className="primary" type="button" onClick={handleModbusTest}>
              {modbusStatus.state === "testing" ? "Testing..." : "Test Modbus"}
            </button>
            <span className={`hint status-${modbusStatus.state}`}>{modbusStatus.message}</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-card">
          <h3>Apply Settings</h3>
          <p className="hint">
            Defaults remain active until you apply. You can always revert by reloading.
          </p>
          <div className="summary-grid">
            <div className="summary-card">
              <span className="mono">Amber Site</span>
              <strong>{siteId || "—"}</strong>
              <span className="hint">Token {token ? "provided" : "missing"}</span>
            </div>
            <div className="summary-card">
              <span className="mono">Modbus Host</span>
              <strong>{modbus.host || "—"}</strong>
              <span className="hint">
                {modbus.port} · Unit {modbus.unitId}
              </span>
            </div>
            <div className="summary-card">
              <span className="mono">Bridge</span>
              <strong>{modbus.bridgeUrl || "—"}</strong>
              <span className="hint">Byte order {modbus.byteOrder}</span>
            </div>
          </div>
          <div className="row">
            <button
              className="primary"
              type="button"
              onClick={() => {
                onApply({ siteId, token, modbus });
                onConnectionEvent?.({
                  service: "amber",
                  status: "ok",
                  message: "Applied onboarding settings to session.",
                });
              }}
            >
              Apply To Session
            </button>
            <span className="hint">No automatic changes unless you click apply.</span>
          </div>
        </div>
      )}

      <div className="wizard-footer">
        <button
          className="ghost small"
          type="button"
          onClick={() => setStep((prev) => Math.max(0, prev - 1))}
          disabled={step === 0}
        >
          Back
        </button>
        <button
          className="ghost small"
          type="button"
          onClick={() => setStep((prev) => Math.min(stepLabels.length - 1, prev + 1))}
          disabled={step === stepLabels.length - 1}
        >
          Next
        </button>
      </div>
    </section>
  );
}
