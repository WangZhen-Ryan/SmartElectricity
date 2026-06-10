import type { NormalizedBatteryTelemetry } from "./telemetry";

export type BatteryControlProvider =
  | "generic-modbus"
  | "home-assistant";

export type BatteryControlConfig = {
  enabled: boolean;
  instantOverride: boolean;
  provider: BatteryControlProvider;
  commandRegister: number;
  commandUnitId: number;
  commandScale: number;
};

export type BatteryMonitorSource = "modbus" | "sigen" | "vendor-cloud";

export type MonitorConfig = {
  source: BatteryMonitorSource;
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

export type LocalControlHealth = "healthy" | "degraded" | "offline" | "unsupported";

export type ControlMode =
  | "monitor-only"
  | "local-control-ready"
  | "cloud-sync-only"
  | "blocked";

export type BatteryControlReadiness = {
  controlMode: ControlMode;
  provider: BatteryControlProvider;
  providerSupported: boolean;
  instantOverrideEnabled: boolean;
  localHealth: LocalControlHealth;
  localOnly: boolean;
  canArmOverride: boolean;
  canSendCommand: boolean;
  blockedReasons: string[];
  statusLabel: string;
  modeLabel: string;
  boundaryLabel: string;
  commandTargetUrl: string | null;
};

export type CommandBridgeHealth = {
  status: "unknown" | "healthy" | "degraded" | "offline";
  commandCapable: boolean;
  mode: string | null;
  message: string | null;
  checkedAt: number | null;
};

const SUPPORTED_PROVIDERS: readonly BatteryControlProvider[] = [
  "generic-modbus",
  "home-assistant",
] as const;

const READ_ONLY_BUNDLED_BRIDGE_ORIGINS = new Set([
  "http://localhost:5174",
  "http://127.0.0.1:5174",
]);

function normalizeBridgeOrigin(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch (_err) {
    return null;
  }
}

function looksLikeLocalOrigin(origin: string) {
  if (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://192.168.") ||
    origin.startsWith("http://10.") ||
    origin.startsWith("http://172.")
  ) {
    return true;
  }
  return false;
}

function buildCommandTargetUrl(origin: string | null) {
  if (!origin) return null;
  return `${origin}/api/device/command`;
}

export function computeBatteryControlReadiness(input: {
  batteryControlConfig: BatteryControlConfig;
  modbusMonitorConfig: MonitorConfig;
  batteryTelemetry: NormalizedBatteryTelemetry;
  modbusMonitorError?: string | null;
  commandBridgeHealth?: CommandBridgeHealth | null;
}): BatteryControlReadiness {
  const { batteryControlConfig, modbusMonitorConfig, batteryTelemetry, commandBridgeHealth } = input;
  const bridgeOrigin = normalizeBridgeOrigin(modbusMonitorConfig.bridgeUrl);
  const providerSupported = SUPPORTED_PROVIDERS.includes(batteryControlConfig.provider);
  const usingBundledReadOnlyProxy = bridgeOrigin
    ? READ_ONLY_BUNDLED_BRIDGE_ORIGINS.has(bridgeOrigin)
    : false;
  const localOnly = bridgeOrigin ? looksLikeLocalOrigin(bridgeOrigin) : false;
  const commandTargetUrl = buildCommandTargetUrl(bridgeOrigin);
  const blockedReasons: string[] = [];

  if (!batteryControlConfig.enabled) {
    blockedReasons.push("Battery control profile is disabled.");
  }
  if (!batteryControlConfig.instantOverride) {
    blockedReasons.push("Instant override is disabled.");
  }
  if (!providerSupported) {
    blockedReasons.push("Selected provider is not supported for release.");
  }
  if (!bridgeOrigin) {
    blockedReasons.push("Local bridge URL is missing or invalid.");
  } else if (!localOnly) {
    blockedReasons.push("Command path must point to your own local bridge.");
  }
  if (usingBundledReadOnlyProxy) {
    blockedReasons.push("Bundled local proxy is read-only. Use your own command bridge.");
  }
  if (batteryControlConfig.provider === "generic-modbus") {
    if (modbusMonitorConfig.source !== "modbus") {
      blockedReasons.push("Generic Modbus control requires the Local Modbus source.");
    }
    if (!modbusMonitorConfig.host.trim()) {
      blockedReasons.push("Generic Modbus control requires a Modbus host.");
    }
  }
  if (batteryTelemetry.isSimulated || batteryTelemetry.status !== "live") {
    blockedReasons.push("Live battery telemetry is required before sending commands.");
  }
  if (input.modbusMonitorError) {
    blockedReasons.push("Battery source health check is failing.");
  }
  if (
    batteryControlConfig.enabled &&
    providerSupported &&
    bridgeOrigin &&
    localOnly &&
    !usingBundledReadOnlyProxy
  ) {
    if (!commandBridgeHealth || commandBridgeHealth.status === "unknown") {
      blockedReasons.push("Waiting for local command bridge health check.");
    } else if (commandBridgeHealth.status === "offline") {
      blockedReasons.push(
        commandBridgeHealth.message || "Local command bridge is unreachable.",
      );
    } else if (
      commandBridgeHealth.status === "degraded" ||
      !commandBridgeHealth.commandCapable
    ) {
      blockedReasons.push(
        commandBridgeHealth.message ||
          "Local command bridge is reachable but not command-capable.",
      );
    }
  }

  let localHealth: LocalControlHealth = "healthy";
  if (!providerSupported) localHealth = "unsupported";
  else if (!bridgeOrigin || !localOnly) localHealth = "offline";
  else if (
    usingBundledReadOnlyProxy ||
    batteryTelemetry.isSimulated ||
    batteryTelemetry.status !== "live" ||
    Boolean(input.modbusMonitorError) ||
    !commandBridgeHealth ||
    commandBridgeHealth.status === "unknown" ||
    commandBridgeHealth.status === "offline" ||
    commandBridgeHealth.status === "degraded" ||
    !commandBridgeHealth.commandCapable
  ) {
    localHealth = "degraded";
  }

  const canArmOverride =
    batteryControlConfig.enabled &&
    batteryControlConfig.instantOverride &&
    providerSupported &&
    localOnly &&
    !usingBundledReadOnlyProxy &&
    Boolean(commandBridgeHealth?.commandCapable);

  const canSendCommand =
    canArmOverride &&
    localHealth === "healthy" &&
    batteryTelemetry.status === "live" &&
    !batteryTelemetry.isSimulated &&
    Boolean(commandBridgeHealth?.commandCapable) &&
    Boolean(commandTargetUrl);

  let controlMode: ControlMode = "monitor-only";
  if (!batteryControlConfig.enabled) controlMode = "monitor-only";
  else if (!bridgeOrigin || !localOnly) controlMode = "cloud-sync-only";
  else if (canSendCommand) controlMode = "local-control-ready";
  else controlMode = "blocked";

  const statusLabel =
    controlMode === "local-control-ready"
      ? "Local control ready"
      : controlMode === "cloud-sync-only"
        ? "Cloud sync only"
        : controlMode === "blocked"
          ? localHealth === "unsupported"
            ? "Unsupported"
            : "Setup required"
          : "Monitor-only";

  const modeLabel =
    controlMode === "local-control-ready"
      ? "Commands can be sent to your local bridge."
      : controlMode === "cloud-sync-only"
        ? "Cloud sync is available, but command execution is not local-ready."
        : controlMode === "blocked"
          ? "Local control is configured but blocked by health or capability gates."
          : "Monitoring and advisory mode only.";

  return {
    controlMode,
    provider: batteryControlConfig.provider,
    providerSupported,
    instantOverrideEnabled: batteryControlConfig.instantOverride,
    localHealth,
    localOnly,
    canArmOverride,
    canSendCommand,
    blockedReasons,
    statusLabel,
    modeLabel,
    boundaryLabel: "No secrets stored in cloud",
    commandTargetUrl,
  };
}
