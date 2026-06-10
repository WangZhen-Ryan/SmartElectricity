import { Suspense, useState } from "react";
import type { ComponentProps, ComponentType } from "react";
import type { BatteryControlReadiness } from "../core/control";
import AnimatedSection from "./AnimatedSection";
import AnimatedSwitch from "./AnimatedSwitch";
import StaggerGroup from "./StaggerGroup";

function SectionFallback({ label }: { label: string }) {
  return (
    <div className="panel lazy-panel-fallback">
      <div className="loading-shell">
        <span className="spinner" />
        <div className="motion-skeleton-copy">
          <span>{label}</span>
          <span className="motion-skeleton-line" />
        </div>
      </div>
    </div>
  );
}

type LazyConfigAccountPanel = ComponentType<{
  authSession: { user?: { email?: string } } | null;
  authStatus: string;
  authMode: "signin" | "signup";
  authEmail: string;
  authPassword: string;
  authDisplayName: string;
  authPostcode: string;
  authLoading: boolean;
  authError: string | null;
  supabaseProjectUrl: string | null;
  userConfigLoadedAt: number | null;
  userConfigStatus: string;
  siteConfigured: boolean;
  effectiveAuthRegion: string;
  authRegionFromPostcode: { label: string; market: string };
  batteryHealth: {
    status: string;
    statusLabel: string;
    healthHint: string;
    sourceLabel: string;
  };
  onAuthModeChange: (mode: "signin" | "signup") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthDisplayNameChange: (value: string) => void;
  onAuthPostcodeChange: (value: string) => void;
  onSubmit: () => void;
  onResetPassword: () => void;
  onSignOut: () => void;
  onSaveConfig: () => void;
  onLoadConfig: () => void;
}>;

type LazyOnboardingWizard = ComponentType<{
  apiBase: string;
  anonKey: string | undefined;
  defaultSiteId: string;
  defaultToken: string;
  onApply: (next: {
    siteId: string;
    token: string;
    start: string;
    end: string;
    resolution: number;
  }) => void;
  onConnectionEvent: (item: {
    service: "amber" | "modbus";
    status: "ok" | "error" | "testing";
    message: string;
  }) => void;
}>;

type Props = {
  authSession: { user?: { email?: string } } | null;
  LazyConfigAccountPanel: LazyConfigAccountPanel;
  LazyOnboardingWizard: LazyOnboardingWizard;
  accountPanelProps: ComponentProps<LazyConfigAccountPanel>;
  onboardingWizardProps: ComponentProps<LazyOnboardingWizard>;
  deploymentStatus: {
    env: string;
    host: string;
    functionsReachable: boolean;
    authConfigured: boolean;
    cloudflareLikely: boolean;
  };
  tokenSecurity: {
    label: string;
    score: number;
    tips: string[];
  };
  onboardingApplied: boolean;
  loadingCurrent: boolean;
  apiBase: string;
  anonKey: string | undefined;
  siteId: string;
  token: string;
  connectionLogs: Array<{
    at: number;
    service: "amber" | "modbus";
    status: "ok" | "error" | "testing";
    message: string;
  }>;
  batteryStatus: {
    status: string;
  };
  controlReadiness: BatteryControlReadiness;
  bridgeUrl: string;
  bridgeStatusUrl: string | null;
  bridgeValidation: {
    loading: boolean;
    ok: boolean | null;
    message: string;
    errors: string[];
    warnings: string[];
    checkedAt: number | null;
  };
  onValidateBridgeConfig: () => void;
  llmRuntimeProps: {
    amberToken: string;
    solcastApiKey: string;
    llmApiToken: string;
    privateSecretsStatus: string;
    privateSecretsLoadedAt: number | null;
    onAmberTokenChange: (value: string) => void;
    onSolcastApiKeyChange: (value: string) => void;
    onLlmApiTokenChange: (value: string) => void;
    onSavePrivateSecrets: () => void;
    onLoadPrivateSecrets: () => void;
  };
  solcastPoints: number;
  formatScore: (value: number) => string;
  scrollToSection: (id: string) => void;
};

