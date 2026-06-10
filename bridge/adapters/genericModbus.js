const BaseAdapter = require("./base");
const {
  readHoldingRegisters,
  writeRegisters,
  decodeRegisters,
  encodeRegisterValue,
} = require("../lib/modbusTcp");

class GenericModbusAdapter extends BaseAdapter {
  async getTelemetry() {
    const cfg = this.config.genericModbus || {};
    const map = cfg.registerMap || {};
    if (!cfg.host || !map.socPct) {
      const mock = this.config.mockTelemetry || {};
      return {
        ok: true,
        provider: "generic-modbus",
        adapter: "modbus-stub",
        timestamp: new Date().toISOString(),
        live: false,
        simulated: true,
        socPct: Number(mock.socPct ?? 50),
        reservePct: Number(mock.reservePct ?? 20),
        batteryPowerKw: Number(mock.batteryPowerKw ?? 0),
        gridKw: Number(mock.gridKw ?? 0),
        solarKw: Number(mock.solarKw ?? 0),
        plantKw: Number(mock.plantKw ?? 0),
        maxChargeKw: Number(mock.maxChargeKw ?? 5),
        maxDischargeKw: Number(mock.maxDischargeKw ?? 5),
        chargeCapacityKwh: Number(mock.chargeCapacityKwh ?? 0),
        dischargeCapacityKwh: Number(mock.dischargeCapacityKwh ?? 0),
        message:
          "Generic Modbus adapter needs host and registerMap.socPct. Using local mock telemetry.",
        rawSourceKind: "modbus-stub",
      };
    }

    const clientConfig = {
      host: cfg.host,
      port: cfg.port || 502,
      unitId: cfg.unitId || 247,
      timeoutMs: cfg.timeoutMs || 4000,
    };

    const readMapped = async (entry) => {
      if (!entry || typeof entry !== "object") return null;
      const count = Number(entry.count || (String(entry.format || "u16").includes("32") || String(entry.format || "").includes("f32") ? 2 : 1));
      const registers = await readHoldingRegisters(clientConfig, Number(entry.address), count);
      const decoded = decodeRegisters(registers, entry.format || "u16", cfg.byteOrder || entry.byteOrder || "ABCD");
      const scale = Number(entry.scale || 1);
      return decoded === null ? null : decoded / scale;
    };

    const payload = {
      socPct: await readMapped(map.socPct),
      batteryPowerKw: await readMapped(map.batteryPowerKw),
      gridKw: await readMapped(map.gridKw),
      solarKw: await readMapped(map.solarKw),
      plantKw: await readMapped(map.plantKw),
      maxChargeKw: await readMapped(map.maxChargeKw),
      maxDischargeKw: await readMapped(map.maxDischargeKw),
      chargeCapacityKwh: await readMapped(map.chargeCapacityKwh),
      dischargeCapacityKwh: await readMapped(map.dischargeCapacityKwh),
    };

    return {
      ok: true,
      provider: "generic-modbus",
      adapter: "modbus-register-map",
      timestamp: new Date().toISOString(),
      live: payload.socPct !== null,
      simulated: false,
      reservePct: Number(this.config.mockTelemetry?.reservePct ?? 20),
      ...payload,
      message: "Generic Modbus register map read succeeded.",
      rawSourceKind: "modbus-register-map",
      raw: payload,
    };
  }

  async getCommandHealth() {
    const hasHost = Boolean(this.config.genericModbus?.host);
    const commandMap = this.config.genericModbus?.commandMap || {};
    return {
      ok: hasHost,
      commandCapable: hasHost && Boolean(commandMap.address) && Boolean(commandMap.actions),
      mode: "generic-modbus",
      message:
        hasHost && Boolean(commandMap.address) && Boolean(commandMap.actions)
          ? "Generic Modbus adapter configured for local control."
          : "Set genericModbus.host, registerMap, and commandMap in bridge config.",
    };
  }

  async sendCommand(command) {
    const cfg = this.config.genericModbus || {};
    const commandMap = cfg.commandMap || {};
    const action = command?.action || "unknown";
    const mappedValue = commandMap.actions?.[action];
    if (!cfg.host || !commandMap.address || mappedValue === undefined) {
      return {
        ok: false,
        accepted: false,
        provider: "generic-modbus",
        action,
        error: "Generic Modbus commandMap is incomplete for this action.",
      };
    }
    const clientConfig = {
      host: cfg.host,
      port: cfg.port || 502,
      unitId: cfg.unitId || 247,
      timeoutMs: cfg.timeoutMs || 4000,
    };
    const registers = encodeRegisterValue(
      mappedValue,
      commandMap.format || "u16",
      cfg.byteOrder || commandMap.byteOrder || "ABCD",
    );
    await writeRegisters(clientConfig, Number(commandMap.address), registers);
    return {
      ok: true,
      accepted: true,
      provider: "generic-modbus",
      action,
      message: "Command written via Generic Modbus register map.",
    };
  }
}

module.exports = GenericModbusAdapter;
