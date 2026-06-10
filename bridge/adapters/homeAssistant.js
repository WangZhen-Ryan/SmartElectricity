const BaseAdapter = require("./base");

class HomeAssistantAdapter extends BaseAdapter {
  getCommandTemplate(action) {
    const commandMap = this.config.homeAssistant?.commandMap || {};
    const template = commandMap.templates?.[action];
    if (!template || typeof template !== "object") return null;
    const serviceDomain =
      typeof template.serviceDomain === "string" ? template.serviceDomain : null;
    const serviceName = typeof template.serviceName === "string" ? template.serviceName : null;
    const serviceData =
      template.serviceData && typeof template.serviceData === "object" ? template.serviceData : {};
    if (!serviceDomain || !serviceName) return null;
    return {
      serviceDomain,
      serviceName,
      serviceData,
    };
  }

  hasLegacyCommandMap(commandMap) {
    return (
      Boolean(commandMap.serviceDomain) &&
      Boolean(commandMap.serviceName) &&
      Boolean(commandMap.entityId) &&
      Boolean(commandMap.serviceField) &&
      commandMap.actions &&
      typeof commandMap.actions === "object"
    );
  }

  hasTemplateCommandMap(commandMap) {
    return Boolean(
      commandMap.templates &&
        typeof commandMap.templates === "object" &&
        ["charge", "hold", "discharge"].some((action) => this.getCommandTemplate(action)),
    );
  }

  buildHeaders() {
    const token = this.config.homeAssistant?.token;
    return token
      ? {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        }
      : {
          "Content-Type": "application/json",
        };
  }

  async readEntityState(entityId) {
    const baseUrl = this.config.homeAssistant?.baseUrl;
    if (!baseUrl || !entityId) return null;
    const resp = await fetch(
      `${String(baseUrl).replace(/\/+$/, "")}/api/states/${encodeURIComponent(entityId)}`,
      {
        headers: this.buildHeaders(),
      },
    );
    if (!resp.ok) {
      throw new Error(`HA entity read failed for ${entityId} (${resp.status}).`);
    }
    return await resp.json();
  }

  toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  async getTelemetry() {
    const ha = this.config.homeAssistant || {};
    const entityIds = [
      ha.socEntity,
      ha.batteryPowerEntity,
      ha.solarPowerEntity,
      ha.gridPowerEntity,
      ha.plantPowerEntity,
      ha.maxChargeEntity,
      ha.maxDischargeEntity,
      ha.chargeCapacityEntity,
      ha.dischargeCapacityEntity,
    ].filter(Boolean);
    if (!ha.baseUrl || !ha.token || !entityIds.length) {
      const mock = this.config.mockTelemetry || {};
      return {
        ok: true,
        provider: "home-assistant",
        adapter: "ha-stub",
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
          "Home Assistant adapter needs baseUrl, token, and entity IDs. Using local mock telemetry.",
        rawSourceKind: "ha-stub",
      };
    }

    const reads = {};
    for (const key of [
      "socEntity",
      "batteryPowerEntity",
      "solarPowerEntity",
      "gridPowerEntity",
      "plantPowerEntity",
      "maxChargeEntity",
      "maxDischargeEntity",
      "chargeCapacityEntity",
      "dischargeCapacityEntity",
    ]) {
      const entityId = ha[key];
      if (!entityId) continue;
      reads[key] = await this.readEntityState(entityId);
    }

    const soc = this.toNumber(reads.socEntity?.state);
    return {
      ok: true,
      provider: "home-assistant",
      adapter: "ha-entity-api",
      timestamp: new Date().toISOString(),
      live: soc !== null,
      simulated: false,
      socPct: soc ?? 0,
      reservePct: Number(this.config.mockTelemetry?.reservePct ?? 20),
      batteryPowerKw: this.toNumber(reads.batteryPowerEntity?.state) ?? 0,
      gridKw: this.toNumber(reads.gridPowerEntity?.state) ?? 0,
      solarKw: this.toNumber(reads.solarPowerEntity?.state) ?? 0,
      plantKw:
        this.toNumber(reads.plantPowerEntity?.state) ??
        this.toNumber(reads.solarPowerEntity?.state) ??
        0,
      maxChargeKw: this.toNumber(reads.maxChargeEntity?.state) ?? 5,
      maxDischargeKw: this.toNumber(reads.maxDischargeEntity?.state) ?? 5,
      chargeCapacityKwh: this.toNumber(reads.chargeCapacityEntity?.state) ?? 0,
      dischargeCapacityKwh: this.toNumber(reads.dischargeCapacityEntity?.state) ?? 0,
      message: "Home Assistant entity API telemetry read succeeded.",
      rawSourceKind: "ha-entity-api",
      raw: reads,
    };
  }

  async getCommandHealth() {
    const hasBase = Boolean(this.config.homeAssistant?.baseUrl);
    const hasToken = Boolean(this.config.homeAssistant?.token);
    const commandMap = this.config.homeAssistant?.commandMap || {};
    const commandCapable =
      hasBase &&
      hasToken &&
      (this.hasLegacyCommandMap(commandMap) || this.hasTemplateCommandMap(commandMap));
    return {
      ok: hasBase,
      commandCapable,
      mode: "home-assistant",
      message:
        commandCapable
          ? "Home Assistant adapter configured for local control."
          : "Set Home Assistant baseUrl/token and a legacy commandMap or per-action templates in bridge config.",
    };
  }

  async sendCommand(command) {
    const ha = this.config.homeAssistant || {};
    const commandMap = ha.commandMap || {};
    const action = command?.action || "unknown";
    const template = this.getCommandTemplate(action);
    const targetServiceDomain = template?.serviceDomain || commandMap.serviceDomain;
    const targetServiceName = template?.serviceName || commandMap.serviceName;
    const actionValue = commandMap.actions?.[action];
    if (!ha.baseUrl || !ha.token) {
      return {
        ok: false,
        accepted: false,
        provider: "home-assistant",
        action,
        error: "Missing Home Assistant baseUrl or token.",
      };
    }
    let body = null;
    if (template) {
      body = { ...template.serviceData };
    } else if (
      commandMap.entityId &&
      commandMap.serviceField &&
      actionValue !== undefined &&
      this.hasLegacyCommandMap(commandMap)
    ) {
      body = {
        entity_id: commandMap.entityId,
        [commandMap.serviceField]: actionValue,
      };
    } else {
      return {
        ok: false,
        accepted: false,
        provider: "home-assistant",
        action,
        error: "Home Assistant commandMap is incomplete for this action.",
      };
    }
    const resp = await fetch(
      `${String(ha.baseUrl).replace(/\/+$/, "")}/api/services/${encodeURIComponent(String(targetServiceDomain))}/${encodeURIComponent(String(targetServiceName))}`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      return {
        ok: false,
        accepted: false,
        provider: "home-assistant",
        action,
        error: `HA command failed (${resp.status}): ${text}`,
      };
    }
    const result = await resp.json().catch(() => []);
    return {
      ok: true,
      accepted: true,
      provider: "home-assistant",
      action,
      message: template
        ? "Command forwarded to Home Assistant template action."
        : "Command forwarded to Home Assistant.",
      result,
    };
  }
}

module.exports = HomeAssistantAdapter;
