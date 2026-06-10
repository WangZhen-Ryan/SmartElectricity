import { useEffect, useMemo, useState } from "react";
import { PRIVACY_BOUNDARY_COPY } from "../core/privacy";
import AnimatedSection from "./AnimatedSection";
import AnimatedSwitch from "./AnimatedSwitch";
import StaggerGroup from "./StaggerGroup";

type AuthMode = "signin" | "signup";

type AuthSession = {
  user?: {
    email?: string;
  };
} | null;

type PostcodeRegion = {
  label: string;
  market: string;
};

type BatteryHealth = {
  status: string;
  statusLabel: string;
  healthHint: string;
  sourceLabel: string;
};

type Props = {
  authSession: AuthSession;
  authStatus: string;
  authMode: AuthMode;
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
  authRegionFromPostcode: PostcodeRegion;
  batteryHealth: BatteryHealth;
  onAuthModeChange: (mode: AuthMode) => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthDisplayNameChange: (value: string) => void;
  onAuthPostcodeChange: (value: string) => void;
  onSubmit: () => void;
  onResetPassword: () => void;
  onSignOut: () => void;
  onSaveConfig: () => void;
  onLoadConfig: () => void;
};

export default function ConfigAccountPanel({
  authSession,
  authStatus,
  authMode,
  authEmail,
  authPassword,
  authDisplayName,
  authPostcode,
  authLoading,
  authError,
  supabaseProjectUrl,
  userConfigLoadedAt,
  userConfigStatus,
  siteConfigured,
  effectiveAuthRegion,
  authRegionFromPostcode,
  batteryHealth,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onAuthDisplayNameChange,
  onAuthPostcodeChange,
  onSubmit,
  onResetPassword,
  onSignOut,
  onSaveConfig,
  onLoadConfig,
}: Props) {
  const successToastMessage = useMemo(() => {
    if (!authSession) return "";
    const normalized = authStatus.toLowerCase();
    if (normalized.includes("signed in for") || normalized.includes("account created")) {
      return authStatus;
    }
    return "";
  }, [authSession, authStatus]);
  const [showAuthSuccessToast, setShowAuthSuccessToast] = useState(false);

  useEffect(() => {
    if (!successToastMessage) {
      setShowAuthSuccessToast(false);
      return;
    }
    setShowAuthSuccessToast(true);
    const timeoutId = window.setTimeout(() => setShowAuthSuccessToast(false), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [successToastMessage]);

  return (
    <AnimatedSection as="section" className="panel config-account" id="welcome-account" enter="rise">
      <AnimatedSwitch
        switchKey={showAuthSuccessToast ? successToastMessage : "idle"}
        className="auth-success-toast-switch"
        mode="slide"
      >
        {showAuthSuccessToast ? (
          <div className="auth-success-toast motion-status-success" role="status" aria-live="polite">
            <span className="auth-success-toast-label">Sign-in successful</span>
            <strong>{successToastMessage}</strong>
          </div>
        ) : null}
      </AnimatedSwitch>
      <div className="panel-header">
        <h2>Account & Private Dashboard</h2>
        <p className="hint">Sign in with Supabase Auth to save your own Amber + battery setup.</p>
      </div>
      <StaggerGroup className="summary-grid">
        <div className="summary-card">
          <span className="mono">Auth Status</span>
          <strong>{authSession?.user?.email || "Signed out"}</strong>
          <span className="hint">{authStatus}</span>
        </div>
        <div className="summary-card">
          <span className="mono">Project</span>
          <strong>{supabaseProjectUrl ? "Supabase Ready" : "Missing Runtime"}</strong>
          <span className="hint">
            {supabaseProjectUrl ? "Cloud auth runtime connected." : "Set VITE_SUPABASE_* env vars first."}
          </span>
        </div>
        <div className="summary-card">
          <span className="mono">Cloud Config</span>
          <strong>{userConfigLoadedAt ? "Cloud + Session" : "Session Only"}</strong>
          <span className="hint">
            {authSession
              ? userConfigStatus
              : "Testing locally. Non-secret config only becomes cloud-synced after sign-in."}
          </span>
        </div>
        <div className="summary-card">
          <span className="mono">Postcode Routing</span>
          <strong>{authPostcode.trim() ? authRegionFromPostcode.label : effectiveAuthRegion}</strong>
          <span className="hint">
            {authPostcode.trim()
              ? `${authPostcode} maps to ${authRegionFromPostcode.market}`
              : "Add postcode to auto-map leaderboard region."}
          </span>
        </div>
      </StaggerGroup>
      <StaggerGroup className="config-account-grid" delayStep={110}>
        <div className="config-account-card">
          <span className="mono">Auth Form</span>
          <div className={`toggle auth-toggle motion-segmented ${authMode}`}>
            <button
              className={authMode === "signin" ? "active" : ""}
              onClick={() => onAuthModeChange("signin")}
              type="button"
            >
              Sign In
            </button>
            <button
              className={authMode === "signup" ? "active" : ""}
              onClick={() => onAuthModeChange("signup")}
              type="button"
            >
              Create Account
            </button>
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={authEmail}
              onChange={(event) => onAuthEmailChange(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={authPassword}
              onChange={(event) => onAuthPasswordChange(event.target.value)}
              placeholder="Use a dedicated app password"
            />
          </div>
          {authMode === "signup" ? (
            <>
              <div className="field">
                <label>Display Name</label>
                <input
                  value={authDisplayName}
                  onChange={(event) => onAuthDisplayNameChange(event.target.value)}
                  placeholder="Energy pilot"
                />
              </div>
              <div className="field">
                <label>Postcode</label>
                <input
                  value={authPostcode}
                  onChange={(event) =>
                    onAuthPostcodeChange(event.target.value.replace(/[^\d]/g, "").slice(0, 4))
                  }
                  placeholder="2000"
                />
                <span className="hint">
                  {authPostcode.trim()
                    ? `${authRegionFromPostcode.label} • ${authRegionFromPostcode.market}`
                    : "Used to auto-map your state / regional leaderboard bucket."}
                </span>
              </div>
            </>
          ) : null}
          <div className="hero-actions">
            <button
              className="primary"
              onClick={onSubmit}
              disabled={authLoading || !supabaseProjectUrl}
              type="button"
            >
              {authLoading
                ? authMode === "signin"
                  ? "Signing in..."
                  : "Creating..."
                : authMode === "signin"
                  ? "Sign In"
                  : "Create Account"}
            </button>
            {!authSession && authMode === "signin" ? (
              <button
                className="ghost"
                onClick={onResetPassword}
                disabled={authLoading || !supabaseProjectUrl}
                type="button"
              >
                Forgot Password
              </button>
            ) : null}
            {authSession ? (
              <button
                className="ghost"
                onClick={onSignOut}
                disabled={authLoading}
                type="button"
              >
                Sign Out
              </button>
            ) : null}
          </div>
          <AnimatedSwitch
            switchKey={authError ? `error-${authError}` : authStatus.toLowerCase().includes("password reset email sent") ? authStatus : "idle"}
            className="auth-feedback-switch"
            mode="slide"
          >
            {!authError && authStatus.toLowerCase().includes("password reset email sent") ? (
              <div className="auth-success-banner motion-status-success">{authStatus}</div>
            ) : null}
            {authError ? <div className="error motion-status-error">{authError}</div> : null}
          </AnimatedSwitch>
          <div className="hint">
            {PRIVACY_BOUNDARY_COPY.cloud}
          </div>
          <div className="summary-card config-privacy-audit">
            <span className="mono">Never Synced To Cloud</span>
            <strong>Tokens, passwords, local battery endpoints.</strong>
            <span className="hint">
              {PRIVACY_BOUNDARY_COPY.cloud}
            </span>
          </div>
        </div>
        <div className="config-account-card">
          <span className="mono">Private Config Sync</span>
          <div className="config-checklist">
            <div className={authSession ? "config-status ok" : "config-status warn"}>
              <span className="dot" />
              Authenticated profile
            </div>
            <div className={siteConfigured ? "config-status ok" : "config-status warn"}>
              <span className="dot" />
              Amber site attached
            </div>
            <div className={batteryHealth.status === "live" ? "config-status ok" : "config-status warn"}>
              <span className="dot" />
              Battery source health
            </div>
            <div className={userConfigLoadedAt ? "config-status ok" : "config-status warn"}>
              <span className="dot" />
              Cloud config loaded
            </div>
          </div>
          <div className="hero-actions">
            <button className="ghost" onClick={onSaveConfig} disabled={!authSession} type="button">
              Save Current Config
            </button>
            <button className="ghost" onClick={onLoadConfig} disabled={!authSession} type="button">
              Load Saved Config
            </button>
          </div>
          <div className="hint">
            Session values stay in this browser only. {PRIVACY_BOUNDARY_COPY.cloud}
          </div>
          <StaggerGroup className="summary-grid compact-grid" delayStep={90}>
            <div className="summary-card">
              <span className="mono">Default Setup</span>
              <strong>Primary Setup</strong>
              <span className="hint">Auto-created after first sign in.</span>
            </div>
            <div className="summary-card">
              <span className="mono">Battery Source</span>
              <strong>{batteryHealth.sourceLabel}</strong>
              <span className="hint">
                {batteryHealth.statusLabel} · {batteryHealth.healthHint}
              </span>
            </div>
          </StaggerGroup>
        </div>
      </StaggerGroup>
    </AnimatedSection>
  );
}
