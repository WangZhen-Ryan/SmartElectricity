import { useEffect, useState } from "react";
import type { BacktestConfig, StrategyResult } from "../core/types";
import type { NormalizedBatteryTelemetry } from "../core/telemetry";
import {
  prepareCloudConfigPayload,
  preparePublicLeaderboardPayload,
} from "../core/privacy";
import {
  persistSupabaseSession,
  readStoredSupabaseSession,
  supabaseEnsureProfile,
  supabaseGetUser,
  supabaseLoadDefaultConfig,
  supabaseLoadStrategyProfiles,
  supabasePasswordSignIn,
  supabasePasswordSignUp,
  supabaseSaveDefaultConfig,
  supabaseSaveStrategyProfile,
  supabaseSendPasswordReset,
  supabaseSignOut,
  supabaseUpdatePassword,
  supabaseUpsertLeaderboardEntry,
  type SupabaseSessionState,
  type SupabaseStrategyProfileRow,
} from "../core/supabase_client";
import { formatProfit } from "../core/utils";

const STRATEGY_STUDIO_STORAGE_KEY = "strategy_studio_profile_v1";

type ActiveDiagnosticsLike = {
  qualityScore: number | null;
  drawdown: number;
  coveragePct: number;
  winRateValue: number;
} | null;

type EfficiencyMetricsLike = {
  profitPerKwh: number;
  cycles: number;
  utilization: number | null;
} | null;

type CloudConfigPayloadFactory = (userId: string) => Record<string, unknown>;

type CapabilityBreakdown = {
  capabilityScore: number;
  marketAlpha: number;
  stability: number;
  execution: number;
};

type Props = {
  supabaseProjectUrl: string | null;
  anonKey: string | undefined;
  authPostcode: string;
  effectiveAuthRegion: string;
  activeStrategy: string;
  config: BacktestConfig;
  strategyStudioName: string;
  strategyReserveMarginPct: number;
  strategyRlWeight: number;
  strategyForecastWeight: number;
  strategyPublishEnabled: boolean;
  active: StrategyResult | undefined;
  activeDiagnostics: ActiveDiagnosticsLike;
  efficiencyMetrics: EfficiencyMetricsLike;
  batteryTelemetry: NormalizedBatteryTelemetry;
  setActiveTab: (tab: "home" | "backtest" | "monitor" | "config" | "welcome" | "leaderboard") => void;
  onApplyCloudConfigRow: (row: any) => void;
  onApplyStrategyProfileRow: (row: SupabaseStrategyProfileRow) => void;
  buildCloudConfigPayload: CloudConfigPayloadFactory;
  computeCapabilityBreakdown: (input: {
    profitAud: number;
    drawdownAud: number;
    qualityScore: number;
    coveragePct: number;
    winRate: number;
    profitPerKwh: number;
    utilizationPct: number | null;
    cycles: number;
    exportKwh: number;
    importKwh: number;
  }) => CapabilityBreakdown;
  onClearLocalSensitiveState?: () => void;
};

