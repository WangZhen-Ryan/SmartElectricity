import { type NormalizedBatteryTelemetry } from "../core/telemetry";
import { type BatteryControlReadiness } from "../core/control";

type MonitorConfig = {
  source: "modbus" | "sigen" | "vendor-cloud";
  bridgeUrl: string;
  host: string;
  port: number;
  unitId: number;
  baseAddr: number;
  byteOrder: "ABCD" | "BADC" | "CDAB" | "DCBA";
  sigenUsername: string;
  sigenPassword: string;
  sigenRegion: string;
};

type BatteryControlConfig = {
  enabled: boolean;
  instantOverride: boolean;
  provider: "generic-modbus" | "home-assistant";
  commandRegister: number;
  commandUnitId: number;
  commandScale: number;
};

type Props = {
  modbusMonitorConfig: MonitorConfig;
  batteryControlConfig: BatteryControlConfig;
  modbusMonitorAutoRefresh: boolean;
  modbusMonitorLoading: boolean;
  modbusMonitorError: string | null;
  batteryTelemetry: NormalizedBatteryTelemetry;
  controlReadiness: BatteryControlReadiness;
  modbusMonitorRaw: unknown;
  onMonitorConfigChange: (next: MonitorConfig) => void;
  onBatteryControlConfigChange: (next: BatteryControlConfig) => void;
  onModbusMonitorAutoRefreshChange: (value: boolean) => void;
  onRefresh: () => void;
  formatJson: (value: unknown) => string;
};

