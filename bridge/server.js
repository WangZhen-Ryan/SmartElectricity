const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const HomeAssistantAdapter = require("./adapters/homeAssistant");
const GenericModbusAdapter = require("./adapters/genericModbus");

const CONFIG_PATH =
  process.env.LOCAL_BRIDGE_CONFIG ||
  path.join(__dirname, "config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      provider: "home-assistant",
      port: 8787,
      mockTelemetry: {},
      homeAssistant: {},
      genericModbus: {},
    };
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function buildAdapter(config) {
  if (config.provider === "home-assistant") {
    return new HomeAssistantAdapter(config);
  }
  return new GenericModbusAdapter(config);
}

function validateConfig(config) {
  const provider = config.provider === "home-assistant" ? "home-assistant" : "generic-modbus";
  const errors = [];
  const warnings = [];

  if (provider === "home-assistant") {
    const ha = config.homeAssistant || {};
    if (!ha.baseUrl) errors.push("homeAssistant.baseUrl is required.");
    if (!ha.token) errors.push("homeAssistant.token is required.");
    if (!ha.socEntity) errors.push("homeAssistant.socEntity is required.");
    if (!ha.batteryPowerEntity) warnings.push("homeAssistant.batteryPowerEntity is recommended.");
    if (!ha.gridPowerEntity) warnings.push("homeAssistant.gridPowerEntity is recommended.");
    if (!ha.solarPowerEntity) warnings.push("homeAssistant.solarPowerEntity is recommended.");
    const commandMap = ha.commandMap || {};
    const hasLegacyCommand =
      Boolean(commandMap.serviceDomain) &&
      Boolean(commandMap.serviceName) &&
      Boolean(commandMap.entityId) &&
      Boolean(commandMap.serviceField) &&
      commandMap.actions &&
      typeof commandMap.actions === "object";
    const hasTemplateCommand =
      commandMap.templates &&
      typeof commandMap.templates === "object" &&
      ["charge", "hold", "discharge"].some((action) => {
        const template = commandMap.templates[action];
        return (
          template &&
          typeof template === "object" &&
          template.serviceDomain &&
          template.serviceName
        );
      });
    if (!hasLegacyCommand && !hasTemplateCommand) {
      warnings.push("homeAssistant.commandMap is incomplete. Monitor may work, control will stay blocked.");
    }
  } else {
    const modbus = config.genericModbus || {};
    if (!modbus.host) errors.push("genericModbus.host is required.");
    if (!modbus.unitId) warnings.push("genericModbus.unitId is recommended.");
    if (!modbus.registerMap || !modbus.registerMap.socPct) {
      errors.push("genericModbus.registerMap.socPct is required.");
    }
    if (!modbus.commandMap || !modbus.commandMap.address || !modbus.commandMap.actions) {
      warnings.push("genericModbus.commandMap is incomplete. Monitor may work, control will stay blocked.");
    }
  }

  return {
    ok: errors.length === 0,
    provider,
    errors,
    warnings,
    message:
      errors.length === 0
        ? warnings.length
          ? "Configuration is valid for monitor, but some control fields are still missing."
          : "Configuration looks ready."
        : "Configuration is incomplete.",
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStatusPage(config, validation, commandHealth) {
  const errors = validation.errors
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const warnings = validation.warnings
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const commandDetails = commandHealth
    ? `
      <div class="status-card">
        <span class="mono">Command Health</span>
        <strong>${escapeHtml(commandHealth.commandCapable ? "Command-capable" : "Blocked")}</strong>
        <span>${escapeHtml(commandHealth.message || "No message.")}</span>
      </div>
      <div class="status-card">
        <span class="mono">Bridge Mode</span>
        <strong>${escapeHtml(commandHealth.mode || "unknown")}</strong>
        <span>${escapeHtml(commandHealth.ok ? "Reachable" : "Not reachable")}</span>
      </div>
    `
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GridPulse Local Bridge Status</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:24px; }
      .shell { max-width: 980px; margin: 0 auto; }
      h1 { margin: 0 0 8px; font-size: 32px; }
      .hint { color:#94a3b8; margin: 0 0 24px; }
      .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:24px; }
      .status-card { background:#13203a; border:1px solid #21446a; border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:8px; }
      .mono { color:#67e8f9; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; }
      strong { font-size:20px; }
      code, pre { background:#081222; color:#cbd5e1; border-radius:12px; padding:2px 6px; }
      pre { padding:16px; overflow:auto; }
      .section { background:#13203a; border:1px solid #21446a; border-radius:18px; padding:18px; margin-bottom:18px; }
      ul { margin:8px 0 0 18px; }
      a { color:#67e8f9; }
      .ok { color:#86efac; }
      .warn { color:#facc15; }
      .err { color:#fda4af; }
    </style>
  </head>
  <body>
    <div class="shell">
      <h1>Local Bridge Status</h1>
      <p class="hint">Use this page to confirm your local bridge is configured before pointing the website at it.</p>
      <div class="grid">
        <div class="status-card">
          <span class="mono">Provider</span>
          <strong>${escapeHtml(validation.provider)}</strong>
          <span>Configured in <code>${escapeHtml(CONFIG_PATH)}</code></span>
        </div>
        <div class="status-card">
          <span class="mono">Validation</span>
          <strong class="${validation.ok ? "ok" : "err"}">${escapeHtml(validation.ok ? "Ready for monitor" : "Config incomplete")}</strong>
          <span>${escapeHtml(validation.message)}</span>
        </div>
        ${commandDetails}
      </div>
      <div class="section">
        <div class="mono">Quick Endpoints</div>
        <ul>
          <li><a href="/api/health">/api/health</a></li>
          <li><a href="/api/config/validate">/api/config/validate</a></li>
          <li><a href="/api/battery/telemetry">/api/battery/telemetry</a></li>
          <li><a href="/api/device/command/health">/api/device/command/health</a></li>
        </ul>
      </div>
      <div class="section">
        <div class="mono">Validation Errors</div>
        ${errors ? `<ul class="err">${errors}</ul>` : `<p class="ok">No blocking errors.</p>`}
      </div>
      <div class="section">
        <div class="mono">Validation Warnings</div>
        ${warnings ? `<ul class="warn">${warnings}</ul>` : `<p class="ok">No warnings.</p>`}
      </div>
      <div class="section">
        <div class="mono">Config Preview</div>
        <pre>${escapeHtml(JSON.stringify({
          provider: config.provider,
          port: config.port || 8787,
          homeAssistant: config.homeAssistant
            ? {
                baseUrl: config.homeAssistant.baseUrl || "",
                socEntity: config.homeAssistant.socEntity || "",
                batteryPowerEntity: config.homeAssistant.batteryPowerEntity || "",
                hasToken: Boolean(config.homeAssistant.token),
                commandMode: config.homeAssistant.commandMap?.templates
                  ? "templates"
                  : config.homeAssistant.commandMap?.actions
                    ? "legacy-actions"
                    : "none",
              }
            : undefined,
          genericModbus: config.genericModbus
            ? {
                host: config.genericModbus.host || "",
                port: config.genericModbus.port || 502,
                unitId: config.genericModbus.unitId || "",
                hasRegisterMap: Boolean(config.genericModbus.registerMap),
                hasCommandMap: Boolean(config.genericModbus.commandMap),
              }
            : undefined,
        }, null, 2))}</pre>
      </div>
    </div>
  </body>
</html>`;
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(html);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const config = loadConfig();
  const adapter = buildAdapter(config);
  const url = new URL(req.url, "http://127.0.0.1");

  try {
    if (url.pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        bridge: "gridpulse-local-bridge",
        provider: config.provider,
        configPath: CONFIG_PATH,
      });
      return;
    }

    if ((url.pathname === "/" || url.pathname === "/status") && req.method === "GET") {
      const validation = validateConfig(config);
      const commandHealth = await adapter.getCommandHealth().catch(() => null);
      sendHtml(res, 200, renderStatusPage(config, validation, commandHealth));
      return;
    }

    if (url.pathname === "/api/config/validate" && req.method === "GET") {
      const payload = validateConfig(config);
      sendJson(res, payload.ok ? 200 : 400, payload);
      return;
    }

    if (url.pathname === "/api/battery/telemetry" && req.method === "GET") {
      const payload = await adapter.getTelemetry();
      sendJson(res, payload.ok === false ? 502 : 200, payload);
      return;
    }

    if (url.pathname === "/api/device/command/health" && req.method === "GET") {
      const payload = await adapter.getCommandHealth();
      sendJson(res, payload.ok === false ? 503 : 200, payload);
      return;
    }

    if (url.pathname === "/api/device/command" && req.method === "POST") {
      const body = await readBody(req);
      const payload = await adapter.sendCommand(body);
      sendJson(res, payload.ok ? 200 : 501, payload);
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: "Unknown route.",
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Bridge failure.",
    });
  }
});

const config = loadConfig();
const port = Number(config.port || process.env.PORT || 8787);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`GridPulse local bridge listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Config path: ${CONFIG_PATH}`);
});
