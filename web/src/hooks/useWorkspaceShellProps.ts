import { useMemo } from "react";
import type { NormalizedBatteryTelemetry } from "../core/telemetry";
import type { RegionBucket } from "../gui/CommunityPanels";

type ConfigShellPropsInput = {
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
  siteId: string;
  effectiveAuthRegion: string;
  authRegionFromPostcode: { label: string; market: string };
  batteryTelemetry: NormalizedBatteryTelemetry;
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
  apiBase: string;
  anonKey: string | undefined;
  token: string;
  solcastApiKey: string;
  llmApiToken: string;
  privateSecretsStatus: string;
  privateSecretsLoadedAt: number | null;
  handleSavePrivateSecrets: () => Promise<void>;
  handleLoadPrivateSecrets: () => Promise<void>;
  setToken: (value: string) => void;
  setSolcastApiKey: (value: string) => void;
  setLlmApiToken: (value: string) => void;
  applyOnboarding: (next: {
    siteId: string;
    token: string;
    start: string;
    end: string;
    resolution: number;
  }) => void;
  appendConnectionLog: (item: {
    service: "amber" | "modbus";
    status: "ok" | "error" | "testing";
    message: string;
  }) => void;
  handleAuthSubmit: () => Promise<void>;
  handleAuthResetPassword: () => Promise<void>;
  handleAuthSignOut: () => Promise<void>;
  handleSaveUserConfig: () => Promise<void>;
  handleLoadUserConfig: () => Promise<void>;
  handleValidateBridgeConfig: () => Promise<void>;
  setAuthMode: (mode: "signin" | "signup") => void;
  setAuthEmail: (value: string) => void;
  setAuthPassword: (value: string) => void;
  setAuthDisplayName: (value: string) => void;
  setAuthPostcode: (value: string) => void;
};

type WelcomeShellPropsInput = {
  activeTab: "welcome" | "leaderboard";
  authSession: { user?: { email?: string } } | null;
  homeWelcomeStats: {
    activeUsersNow: number;
    publicMode: string;
    topRegion: string;
    topRegionUsers: number;
    trustLabel: string;
  };
  supportedBatteryBrands: {
    name: string;
    mode: string;
    detail: string;
    tone: string;
  }[];
  shapes: { short: string; d: string; labelX: number; labelY: number }[];
  welcomeRegionMapByCode: Map<
    string,
    { code: string; label: string; postcodeRange: string; tone: string; users: number }
  >;
  welcomeRegionInsightsByCode: Map<
    string,
    {
      code: string;
      label: string;
      postcodeRange: string;
      users: number;
      pulse: string;
      totalProfitAud: number;
      avgProfitAud: number | null;
    }
  >;
  welcomeMapHoverRegion: string | null;
  welcomeMapSelectedRegion: string | null;
  communityLeaderboard: {
    user_id: string;
    day?: string;
    label?: string;
    region: string;
    profit_aud: number;
    capabilityScore?: number;
  }[];
  communityStatus: string;
  filteredCommunityOnlineNow: number;
  filteredCommunityTopRegion: { region: string; online_now: number | null } | null;
  filteredCommunityMyEntry: { rank: number; profit_aud: number } | null;
  leaderboardRegionFilter: string;
  leaderboardBucketFilter: string;
  filteredPublicRegionActivity: {
    region: string;
    online_now: number | null;
    latest_seen_at: string | null;
  }[];
  filteredCommunityLeaderboard: {
    id: string;
    rank: number;
    label: string;
    region: string;
    profit_aud: number;
    capabilityScore: number;
    marketAlpha: number;
    stability: number;
    execution: number;
  }[];
  communityRegionRanksByEntryId: Map<string, number>;
  regionBuckets: RegionBucket[];
  setWelcomeMapHoverRegion: (value: string | null) => void;
  setWelcomeMapSelectedRegion: (value: string | null) => void;
  setActiveTab: (
    tab: "home" | "backtest" | "monitor" | "config" | "welcome" | "leaderboard",
  ) => void;
  openWorkspaceTab: (tab: "backtest" | "monitor" | "config") => void;
  openLeaderboardForRegion: (shortCode: string, openTab: () => void) => void;
  setLeaderboardRegionFilter: (value: string) => void;
  setLeaderboardBucketFilter: (value: string) => void;
  formatProfit: (value: number) => string;
  getRegionBucketMeta: (regionCode: string) => RegionBucket;
  scrollToSection: (id: string) => void;
};

