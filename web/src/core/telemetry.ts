import type { BacktestConfig } from "./types";
import type { BatteryStatus } from "../engine/monitor";

export type BatterySourceKind =
  | "local-modbus"
  | "sigen-cloud"
  | "vendor-cloud"
  | "simulated";

export type ParsedBatteryMetrics = {
  socPct: number | null;
  essKw: number | null;
  pvKw: number | null;
  gridKw: number | null;
  plantKw: number | null;
  maxChargeKw: number | null;
  maxDischargeKw: number | null;
  chargeCapacityKwh: number | null;
  dischargeCapacityKwh: number | null;
  raw: Record<string, unknown>;
};

export type NormalizedBatteryTelemetry = {
  sourceKind: BatterySourceKind;
  sourceLabel: string;
  status: "live" | "fallback" | "planned" | "error";
  statusLabel: string;
  freshnessLabel: string;
  healthHint: string;
  error: string | null;
  isSimulated: boolean;
  socPct: number;
  reserveSocPct: number;
  batteryKwh: number;
  reserveKwh: number;
  usableKwh: number;
  batteryPowerKw: number;
  solarKw: number | null;
  gridKw: number | null;
  plantKw: number | null;
  maxChargeKw: number;
  maxDischargeKw: number;
  chargeCapacityKwh: number | null;
  dischargeCapacityKwh: number | null;
  raw: Record<string, unknown> | null;
};

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickFirst(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return payload[key];
    }
  }
  return null;
}

export function parseBatteryMetrics(raw: unknown): ParsedBatteryMetrics | null {
  const payload = (raw && typeof raw === "object"
    ? ((raw as Record<string, unknown>).metrics as Record<string, unknown>) ||
      (raw as Record<string, unknown>)
    : null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return null;
  return {
    socPct: toNumber(pickFirst(payload, ["socPct", "soc", "batterySoc"])),
    essKw: toNumber(pickFirst(payload, ["essKw", "essPowerKw", "essPower"])),
    pvKw: toNumber(pickFirst(payload, ["pvKw", "pvPowerKw", "pvPower"])),
    gridKw: toNumber(pickFirst(payload, ["gridKw", "gridPowerKw", "gridPower"])),
    plantKw: toNumber(pickFirst(payload, ["plantKw", "plantPowerKw", "plantPower"])),
    maxChargeKw: toNumber(pickFirst(payload, ["maxChargeKw", "availableMaxChargingKw"])),
    maxDischargeKw: toNumber(
      pickFirst(payload, ["maxDischargeKw", "availableMaxDischargingKw"]),
    ),
    chargeCapacityKwh: toNumber(
      pickFirst(payload, ["chargeCapacityKwh", "availableMaxChargingCapacityKwh"]),
    ),
    dischargeCapacityKwh: toNumber(
      pickFirst(payload, ["dischargeCapacityKwh", "availableMaxDischargingCapacityKwh"]),
    ),
    raw: payload,
  };
}

export function normalizeBatteryTelemetry(input: {
  source: "modbus" | "sigen" | "vendor-cloud";
  metrics: ParsedBatteryMetrics | null;
  batteryStatus: BatteryStatus;
  config: BacktestConfig;
  error?: string | null;
  freshnessLabel?: string | null;
}) : NormalizedBatteryTelemetry {
  const sourceKind: BatterySourceKind =
    input.source === "modbus"
      ? "local-modbus"
      : input.source === "sigen"
        ? "sigen-cloud"
        : "vendor-cloud";
  const live = Boolean(input.metrics);
  const isPlanned = input.source === "vendor-cloud" && !live;
  const sourceLabel =
    sourceKind === "local-modbus"
      ? "Local Modbus TCP"
      : sourceKind === "sigen-cloud"
        ? "Sigenergy Cloud"
        : "Vendor Cloud";
  const socPct = Math.max(
    0,
    Math.min(100, input.metrics?.socPct ?? input.batteryStatus.socPct ?? 0),
  );
  const reserveSocPct = Math.max(
    0,
    Math.min(100, input.batteryStatus.reserveSocPct ?? 0),
  );
  const batteryKwh = (socPct / 100) * input.config.capacityKwh;
  const reserveKwh = (reserveSocPct / 100) * input.config.capacityKwh;
  const usableKwh = Math.max(0, batteryKwh - reserveKwh);
  const status = live ? "live" : isPlanned ? "planned" : input.error ? "error" : "fallback";
  const healthHint = live
    ? `${sourceLabel} feed live.`
    : isPlanned
      ? "Vendor cloud connector is planned, not yet wired."
      : input.error
        ? `${sourceLabel} unavailable. Using simulated battery state.`
        : "Using simulated battery state until a battery source is connected.";
  return {
    sourceKind: live ? sourceKind : isPlanned ? "vendor-cloud" : "simulated",
    sourceLabel,
    status,
    statusLabel:
      status === "live"
        ? "Live"
        : status === "planned"
          ? "Planned"
          : status === "error"
            ? "Error"
            : "Fallback",
    freshnessLabel:
      input.freshnessLabel || (live ? "Fresh telemetry" : "Fallback / simulated"),
    healthHint,
    error: input.error ?? null,
    isSimulated: !live,
    socPct,
    reserveSocPct,
    batteryKwh,
    reserveKwh,
    usableKwh,
    batteryPowerKw: input.metrics?.essKw ?? input.batteryStatus.powerKw ?? 0,
    solarKw: input.metrics?.pvKw ?? null,
    gridKw: input.metrics?.gridKw ?? null,
    plantKw: input.metrics?.plantKw ?? null,
    maxChargeKw:
      input.metrics?.maxChargeKw ?? input.batteryStatus.maxChargeKw ?? input.config.maxPowerKw,
    maxDischargeKw:
      input.metrics?.maxDischargeKw ??
      input.batteryStatus.maxChargeKw ??
      input.config.inverterMaxKw,
    chargeCapacityKwh: input.metrics?.chargeCapacityKwh ?? null,
    dischargeCapacityKwh: input.metrics?.dischargeCapacityKwh ?? null,
    raw: input.metrics?.raw ?? null,
  };
}
