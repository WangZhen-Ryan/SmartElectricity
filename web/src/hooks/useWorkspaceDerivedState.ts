import { useMemo } from "react";
import type { StrategyResult } from "../core/types";
import type { SupabaseStrategyProfileRow } from "../core/supabase_client";

type StrategyPublishPreview = {
  strategyLabel: string;
  regionLabel: string;
  qualityLabel: string;
  publicFieldsLabel: string;
};

type PublicRegionActivityRow = {
  region: string;
  online_now: number | null;
};

type CommunityLeaderboardRow = {
  region: string;
};

type Props = {
  active?: StrategyResult;
  activeStrategy: string;
  activeDiagnosticsQualityScore: number | null;
  effectiveAuthRegion: string;
  savedStrategyProfiles: SupabaseStrategyProfileRow[];
  supabaseProjectUrl: string | null;
  apiBase: string;
  publicRegionActivity: PublicRegionActivityRow[];
  communityLeaderboard: CommunityLeaderboardRow[];
  communityOnlineNow: number;
  getRegionBucketMeta: (regionCode: string) => { short: string };
};

export function useWorkspaceDerivedState({
  active,
  activeStrategy,
  activeDiagnosticsQualityScore,
  effectiveAuthRegion,
  savedStrategyProfiles,
  supabaseProjectUrl,
  apiBase,
  publicRegionActivity,
  communityLeaderboard,
  communityOnlineNow,
  getRegionBucketMeta,
}: Props) {
  const strategyPublishPreview = useMemo<StrategyPublishPreview>(
    () => ({
      strategyLabel: active?.name || activeStrategy,
      regionLabel: getRegionBucketMeta(effectiveAuthRegion).short,
      qualityLabel:
        activeDiagnosticsQualityScore !== undefined && activeDiagnosticsQualityScore !== null
          ? `${activeDiagnosticsQualityScore}/100 quality`
          : "Quality pending",
      publicFieldsLabel: "Profit, score, ROI, import/export, cycles",
    }),
    [active, activeStrategy, activeDiagnosticsQualityScore, effectiveAuthRegion, getRegionBucketMeta],
  );

  const activeCloudStrategyProfile = useMemo(
    () => savedStrategyProfiles.find((row) => row.is_active) || null,
    [savedStrategyProfiles],
  );

  const adminRuntimeHealth = useMemo(() => {
    const healthItems = [
      {
        label: "Supabase",
        ok: Boolean(supabaseProjectUrl),
        detail: supabaseProjectUrl ? "Auth + storage ready" : "Missing project URL",
      },
      {
        label: "Functions",
        ok: Boolean(apiBase),
        detail: apiBase ? "Proxy base detected" : "Missing functions URL",
      },
      {
        label: "Presence",
        ok: publicRegionActivity.length > 0,
        detail: publicRegionActivity.length ? "Regional feed active" : "No public presence yet",
      },
      {
        label: "Leaderboard",
        ok: communityLeaderboard.length > 0,
        detail: communityLeaderboard.length ? "Public ranks flowing" : "Awaiting public scores",
      },
    ];
    const healthyCount = healthItems.filter((item) => item.ok).length;
    const topRegion = [...publicRegionActivity].sort(
      (left, right) => Number(right.online_now || 0) - Number(left.online_now || 0),
    )[0];
    return {
      items: healthItems,
      score: Math.round((healthyCount / healthItems.length) * 100),
      onlineNow: communityOnlineNow,
      topRegion: topRegion ? getRegionBucketMeta(topRegion.region).short : "—",
      usersTracked: communityLeaderboard.length,
    };
  }, [
    apiBase,
    communityLeaderboard.length,
    communityOnlineNow,
    getRegionBucketMeta,
    publicRegionActivity,
    supabaseProjectUrl,
  ]);

  return {
    strategyPublishPreview,
    activeCloudStrategyProfile,
    adminRuntimeHealth,
  };
}