export function useConfigWorkspaceShellProps({
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
  siteId,
  effectiveAuthRegion,
  authRegionFromPostcode,
  batteryTelemetry,
  bridgeUrl,
  bridgeStatusUrl,
  bridgeValidation,
  apiBase,
  anonKey,
  token,
  solcastApiKey,
  llmApiToken,
  privateSecretsStatus,
  privateSecretsLoadedAt,
  handleSavePrivateSecrets,
  handleLoadPrivateSecrets,
  setToken,
  setSolcastApiKey,
  setLlmApiToken,
  applyOnboarding,
  appendConnectionLog,
  handleAuthSubmit,
  handleAuthResetPassword,
  handleAuthSignOut,
  handleSaveUserConfig,
  handleLoadUserConfig,
  handleValidateBridgeConfig,
  setAuthMode,
  setAuthEmail,
  setAuthPassword,
  setAuthDisplayName,
  setAuthPostcode,
}: ConfigShellPropsInput) {
  const accountPanelProps = useMemo(
    () => ({
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
      siteConfigured: Boolean(siteId),
      effectiveAuthRegion,
      authRegionFromPostcode,
      batteryHealth: {
        status: batteryTelemetry.status,
        statusLabel: batteryTelemetry.statusLabel,
        healthHint: batteryTelemetry.healthHint,
        sourceLabel: batteryTelemetry.sourceLabel,
      },
      onAuthModeChange: () => {},
    }),
    [
      authDisplayName,
      authEmail,
      authError,
      authLoading,
      authMode,
      authPassword,
      authPostcode,
      authRegionFromPostcode,
      authSession,
      authStatus,
      batteryTelemetry.healthHint,
      batteryTelemetry.sourceLabel,
      batteryTelemetry.status,
      batteryTelemetry.statusLabel,
      effectiveAuthRegion,
      siteId,
      supabaseProjectUrl,
      userConfigLoadedAt,
      userConfigStatus,
    ],
  );
  const onboardingWizardProps = useMemo(
    () => ({
      apiBase,
      anonKey,
      defaultSiteId: authSession ? siteId : "",
      defaultToken: authSession ? token : "",
      onApply: applyOnboarding,
      onConnectionEvent: appendConnectionLog,
    }),
    [anonKey, apiBase, appendConnectionLog, applyOnboarding, authSession, siteId, token],
  );

  return {
    accountPanelProps: {
      ...accountPanelProps,
      onAuthModeChange: setAuthMode,
      onAuthEmailChange: setAuthEmail,
      onAuthPasswordChange: setAuthPassword,
      onAuthDisplayNameChange: setAuthDisplayName,
      onAuthPostcodeChange: setAuthPostcode,
      onSubmit: () => {
        void handleAuthSubmit();
      },
      onResetPassword: () => {
        void handleAuthResetPassword();
      },
      onSignOut: () => {
        void handleAuthSignOut();
      },
      onSaveConfig: () => {
        void handleSaveUserConfig();
      },
      onLoadConfig: () => {
        void handleLoadUserConfig();
      },
    },
    onboardingWizardProps,
    bridgeShellProps: {
      bridgeUrl,
      bridgeStatusUrl,
      bridgeValidation,
      onValidateBridgeConfig: () => {
        void handleValidateBridgeConfig();
      },
    },
    llmRuntimeProps: {
      amberToken: token,
      solcastApiKey,
      llmApiToken,
      privateSecretsStatus,
      privateSecretsLoadedAt,
      onAmberTokenChange: setToken,
      onSolcastApiKeyChange: setSolcastApiKey,
      onLlmApiTokenChange: setLlmApiToken,
      onSavePrivateSecrets: () => {
        void handleSavePrivateSecrets();
      },
      onLoadPrivateSecrets: () => {
        void handleLoadPrivateSecrets();
      },
    },
  };
}