export default function ConfigWorkspaceShell({
  authSession,
  LazyConfigAccountPanel,
  LazyOnboardingWizard,
  accountPanelProps,
  onboardingWizardProps,
  deploymentStatus,
  tokenSecurity,
  onboardingApplied,
  loadingCurrent,
  apiBase,
  anonKey,
  siteId,
  token,
  connectionLogs,
  batteryStatus,
  controlReadiness,
  bridgeUrl,
  bridgeStatusUrl,
  bridgeValidation,
  onValidateBridgeConfig,
  llmRuntimeProps,
  solcastPoints,
  formatScore,
  scrollToSection,
}: Props) {
  const [showRuntimeDebug, setShowRuntimeDebug] = useState(false);
  const guestMode = !authSession;
  const visibleGuestSiteId = authSession ? siteId : "";
  const siteReadyForDisplay = authSession ? Boolean(siteId) : false;
  const visibleAmberTokenState = authSession ? (token ? "Provided" : "Missing") : "Add during setup";
  const visibleSolcastState = llmRuntimeProps.solcastApiKey.trim()
    ? authSession
      ? "Configured locally"
      : "Added in this browser"
    : guestMode
      ? "Optional"
      : "Server env / missing";
  return (
    <>
      <Suspense fallback={<SectionFallback label="Loading account controls..." />}>
        <LazyConfigAccountPanel {...accountPanelProps} />
      </Suspense>
      <AnimatedSection as="section" className="panel config-guide" enter="rise" delayIndex={1}>
        <div className="panel-header">
          <h2>Quick Setup Guide</h2>
          <p className="hint">User-friendly onboarding for Amber + battery telemetry.</p>
        </div>
        <div className="readiness-checklist">
          <span className="mono">Setup Checklist</span>
          <ul className="checklist">
            <li className={siteReadyForDisplay ? "ok" : "warn"}>
              <span className="dot" />
              {authSession ? "Amber site configured" : "Amber site ready to add"}
            </li>
            <li className={apiBase && anonKey ? "ok" : "warn"}>
              <span className="dot" />
              Cloud runtime configured
            </li>
            <li className={batteryStatus.status === "live" ? "ok" : "warn"}>
              <span className="dot" />
              Battery data path configured
            </li>
            <li className={solcastPoints ? "ok" : "warn"}>
              <span className="dot" />
              Solar forecast source verified
            </li>
          </ul>
        </div>
        <StaggerGroup className="summary-grid">
          <div className="summary-card">
            <span className="mono">Step 1</span>
            <strong>Amber Account</strong>
            <span>Enter your own Amber site ID + token. Market data support is Amber-first.</span>
          </div>
          <div className="summary-card">
            <span className="mono">Step 2</span>
            <strong>Choose Battery Path</strong>
            <span>Use either local Modbus (read-only) or Home Assistant data feed.</span>
          </div>
          <div className="summary-card">
            <span className="mono">Step 3</span>
            <strong>Run Connection Tests</strong>
            <span>Use the wizard test buttons. Confirm Amber + battery endpoint are reachable.</span>
          </div>
          <div className="summary-card">
            <span className="mono">Step 4</span>
            <strong>Apply & Start</strong>
            <span>Apply to this session, then continue to Monitor or Backtest.</span>
          </div>
        </StaggerGroup>
        <div className="config-guide-note">
          <span className="mono">Zero-To-First-Run</span>
          <ol className="config-guide-list">
            <li>Confirm Amber current prices can load with your site ID.</li>
            <li>Confirm battery telemetry works through either local Modbus or Home Assistant.</li>
            <li>Add `SOLCAST_API_KEY` if you want higher-quality solar forecasting.</li>
            <li>Keep tokens and passwords in env vars, then use the wizard to test connectivity only.</li>
          </ol>
        </div>
        <div className="hero-actions">
          <button className="ghost small" onClick={() => scrollToSection("config-wizard")}>
            Open Wizard
          </button>
          <button className="ghost small" onClick={() => scrollToSection("config-deployment")}>
            Deployment Status
          </button>
          <button className="ghost small" onClick={() => scrollToSection("config-logs")}>
            Connection History
          </button>
        </div>
      </AnimatedSection>
      <div id="config-wizard">
        <Suspense fallback={<SectionFallback label="Loading onboarding wizard..." />}>
          <LazyOnboardingWizard {...onboardingWizardProps} />
        </Suspense>
      </div>
      <AnimatedSection as="section" className="panel" id="config-deployment" enter="fade">
        <div className="panel-header">
          <h2>Deployment Status</h2>
          <p className="hint">Supabase + Cloudflare runtime posture</p>
        </div>
        <StaggerGroup className="summary-grid">
          <div className="summary-card">
            <span className="mono">Environment</span>
            <strong>{deploymentStatus.env}</strong>
            <span className="hint">Host {deploymentStatus.host}</span>
          </div>
          <div className="summary-card">
            <span className="mono">Supabase Functions</span>
            <strong>{deploymentStatus.functionsReachable ? "Configured" : "Missing URL"}</strong>
            <span className="hint">
              {deploymentStatus.functionsReachable
                ? "Server runtime connected"
                : "VITE_SUPABASE_FUNCTIONS_URL not set"}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Auth Key</span>
            <strong>{deploymentStatus.authConfigured ? "Configured" : "Missing"}</strong>
            <span className="hint">VITE_SUPABASE_ANON_KEY</span>
          </div>
          <div className="summary-card">
            <span className="mono">Cloudflare</span>
            <strong>{deploymentStatus.cloudflareLikely ? "Detected" : "Unknown"}</strong>
            <span className="hint">Domain-based detection</span>
          </div>
        </StaggerGroup>
      </AnimatedSection>
      <AnimatedSection as="section" className="panel" id="config-runtime" enter="fade" delayIndex={1}>
        <div className="panel-header">
          <h2>{authSession ? "Runtime Config" : "Guest Session Config"}</h2>
          <p className="hint">
            {authSession
              ? "Current session settings + environment status"
              : "Local/session-only settings + environment status. This is not cloud account data."}
          </p>
        </div>
        <div className="hero-actions config-runtime-actions">
          <button
            className="ghost small"
            onClick={() => setShowRuntimeDebug((prev) => !prev)}
            type="button"
          >
            {showRuntimeDebug ? "Hide Debug Details" : "Show Debug Details"}
          </button>
        </div>
        <StaggerGroup className="summary-grid">
          <div className="summary-card">
            <span className="mono">Config Scope</span>
            <strong>{authSession ? "Signed-in workspace" : "Guest local session"}</strong>
            <span className="hint">
              {authSession
                ? "Cloud sync is available for non-secret setup."
                : "Amber and bridge values shown here belong to this browser session or server runtime only."}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Supabase URL</span>
            <strong>{apiBase ? "Configured" : "Missing"}</strong>
            <span className="hint">
              {showRuntimeDebug
                ? apiBase || "VITE_SUPABASE_FUNCTIONS_URL not set"
                : "Functions runtime hidden in normal view"}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Anon Key</span>
            <strong>{anonKey ? "Set" : "Missing"}</strong>
            <span className="hint">Client auth</span>
          </div>
          <div className="summary-card">
            <span className="mono">Amber Site</span>
            <strong>{visibleGuestSiteId || "Set during onboarding"}</strong>
            <span className="hint">{authSession ? "Active site ID" : "Hidden in guest mode until you add your own setup"}</span>
          </div>
          <div className="summary-card">
            <span className="mono">Amber Token</span>
            <strong>{visibleAmberTokenState}</strong>
            <span className="hint">
              {authSession
                ? "Token not stored in UI"
                : "Bring your own token during onboarding. Guest mode does not reveal saved account setup."}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Solcast Key</span>
            <strong>{visibleSolcastState}</strong>
            <span className="hint">User override for higher-quality solar forecast</span>
          </div>
          <div className="summary-card">
            <span className="mono">LLM Token</span>
            <strong>{llmRuntimeProps.llmApiToken.trim() ? "Configured locally" : "Missing"}</strong>
            <span className="hint">
              Stored only in this browser session/device. Not cloud-synced.
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Onboarding</span>
            <strong>{onboardingApplied ? "Applied" : "Defaults"}</strong>
            <span className="hint">Apply to override defaults</span>
          </div>
          <div className="summary-card">
            <span className="mono">Current Refresh</span>
            <strong>{loadingCurrent ? "Refreshing" : "Idle"}</strong>
            <span className="hint">Auto every 2 mins</span>
          </div>
        </StaggerGroup>
        <div className="field">
          <label>Amber API token</label>
          <input
            type="password"
            placeholder="Paste Amber API token"
            value={llmRuntimeProps.amberToken}
            onChange={(e) => llmRuntimeProps.onAmberTokenChange(e.target.value)}
          />
          <div className="hint">
            Used for Amber price fetches. Save it to your private account vault if you want it to follow your sign-in.
          </div>
        </div>
        <div className="field">
          <label>Solcast API key</label>
          <input
            type="password"
            placeholder="Paste Solcast API key"
            value={llmRuntimeProps.solcastApiKey}
            onChange={(e) => llmRuntimeProps.onSolcastApiKeyChange(e.target.value)}
          />
          <div className="hint">
            Used as a user-specific Solcast override. If empty, the app falls back to server env or Open-Meteo.
          </div>
        </div>
        <div className="field">
          <label>LLM API token</label>
          <input
            type="password"
            placeholder="Paste OpenRouter-compatible API token"
            value={llmRuntimeProps.llmApiToken}
            onChange={(e) => llmRuntimeProps.onLlmApiTokenChange(e.target.value)}
          />
          <div className="hint">
            Required before LLM Strategy can run. This token stays local to this browser and is never included in cloud sync.
          </div>
        </div>
        <div className="summary-card private-vault-card">
          <span className="mono">Private Secret Vault</span>
          <strong>{authSession ? "Owner-scoped account storage" : "Sign in required"}</strong>
          <span className="hint">{llmRuntimeProps.privateSecretsStatus}</span>
          <span className="hint">
            {llmRuntimeProps.privateSecretsLoadedAt
              ? `Last synced ${new Date(llmRuntimeProps.privateSecretsLoadedAt).toLocaleString()}`
              : authSession
                ? "Auto-load runs right after sign-in."
                : "Not yet synced to your account."}
          </span>
          <div className="hero-actions">
            <button
              className="ghost small"
              onClick={llmRuntimeProps.onLoadPrivateSecrets}
              disabled={!authSession}
              type="button"
            >
              Reload Private Secrets
            </button>
            <button
              className="primary small"
              onClick={llmRuntimeProps.onSavePrivateSecrets}
              disabled={!authSession}
              type="button"
            >
              Save Private Secrets
            </button>
          </div>
        </div>
      </AnimatedSection>
      <AnimatedSection as="section" className="panel" enter="slide" delayIndex={1}>
        <div className="panel-header">
          <h2>Local Control Model</h2>
          <p className="hint">Monitor-first by default. Local control unlocks only through your own bridge.</p>
        </div>
        <StaggerGroup className="summary-grid">
          <div className="summary-card">
            <span className="mono">Control Mode</span>
            <strong>{controlReadiness.statusLabel}</strong>
            <span className="hint">{controlReadiness.modeLabel}</span>
          </div>
          <div className="summary-card">
            <span className="mono">Provider</span>
            <strong>{controlReadiness.provider}</strong>
            <span className="hint">
              {controlReadiness.providerSupported ? "Release-supported" : "Unsupported"}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Local Health</span>
            <strong>{controlReadiness.localHealth}</strong>
            <span className="hint">
              {controlReadiness.localOnly
                ? "Commands must stay on your local network"
                : "Current bridge path is not local-only"}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Cloud Boundary</span>
            <strong>{controlReadiness.boundaryLabel}</strong>
            <span className="hint">Only non-secret metadata is cloud-synced</span>
          </div>
        </StaggerGroup>
        {controlReadiness.blockedReasons.length ? (
          <ul className="reason-list">
            {controlReadiness.blockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <pre className="code-block">{`cd web\nnpm run server\n# Bundled local proxy is read-only\n# For local control, point Bridge URL to your own Home Assistant or Generic Modbus bridge`}</pre>
      </AnimatedSection>
      <AnimatedSection as="section" className="panel" enter="rise">
        <div className="panel-header">
          <h2>Battery Integration Compatibility Matrix</h2>
          <p className="hint">Launch scope: local control is supported only through Home Assistant and Generic Modbus.</p>
        </div>
        <div className="table">
          <div className="table-row head">
            <span>Protocol / Path</span>
            <span>Always-on device required</span>
            <span>Supports monitor</span>
            <span>Supports control</span>
            <span>Security posture</span>
            <span>Best for</span>
          </div>
          <div className="table-row">
            <span>Home Assistant</span>
            <span>Yes</span>
            <span>Yes</span>
            <span>Yes</span>
            <span>Local automation bridge, token stays local</span>
            <span>Users already running HA</span>
          </div>
          <div className="table-row">
            <span>Generic Modbus</span>
            <span>Recommended</span>
            <span>Yes</span>
            <span>Yes</span>
            <span>Direct local path, higher responsibility</span>
            <span>Advanced users / integrators</span>
          </div>
          <div className="table-row">
            <span>Vendor Cloud / Amber Only</span>
            <span>No</span>
            <span>Partial</span>
            <span>No</span>
            <span>Cloud read or price-only path</span>
            <span>Backtest-first / non-technical users</span>
          </div>
        </div>
        <div className="hint">
          Home Assistant is a bridge path, not a low-level protocol. Launch mode supports local control only through Home Assistant or Generic Modbus. No secrets are stored in cloud sync.
        </div>
      </AnimatedSection>
      <AnimatedSection as="section" className="panel" enter="rise">
        <div className="panel-header">
          <h2>Local Bridge Onboarding</h2>
          <p className="hint">For beginners: run one small always-on bridge, then point this website at it.</p>
        </div>
        <StaggerGroup className="summary-grid">
          <div className="summary-card">
            <span className="mono">Need one device</span>
            <strong>Always-on local host</strong>
            <span>Use a Raspberry Pi, NAS, Home Assistant host, old laptop, or mini PC.</span>
          </div>
          <div className="summary-card">
            <span className="mono">Pick one path</span>
            <strong>HA or Generic Modbus</strong>
            <span>Launch support is limited to Home Assistant and Generic Modbus bridges.</span>
          </div>
          <div className="summary-card">
            <span className="mono">Point the website</span>
            <strong>Set Bridge URL</strong>
            <span>Example: <code>http://YOUR-BRIDGE-HOST:8787</code></span>
          </div>
          <div className="summary-card">
            <span className="mono">Test in order</span>
            <strong>Telemetry first</strong>
            <span>Do not enable local control until telemetry and bridge health are both green.</span>
          </div>
        </StaggerGroup>
        <pre className="code-block">{`# 1. create bridge config\ncd bridge\ncp config.example.json config.json\n\n# 2. edit provider and local settings\n# provider: home-assistant or generic-modbus\n\n# 3. start the bridge\nnpm start\n\n# 4. in SmartElectricity Config\n# set Bridge URL to http://YOUR-BRIDGE-HOST:8787\n# then test telemetry before enabling control`}</pre>
        <div className="hint">
          This website does not control batteries through cloud relay. It only talks to your own local bridge. Tokens, passwords, hostnames, and bridge URLs stay local.
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span className="mono">Bridge Runtime</span>
            <strong>{bridgeUrl === "http://localhost:5174" ? "Example: http://localhost:5174" : bridgeUrl || "Bridge URL missing"}</strong>
            <span className="hint">
              {bridgeStatusUrl ? (
                <>
                  Open <a href={bridgeStatusUrl} target="_blank" rel="noreferrer">status page</a> to inspect local bridge health.
                </>
              ) : (
                "Set a valid Bridge URL to inspect the local bridge."
              )}
            </span>
          </div>
          <div className="summary-card">
            <span className="mono">Config Validation</span>
            <strong>
              {bridgeValidation.loading
                ? "Checking..."
                : bridgeValidation.ok === null
                  ? "Not checked"
                  : bridgeValidation.ok
                    ? "Ready for monitor"
                    : "Config incomplete"}
            </strong>
            <span className="hint">{bridgeValidation.message}</span>
          </div>
        </div>
        <div className="hero-actions">
          <button className="ghost small" onClick={onValidateBridgeConfig} disabled={bridgeValidation.loading}>
            {bridgeValidation.loading ? "Validating..." : "Validate Bridge Config"}
          </button>
          {bridgeStatusUrl ? (
            <button
              className="ghost small"
              onClick={() => window.open(bridgeStatusUrl, "_blank", "noopener,noreferrer")}
            >
              Open Bridge Status
            </button>
          ) : null}
        </div>
        <AnimatedSwitch
          switchKey={`${bridgeValidation.loading}-${bridgeValidation.ok}-${bridgeValidation.message}-${bridgeValidation.checkedAt || 0}`}
          className="bridge-validation-switch"
          mode="slide"
        >
        {bridgeValidation.errors.length || bridgeValidation.warnings.length ? (
          <StaggerGroup className="summary-grid" delayStep={90}>
            <div className="summary-card motion-hero-node hero-config motion-status-error">
              <span className="mono">Validation Errors</span>
              <strong>{bridgeValidation.errors.length}</strong>
              <span>{bridgeValidation.errors[0] || "No blocking errors."}</span>
            </div>
            <div className="summary-card motion-hero-node hero-config motion-status-success">
              <span className="mono">Validation Warnings</span>
              <strong>{bridgeValidation.warnings.length}</strong>
              <span>{bridgeValidation.warnings[0] || "No warnings."}</span>
            </div>
          </StaggerGroup>
        ) : null}
        </AnimatedSwitch>
        <StaggerGroup className="summary-grid">
          <div className="summary-card">
            <span className="mono">HA example</span>
            <strong>Entity + service map</strong>
            <pre className="code-block">{`"provider": "home-assistant"\n"homeAssistant": {\n  "baseUrl": "http://YOUR-HOME-ASSISTANT:8123",\n  "token": "YOUR_HA_TOKEN",\n  "socEntity": "sensor.battery_soc",\n  "batteryPowerEntity": "sensor.battery_power_kw",\n  "gridPowerEntity": "sensor.grid_power_kw",\n  "solarPowerEntity": "sensor.pv_power_kw",\n  "commandMap": {\n    "templates": {\n      "charge": {\n        "serviceDomain": "select",\n        "serviceName": "select_option",\n        "serviceData": {\n          "entity_id": "select.battery_mode",\n          "option": "Charge"\n        }\n      }\n    }\n  }\n}`}</pre>
          </div>
          <div className="summary-card">
            <span className="mono">Modbus example</span>
            <strong>Register map</strong>
            <pre className="code-block">{`"provider": "generic-modbus"\n"genericModbus": {\n  "host": "YOUR-MODBUS-HOST",\n  "port": 502,\n  "unitId": 247,\n  "byteOrder": "ABCD",\n  "registerMap": {\n    "socPct": { "address": 30000, "format": "u16", "scale": 10 }\n  }\n}`}</pre>
          </div>
        </StaggerGroup>
        <div className="hint">
          Tip: your bridge can expose <code>/api/config/validate</code>. The Modbus/bridge test button will use it first and tell beginners exactly which config fields are missing.
        </div>
      </AnimatedSection>
      <section className="panel">
        <div className="panel-header">
          <h2>Token Validation & Security</h2>
          <p className="hint">Format check + encryption/storage guidance</p>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span className="mono">Token Posture</span>
            <strong>{tokenSecurity.label}</strong>
            <span className="hint">Score {formatScore(tokenSecurity.score)}</span>
          </div>
          <div className="summary-card">
            <span className="mono">Recommended Storage</span>
            <strong>Server-side only</strong>
            <span className="hint">Use Supabase Function env vars</span>
          </div>
        </div>
        <ul className="reason-list">
          {tokenSecurity.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>
      <section className="panel" id="config-logs">
        <div className="panel-header">
          <h2>Amber/Modbus Connection History</h2>
          <p className="hint">Latest test and runtime connection events</p>
        </div>
        {connectionLogs.length ? (
          <div className="table">
            <div className="table-row head">
              <span>Time</span>
              <span>Service</span>
              <span>Status</span>
              <span>Message</span>
              <span>Host</span>
              <span>Context</span>
            </div>
            {connectionLogs.map((event) => (
              <div key={`${event.at}-${event.service}-${event.message}`} className="table-row">
                <span>{new Date(event.at).toLocaleString()}</span>
                <span>{event.service}</span>
                <span>{event.status}</span>
                <span>{event.message}</span>
                <span>{deploymentStatus.host}</span>
                <span>{siteId ? `site:${siteId.slice(0, 8)}...` : "site:unset"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No connection logs yet. Run Amber/Modbus tests in Onboarding.</div>
        )}
      </section>
    </>
  );
}