export default function BatteryMonitorPanel({
  modbusMonitorConfig,
  batteryControlConfig,
  modbusMonitorAutoRefresh,
  modbusMonitorLoading,
  modbusMonitorError,
  batteryTelemetry,
  controlReadiness,
  modbusMonitorRaw,
  onMonitorConfigChange,
  onBatteryControlConfigChange,
  onModbusMonitorAutoRefreshChange,
  onRefresh,
  formatJson,
}: Props) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Battery Monitor & Local Control</h2>
        <p className="hint">
          {modbusMonitorConfig.source === "modbus"
            ? "Local Modbus telemetry with optional local-only control bridge."
            : modbusMonitorConfig.source === "sigen"
              ? "sigen cloud feed with optional Home Assistant or Generic Modbus control."
              : "Vendor cloud placeholder — normalized model ready, connector pending."}
        </p>
      </div>
      <div className="field">
        <label>Battery Source</label>
        <div className="toggle">
          <button
            className={modbusMonitorConfig.source === "modbus" ? "active" : ""}
            onClick={() => onMonitorConfigChange({ ...modbusMonitorConfig, source: "modbus" })}
          >
            Local Modbus
          </button>
          <button
            className={modbusMonitorConfig.source === "sigen" ? "active" : ""}
            onClick={() => onMonitorConfigChange({ ...modbusMonitorConfig, source: "sigen" })}
          >
            sigen Cloud
          </button>
          <button
            className={modbusMonitorConfig.source === "vendor-cloud" ? "active" : ""}
            onClick={() =>
              onMonitorConfigChange({ ...modbusMonitorConfig, source: "vendor-cloud" })
            }
          >
            Vendor Cloud
          </button>
        </div>
      </div>
      <div className="field">
        <label>Bridge URL (local)</label>
        <input
          value={modbusMonitorConfig.bridgeUrl}
          onChange={(event) =>
            onMonitorConfigChange({ ...modbusMonitorConfig, bridgeUrl: event.target.value })
          }
          placeholder="http://YOUR-BRIDGE-HOST:8787"
        />
      </div>
      {modbusMonitorConfig.source === "modbus" ? (
        <div className="monitor-grid">
          <div className="field">
            <label>Host</label>
            <input
              value={modbusMonitorConfig.host}
              onChange={(event) =>
                onMonitorConfigChange({ ...modbusMonitorConfig, host: event.target.value })
              }
              placeholder="YOUR-MODBUS-HOST"
            />
          </div>
          <div className="field">
            <label>Port</label>
            <input
              type="number"
              value={modbusMonitorConfig.port || ""}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  port: Number(event.target.value) || 0,
                })
              }
              placeholder="502"
            />
          </div>
          <div className="field">
            <label>Unit ID</label>
            <input
              type="number"
              value={modbusMonitorConfig.unitId || ""}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  unitId: Number(event.target.value) || 0,
                })
              }
              placeholder="247"
            />
          </div>
          <div className="field">
            <label>Base Address</label>
            <input
              type="number"
              value={modbusMonitorConfig.baseAddr || ""}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  baseAddr: Number(event.target.value) || 0,
                })
              }
              placeholder="30000"
            />
          </div>
          <div className="field">
            <label>Byte Order</label>
            <select
              value={modbusMonitorConfig.byteOrder}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  byteOrder: event.target.value as MonitorConfig["byteOrder"],
                })
              }
            >
              <option value="ABCD">ABCD</option>
              <option value="BADC">BADC</option>
              <option value="CDAB">CDAB</option>
              <option value="DCBA">DCBA</option>
            </select>
          </div>
        </div>
      ) : modbusMonitorConfig.source === "sigen" ? (
        <div className="monitor-grid">
          <div className="field">
            <label>sigen Username</label>
            <input
              value={modbusMonitorConfig.sigenUsername}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  sigenUsername: event.target.value,
                })
              }
              placeholder="email / account"
            />
          </div>
          <div className="field">
            <label>sigen Password</label>
            <input
              type="password"
              value={modbusMonitorConfig.sigenPassword}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  sigenPassword: event.target.value,
                })
              }
              placeholder="only used locally"
            />
          </div>
          <div className="field">
            <label>Region</label>
            <select
              value={modbusMonitorConfig.sigenRegion}
              onChange={(event) =>
                onMonitorConfigChange({
                  ...modbusMonitorConfig,
                  sigenRegion: event.target.value,
                })
              }
            >
              <option value="apac">apac</option>
              <option value="eu">eu</option>
              <option value="us">us</option>
              <option value="cn">cn</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="summary-card">
          <span className="mono">Vendor Cloud</span>
          <strong>Planned connector</strong>
          <span className="hint">
            Normalized battery model is ready; vendor-specific cloud auth/control wiring is still
            pending.
          </span>
        </div>
      )}
      <div className="hero-actions">
        <button className="ghost" onClick={onRefresh} disabled={modbusMonitorLoading}>
          {modbusMonitorLoading ? "Refreshing..." : "Refresh"}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={modbusMonitorAutoRefresh}
            onChange={(event) => onModbusMonitorAutoRefreshChange(event.target.checked)}
          />
          <span>Auto refresh (10s)</span>
        </label>
        <span className="hint">
          {modbusMonitorError
            ? `Failed to read ${
                modbusMonitorConfig.source === "modbus" ? "Modbus" : "sigen"
              }: ${modbusMonitorError}`
            : "Read-only metrics."}
        </span>
      </div>
      <div className="hint">
        Source: {batteryTelemetry.sourceLabel} · {batteryTelemetry.freshnessLabel} ·{" "}
        {batteryTelemetry.healthHint}
      </div>
      <div className="divider" />
      <div className="panel-header">
        <h3>Battery Control Permissions</h3>
        <p className="hint">
          Advanced local capability only. Commands must go to your own Home Assistant or Generic Modbus bridge.
        </p>
      </div>
      <div className="monitor-grid">
        <div className="monitor-card">
          <span className="mono">Control Mode</span>
          <strong>{controlReadiness.statusLabel}</strong>
          <span className="hint">{controlReadiness.modeLabel}</span>
        </div>
        <div className="monitor-card">
          <span className="mono">Provider</span>
          <strong>{controlReadiness.provider}</strong>
          <span className="hint">
            {controlReadiness.providerSupported ? "Release-supported" : "Unsupported"}
          </span>
        </div>
        <div className="monitor-card">
          <span className="mono">Local Health</span>
          <strong>{controlReadiness.localHealth}</strong>
          <span className="hint">
            {controlReadiness.localOnly
              ? "Local-only path confirmed"
              : "Commands must target your local bridge"}
          </span>
        </div>
        <div className="monitor-card">
          <span className="mono">Cloud Boundary</span>
          <strong>{controlReadiness.boundaryLabel}</strong>
          <span className="hint">Bridge URL, credentials, and tokens stay local</span>
        </div>
      </div>
      <div className="monitor-grid">
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={batteryControlConfig.enabled}
              onChange={(event) =>
                onBatteryControlConfigChange({
                  ...batteryControlConfig,
                  enabled: event.target.checked,
                })
              }
            />
            <span>Enable generic battery control profile</span>
          </label>
        </div>
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={batteryControlConfig.instantOverride}
              onChange={(event) =>
                onBatteryControlConfigChange({
                  ...batteryControlConfig,
                  instantOverride: event.target.checked,
                })
              }
              disabled={!batteryControlConfig.enabled}
            />
            <span>Allow instant override from Home</span>
          </label>
        </div>
        <div className="field">
          <label>Control Provider</label>
          <select
            value={batteryControlConfig.provider}
            onChange={(event) =>
              onBatteryControlConfigChange({
                ...batteryControlConfig,
                provider: event.target.value as BatteryControlConfig["provider"],
              })
            }
          >
            <option value="generic-modbus">Generic Modbus</option>
            <option value="home-assistant">Home Assistant</option>
          </select>
        </div>
        <div className="field">
          <label>Command Register</label>
          <input
            type="number"
            value={batteryControlConfig.commandRegister}
            onChange={(event) =>
              onBatteryControlConfigChange({
                ...batteryControlConfig,
                commandRegister: Number(event.target.value) || 40001,
              })
            }
          />
        </div>
        <div className="field">
          <label>Command Unit ID</label>
          <input
            type="number"
            value={batteryControlConfig.commandUnitId}
            onChange={(event) =>
              onBatteryControlConfigChange({
                ...batteryControlConfig,
                commandUnitId: Number(event.target.value) || 247,
              })
            }
          />
        </div>
        <div className="field">
          <label>Command Scale</label>
          <input
            type="number"
            value={batteryControlConfig.commandScale}
            onChange={(event) =>
              onBatteryControlConfigChange({
                ...batteryControlConfig,
                commandScale: Number(event.target.value) || 1000,
              })
            }
          />
        </div>
      </div>
      <div className="hint">
        Default state is safe: monitoring and advisory only. Local commands are unlocked only when
        provider, local bridge health, and live telemetry gates all pass.
      </div>
      {controlReadiness.blockedReasons.length ? (
        <ul className="reason-list">
          {controlReadiness.blockedReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <div className="monitor-grid">
        <div className="monitor-card">
          <span className="mono">Status</span>
          <strong>{batteryTelemetry.status}</strong>
          <span className="hint">{batteryTelemetry.healthHint}</span>
        </div>
        <div className="monitor-card">
          <span className="mono">SOC</span>
          <strong>{`${batteryTelemetry.socPct.toFixed(1)}%`}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">ESS Power</span>
          <strong>{`${batteryTelemetry.batteryPowerKw.toFixed(2)} kW`}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">PV Power</span>
          <strong>{batteryTelemetry.solarKw !== null ? `${batteryTelemetry.solarKw.toFixed(2)} kW` : "— kW"}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">Grid Power</span>
          <strong>{batteryTelemetry.gridKw !== null ? `${batteryTelemetry.gridKw.toFixed(2)} kW` : "— kW"}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">Plant Power</span>
          <strong>{batteryTelemetry.plantKw !== null ? `${batteryTelemetry.plantKw.toFixed(2)} kW` : "— kW"}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">Max Charge</span>
          <strong>{`${batteryTelemetry.maxChargeKw.toFixed(2)} kW`}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">Max Discharge</span>
          <strong>{`${batteryTelemetry.maxDischargeKw.toFixed(2)} kW`}</strong>
        </div>
        <div className="monitor-card">
          <span className="mono">Charge Capacity</span>
          <strong>
            {batteryTelemetry.chargeCapacityKwh !== null
              ? `${batteryTelemetry.chargeCapacityKwh.toFixed(2)} kWh`
              : "— kWh"}
          </strong>
        </div>
        <div className="monitor-card">
          <span className="mono">Discharge Capacity</span>
          <strong>
            {batteryTelemetry.dischargeCapacityKwh !== null
              ? `${batteryTelemetry.dischargeCapacityKwh.toFixed(2)} kWh`
              : "— kWh"}
          </strong>
        </div>
      </div>
      <details className="panel-details">
        <summary>Raw Modbus payload</summary>
        <pre className="code-block">{formatJson(modbusMonitorRaw)}</pre>
      </details>
    </section>
  );
}