export function useWelcomeLeaderboardShellProps({
  activeTab,
  authSession,
  homeWelcomeStats,
  supportedBatteryBrands,
  shapes,
  welcomeRegionMapByCode,
  welcomeRegionInsightsByCode,
  welcomeMapHoverRegion,
  welcomeMapSelectedRegion,
  communityLeaderboard,
  communityStatus,
  filteredCommunityOnlineNow,
  filteredCommunityTopRegion,
  filteredCommunityMyEntry,
  leaderboardRegionFilter,
  leaderboardBucketFilter,
  filteredPublicRegionActivity,
  filteredCommunityLeaderboard,
  communityRegionRanksByEntryId,
  regionBuckets,
  setWelcomeMapHoverRegion,
  setWelcomeMapSelectedRegion,
  setActiveTab,
  openWorkspaceTab,
  openLeaderboardForRegion,
  setLeaderboardRegionFilter,
  setLeaderboardBucketFilter,
  formatProfit,
  getRegionBucketMeta,
  scrollToSection,
}: WelcomeShellPropsInput) {
  const welcomeLeaderboardPreview = useMemo(
    () => communityLeaderboard.slice(0, 5),
    [communityLeaderboard],
  );

  const handleOpenLeaderboardForRegion = useMemo(
    () => (shortCode: string) => {
      openLeaderboardForRegion(shortCode, () => setActiveTab("leaderboard"));
    },
    [openLeaderboardForRegion, setActiveTab],
  );

  return useMemo(
    () => ({
      activeCommunityTab: activeTab === "leaderboard" ? "leaderboard" : "welcome",
      authSession,
      homeWelcomeStats,
      supportedBatteryBrands,
      shapes,
      welcomeRegionMapByCode,
      welcomeRegionInsightsByCode,
      welcomeMapHoverRegion,
      welcomeMapSelectedRegion,
      welcomeLeaderboardPreview,
      communityStatus,
      filteredCommunityOnlineNow,
      filteredCommunityTopRegion,
      filteredCommunityMyEntry,
      leaderboardRegionFilter,
      leaderboardBucketFilter,
      filteredPublicRegionActivity,
      filteredCommunityLeaderboard,
      communityRegionRanksByEntryId,
      regionBuckets,
      onHoverRegion: setWelcomeMapHoverRegion,
      onSelectRegion: setWelcomeMapSelectedRegion,
      onOpenAccount: () => {
        setActiveTab("config");
        window.setTimeout(() => scrollToSection("welcome-account"), 0);
      },
      onOpenBacktest: () => openWorkspaceTab("backtest"),
      onOpenMonitor: () => openWorkspaceTab("monitor"),
      onOpenLeaderboardForRegion: handleOpenLeaderboardForRegion,
      onLeaderboardRegionFilterChange: setLeaderboardRegionFilter,
      onLeaderboardBucketFilterChange: setLeaderboardBucketFilter,
      formatProfit,
      getRegionBucketMeta,
    }),
    [
      activeTab,
      authSession,
      communityRegionRanksByEntryId,
      communityStatus,
      filteredCommunityLeaderboard,
      filteredCommunityMyEntry,
      filteredCommunityOnlineNow,
      filteredCommunityTopRegion,
      filteredPublicRegionActivity,
      formatProfit,
      getRegionBucketMeta,
      handleOpenLeaderboardForRegion,
      homeWelcomeStats,
      leaderboardBucketFilter,
      leaderboardRegionFilter,
      openWorkspaceTab,
      communityLeaderboard,
      regionBuckets,
      scrollToSection,
      setActiveTab,
      setLeaderboardBucketFilter,
      setLeaderboardRegionFilter,
      setWelcomeMapHoverRegion,
      setWelcomeMapSelectedRegion,
      shapes,
      supportedBatteryBrands,
      welcomeLeaderboardPreview,
      welcomeMapHoverRegion,
      welcomeMapSelectedRegion,
      welcomeRegionInsightsByCode,
      welcomeRegionMapByCode,
      welcomeLeaderboardPreview,
    ],
  );
}