export function useAuthWorkspaceState({
  supabaseProjectUrl,
  anonKey,
  authPostcode,
  effectiveAuthRegion,
  activeStrategy,
  config,
  strategyStudioName,
  strategyReserveMarginPct,
  strategyRlWeight,
  strategyForecastWeight,
  strategyPublishEnabled,
  active,
  activeDiagnostics,
  efficiencyMetrics,
  batteryTelemetry,
  setActiveTab,
  onApplyCloudConfigRow,
  onApplyStrategyProfileRow,
  buildCloudConfigPayload,
  computeCapabilityBreakdown,
  onClearLocalSensitiveState,
}: Props) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authSession, setAuthSession] = useState<SupabaseSessionState | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState("Supabase Auth is idle.");
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [resetStatus, setResetStatus] = useState("Enter a new password.");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [userConfigStatus, setUserConfigStatus] = useState("No cloud config loaded.");
  const [userConfigLoadedAt, setUserConfigLoadedAt] = useState<number | null>(null);
  const [leaderboardPublishStatus, setLeaderboardPublishStatus] = useState("Private run only.");
  const [strategyProfileStatus, setStrategyProfileStatus] = useState("Strategy Studio idle.");
  const [strategyProfileLoadedAt, setStrategyProfileLoadedAt] = useState<number | null>(null);
  const [savedStrategyProfiles, setSavedStrategyProfiles] = useState<SupabaseStrategyProfileRow[]>([]);
  const [selectedStrategyProfileId, setSelectedStrategyProfileId] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STRATEGY_STUDIO_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        name?: string;
      };
      if (parsed.name) {
        setStrategyProfileLoadedAt(Date.now());
      }
    } catch {
      // Ignore invalid local snapshot.
    }
  }, []);

  async function ensureUserProfileAndConfig(session: SupabaseSessionState, announce = true) {
    if (!supabaseProjectUrl || !anonKey) {
      throw new Error("Supabase project URL or anon key missing.");
    }
    await supabaseEnsureProfile(supabaseProjectUrl, anonKey, session.accessToken, {
      id: session.user.id,
      display_name: authDisplayName.trim() || session.user.email?.split("@")[0] || "Energy User",
      region: effectiveAuthRegion,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney",
      is_public: false,
    });
    const rows = await supabaseLoadDefaultConfig(
      supabaseProjectUrl,
      anonKey,
      session.accessToken,
      session.user.id,
    );
    const row = rows[0];
    if (row) {
      onApplyCloudConfigRow(row);
      if (announce) {
        setUserConfigStatus(`Loaded cloud config “${row.name || "Primary Setup"}”.`);
      }
      return;
    }
    const seedPayload = buildCloudConfigPayload(session.user.id);
    await supabaseSaveDefaultConfig(supabaseProjectUrl, anonKey, session.accessToken, seedPayload);
    setUserConfigStatus("Seeded a new Primary Setup in cloud.");
    setUserConfigLoadedAt(Date.now());
  }

  async function refreshSavedStrategyProfiles(session = authSession) {
    if (!session || !supabaseProjectUrl || !anonKey) {
      setSavedStrategyProfiles([]);
      setSelectedStrategyProfileId("");
      return;
    }
    const rows = await supabaseLoadStrategyProfiles(
      supabaseProjectUrl,
      anonKey,
      session.accessToken,
      session.user.id,
    );
    setSavedStrategyProfiles(rows);
    setSelectedStrategyProfileId((prev) => prev || rows.find((row) => row.is_active)?.id || "");
  }

  async function handleAuthSubmit() {
    if (!supabaseProjectUrl || !anonKey) {
      setAuthError("Supabase runtime is not configured.");
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Email and password are required.");
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    setAuthStatus(authMode === "signin" ? "Signing in..." : "Creating account...");
    try {
      const response =
        authMode === "signin"
          ? await supabasePasswordSignIn(supabaseProjectUrl, anonKey, authEmail.trim(), authPassword)
          : await supabasePasswordSignUp(supabaseProjectUrl, anonKey, authEmail.trim(), authPassword, {
              display_name:
                authDisplayName.trim() || authEmail.trim().split("@")[0] || "Energy User",
              region: effectiveAuthRegion,
              postcode: authPostcode.trim(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney",
            });
      if (!response.access_token || !response.user?.id) {
        setAuthStatus("Signup started. Check your email if confirmation is required.");
        return;
      }
      const session = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token || null,
        user: response.user,
      };
      setAuthSession(session);
      persistSupabaseSession(session);
      await ensureUserProfileAndConfig(session);
      setAuthStatus(`${authMode === "signin" ? "Signed in" : "Account created"} for ${response.user.email || authEmail}.`);
      setActiveTab("config");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Auth request failed.");
      setAuthStatus("Auth failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleAuthResetPassword() {
    if (!supabaseProjectUrl || !anonKey) {
      setAuthError("Supabase runtime is not configured.");
      return;
    }
    if (!authEmail.trim()) {
      setAuthError("Enter your email first, then click Reset Password.");
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
    setAuthStatus("Sending password reset email...");
    try {
      const configuredAppUrl = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
      const appOrigin = configuredAppUrl
        ? configuredAppUrl.replace(/\/+$/, "")
        : typeof window !== "undefined"
          ? window.location.origin
          : "";
      const redirectTo = appOrigin ? `${appOrigin}/auth/reset-password?flow=recovery` : undefined;
      await supabaseSendPasswordReset(
        supabaseProjectUrl,
        anonKey,
        authEmail.trim(),
        redirectTo,
      );
      setAuthStatus(
        `Password reset email sent to ${authEmail.trim()}. Use the latest email link (older links expire quickly).`,
      );
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to send reset email.");
      setAuthStatus("Password reset failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCompletePasswordReset(recoveryAccessToken: string) {
    if (!supabaseProjectUrl || !anonKey) {
      setResetError("Supabase runtime is not configured.");
      return;
    }
    if (!resetPasswordValue || resetPasswordValue.length < 8) {
      setResetError("Password must be at least 8 characters.");
      return;
    }
    if (resetPasswordValue !== resetPasswordConfirm) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetError(null);
    setResetLoading(true);
    setResetStatus("Updating password...");
    try {
      await supabaseUpdatePassword(
        supabaseProjectUrl,
        anonKey,
        recoveryAccessToken,
        resetPasswordValue,
      );
      setResetStatus("Password updated. You can now sign in.");
      if (typeof window !== "undefined") {
        const cleanUrl = `${window.location.origin}/`;
        window.history.replaceState({}, "", cleanUrl);
      }
      setResetPasswordValue("");
      setResetPasswordConfirm("");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to update password.");
      setResetStatus("Password reset failed.");
    } finally {
      setResetLoading(false);
    }
  }

  async function handleAuthSignOut() {
    if (!authSession || !supabaseProjectUrl || !anonKey) {
      setAuthSession(null);
      persistSupabaseSession(null);
      setAuthStatus("Signed out.");
      return;
    }
    setAuthLoading(true);
    try {
      await supabaseSignOut(supabaseProjectUrl, anonKey, authSession.accessToken);
    } catch {
      // Clear local state even if network sign-out fails.
    } finally {
      onClearLocalSensitiveState?.();
      setAuthSession(null);
      persistSupabaseSession(null);
      setAuthLoading(false);
      setAuthStatus("Signed out.");
      setUserConfigStatus("No cloud config loaded.");
      setStrategyProfileStatus("Strategy Studio idle.");
      setLeaderboardPublishStatus("Private run only.");
      setSavedStrategyProfiles([]);
      setSelectedStrategyProfileId("");
      setActiveTab("home");
    }
  }

  async function handleSaveUserConfig() {
    if (!authSession || !supabaseProjectUrl || !anonKey) {
      setUserConfigStatus("Sign in first to save cloud config.");
      return;
    }
    setUserConfigStatus("Saving cloud config...");
    try {
      const payload = buildCloudConfigPayload(authSession.user.id);
      await supabaseSaveDefaultConfig(
        supabaseProjectUrl,
        anonKey,
        authSession.accessToken,
        payload,
      );
      setUserConfigStatus(
        "Saved current non-secret config to cloud. Local network values, passwords, tokens, and vendor credentials were excluded.",
      );
      setUserConfigLoadedAt(Date.now());
    } catch (err) {
      setUserConfigStatus(
        err instanceof Error ? `Cloud save failed: ${err.message}` : "Cloud save failed.",
      );
    }
  }

  async function handleLoadUserConfig() {
    if (!authSession || !supabaseProjectUrl || !anonKey) {
      setUserConfigStatus("Sign in first to load cloud config.");
      return;
    }
    setUserConfigStatus("Loading cloud config...");
    try {
      await ensureUserProfileAndConfig(authSession, false);
      setUserConfigStatus("Loaded cloud config into the current session.");
    } catch (err) {
      setUserConfigStatus(
        err instanceof Error ? `Cloud load failed: ${err.message}` : "Cloud load failed.",
      );
    }
  }

  async function handleSaveStrategyStudio() {
    const snapshot = {
      name: strategyStudioName,
      reserveMarginPct: strategyReserveMarginPct,
      rlWeight: strategyRlWeight,
      forecastWeight: strategyForecastWeight,
      publishEnabled: strategyPublishEnabled,
      activeStrategy,
      mode: config.mode,
    };
    try {
      localStorage.setItem(STRATEGY_STUDIO_STORAGE_KEY, JSON.stringify(snapshot));
      setStrategyProfileLoadedAt(Date.now());
    } catch {
      // Keep going; cloud save may still work.
    }
    if (!authSession || !supabaseProjectUrl || !anonKey || !active) {
      setStrategyProfileStatus("Saved Strategy Studio snapshot locally.");
      return;
    }
    setStrategyProfileStatus("Saving strategy profile...");
    try {
      const cloudProfilePayload = prepareCloudConfigPayload({
        user_id: authSession.user.id,
        name: strategyStudioName,
        mode: config.mode,
        is_active: true,
        config: {
          activeStrategy,
          reserveMarginPct: strategyReserveMarginPct,
          rlWeight: strategyRlWeight,
          forecastWeight: strategyForecastWeight,
          publishEnabled: strategyPublishEnabled,
          backtest: config,
        },
        latest_profit_aud: active.summary.profit,
        latest_score: activeDiagnostics?.qualityScore ?? null,
        latest_backtest_at: new Date().toISOString(),
      });
      await supabaseSaveStrategyProfile(
        supabaseProjectUrl,
        anonKey,
        authSession.accessToken,
        cloudProfilePayload,
      );
      const next = await supabaseLoadStrategyProfiles(
        supabaseProjectUrl,
        anonKey,
        authSession.accessToken,
        authSession.user.id,
      );
      setSavedStrategyProfiles(next);
      const current = next.find((row) => row.name === strategyStudioName);
      setSelectedStrategyProfileId(current?.id || "");
      setStrategyProfileStatus("Saved Strategy Studio profile to cloud.");
      setStrategyProfileLoadedAt(Date.now());
    } catch (err) {
      setStrategyProfileStatus(
        err instanceof Error ? `Cloud strategy save failed: ${err.message}` : "Cloud strategy save failed.",
      );
    }
  }

  async function handleLoadSelectedStrategyProfile() {
    const selected = savedStrategyProfiles.find((row) => row.id === selectedStrategyProfileId);
    if (!selected) {
      setStrategyProfileStatus("Select a saved strategy profile first.");
      return;
    }
    onApplyStrategyProfileRow(selected);
  }

  async function handleSetActiveStrategyProfile() {
    if (!authSession || !supabaseProjectUrl || !anonKey) {
      setStrategyProfileStatus("Sign in first to set an active cloud profile.");
      return;
    }
    const selected = savedStrategyProfiles.find((row) => row.id === selectedStrategyProfileId);
    if (!selected) {
      setStrategyProfileStatus("Select a saved strategy profile first.");
      return;
    }
    setStrategyProfileStatus(`Setting “${selected.name}” active...`);
    const activeProfilePayload = prepareCloudConfigPayload({
      user_id: authSession.user.id,
      name: selected.name,
      mode: selected.mode,
      is_active: true,
      config: selected.config,
      latest_profit_aud: selected.latest_profit_aud,
      latest_score: selected.latest_score,
      latest_backtest_at: selected.latest_backtest_at,
    });
    await supabaseSaveStrategyProfile(
      supabaseProjectUrl,
      anonKey,
      authSession.accessToken,
      activeProfilePayload,
    );
    await refreshSavedStrategyProfiles(authSession);
    onApplyStrategyProfileRow({ ...selected, is_active: true });
    setStrategyProfileStatus(`Set “${selected.name}” as the active profile.`);
  }

  async function handleGenerateStrategyProfileFromCurrent() {
    if (!active) {
      setStrategyProfileStatus("Run a backtest first so the studio can snapshot a result.");
      return;
    }
    const generatedName = `${active.name} · ${new Date().toLocaleDateString()}`;
    setStrategyProfileStatus(
      `Generated a studio profile from the current ${active.name} backtest result. Save it locally or to cloud.`,
    );
    return generatedName;
  }

  async function handlePublishActiveResult() {
    if (!authSession || !supabaseProjectUrl || !anonKey || !active) {
      setLeaderboardPublishStatus("Sign in first to publish this run.");
      return;
    }
    const profitAud = Number(active.summary.profit || 0);
    const drawdownAud = Number(activeDiagnostics?.drawdown || 0);
    const qualityScore = Number(activeDiagnostics?.qualityScore || 0);
    const coveragePct = Number(activeDiagnostics?.coveragePct || 0);
    const winRateValue = Number(activeDiagnostics?.winRateValue || 0);
    const profitPerKwh = Number(efficiencyMetrics?.profitPerKwh || 0);
    const cycles = Number(efficiencyMetrics?.cycles || 0);
    const exportKwh = Number(active.summary.sellKwh || 0);
    const importKwh = Number(active.summary.buyKwh || 0);
    const utilizationPct =
      typeof efficiencyMetrics?.utilization === "number" ? efficiencyMetrics.utilization : null;
    const displayName =
      authDisplayName.trim() || authSession.user.email?.split("@")[0] || "Energy User";
    const strategyLabel = strategyStudioName.trim() || active.name || activeStrategy;
    const { capabilityScore, marketAlpha, stability, execution } = computeCapabilityBreakdown({
      profitAud,
      drawdownAud,
      qualityScore,
      coveragePct,
      winRate: winRateValue,
      profitPerKwh,
      utilizationPct,
      cycles,
      exportKwh,
      importKwh,
    });
    setLeaderboardPublishStatus("Publishing active result...");
    try {
      await supabaseEnsureProfile(supabaseProjectUrl, anonKey, authSession.accessToken, {
        id: authSession.user.id,
        display_name: displayName,
        region: effectiveAuthRegion,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney",
        is_public: strategyPublishEnabled,
      });
      await supabaseUpsertLeaderboardEntry(
        supabaseProjectUrl,
        anonKey,
        authSession.accessToken,
        {
          user_id: authSession.user.id,
          region: effectiveAuthRegion,
          bucket: "daily",
          bucket_start: new Date().toISOString().slice(0, 10),
          score: capabilityScore,
          profit_aud: profitAud,
          roi_pct: importKwh > 0 ? (profitAud / importKwh) * 100 : 0,
          efficiency_score: profitPerKwh,
          cycles,
          export_kwh: exportKwh,
          import_kwh: importKwh,
          telemetry_quality: batteryTelemetry.isSimulated ? "simulated" : "battery-connected",
          details: (() => {
            return preparePublicLeaderboardPayload({
              strategy: strategyLabel,
              strategyStudioName,
              reserveMarginPct: strategyReserveMarginPct,
              rlWeight: strategyRlWeight,
              forecastWeight: strategyForecastWeight,
              qualityScore,
              drawdownAud,
              coveragePct,
              winRate: winRateValue,
              marketAlpha,
              stability,
              execution,
              capabilityScore,
              utilizationPct,
            });
          })(),
        },
      );
      setLeaderboardPublishStatus(
        strategyPublishEnabled
          ? "Published active result to public leaderboard."
          : "Saved profile private-only. Enable publish to make it public.",
      );
    } catch (err) {
      setLeaderboardPublishStatus(
        err instanceof Error ? `Publish failed: ${err.message}` : "Publish failed.",
      );
    }
  }

  useEffect(() => {
    if (!supabaseProjectUrl || !anonKey || authSession) return;
    let cancelled = false;
    const parsed = readStoredSupabaseSession();
    if (!parsed) {
      setAuthStatus((prev) =>
        prev === "Supabase Auth is idle." ? "Signed out. Sign in to sync private config." : prev,
      );
      return;
    }
    setAuthStatus("Restoring session...");
    supabaseGetUser(supabaseProjectUrl, anonKey, parsed.accessToken)
      .then(async (user) => {
        if (cancelled) return;
        const session = {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken || null,
          user,
        };
        setAuthSession(session);
        persistSupabaseSession(session);
        await ensureUserProfileAndConfig(session, false);
        if (!cancelled) {
          setAuthStatus(`Restored session for ${user.email || "user"}.`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAuthSession(null);
        persistSupabaseSession(null);
        setAuthStatus("Session expired. Sign in again to sync private config.");
      });
    return () => {
      cancelled = true;
    };
  }, [anonKey, authSession, supabaseProjectUrl]);

  useEffect(() => {
    if (!authSession) {
      setSavedStrategyProfiles([]);
      setSelectedStrategyProfileId("");
      return;
    }
    refreshSavedStrategyProfiles(authSession).catch((err) => {
      setStrategyProfileStatus(
        err instanceof Error ? `Failed to load cloud strategy profiles: ${err.message}` : "Failed to load cloud strategy profiles.",
      );
    });
  }, [authSession, supabaseProjectUrl, anonKey]);

  useEffect(() => {
    if (!active) {
      setLeaderboardPublishStatus("Private run only.");
      return;
    }
    const profitAud = Number(active.summary.profit || 0);
    const qualityScore = Number(activeDiagnostics?.qualityScore || 0);
    if (!authSession) {
      setLeaderboardPublishStatus("Run is local-only. Sign in to publish this strategy.");
      return;
    }
    setLeaderboardPublishStatus(
      strategyPublishEnabled
        ? `Ready to publish ${active.name} · ${formatProfit(profitAud)} · quality ${qualityScore}/100`
        : "Strategy stays private until you enable publish.",
    );
  }, [active, activeDiagnostics?.qualityScore, authSession, strategyPublishEnabled]);

  return {
    authMode,
    setAuthMode,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authDisplayName,
    setAuthDisplayName,
    authSession,
    authLoading,
    authStatus,
    setAuthStatus,
    authError,
    setAuthError,
    resetPasswordValue,
    setResetPasswordValue,
    resetPasswordConfirm,
    setResetPasswordConfirm,
    resetStatus,
    resetError,
    resetLoading,
    userConfigStatus,
    userConfigLoadedAt,
    setUserConfigLoadedAt,
    leaderboardPublishStatus,
    strategyProfileStatus,
    strategyProfileLoadedAt,
    savedStrategyProfiles,
    selectedStrategyProfileId,
    setSelectedStrategyProfileId,
    handleAuthSubmit,
    handleAuthResetPassword,
    handleCompletePasswordReset,
    handleAuthSignOut,
    handleSaveUserConfig,
    handleLoadUserConfig,
    handleSaveStrategyStudio,
    handleLoadSelectedStrategyProfile,
    handleSetActiveStrategyProfile,
    handleGenerateStrategyProfileFromCurrent,
    handlePublishActiveResult,
  };
}
