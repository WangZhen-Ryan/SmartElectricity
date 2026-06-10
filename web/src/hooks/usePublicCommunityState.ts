import { useEffect, useMemo, useState } from "react";
import {
  buildCommunityLeaderboard,
  buildCommunityRegionRanks,
  computeCommunityOnlineNow,
  computeTopRegion,
  filterCommunityLeaderboard,
  filterPublicRegionActivity,
  type PublicLeaderboardEntry,
  type PublicRegionActivityEntry,
} from "../core/community";
import {
  getPresenceClientId,
  supabaseFetchLeaderboardEntries,
  supabaseFetchRegionActivity,
  supabaseUpsertPresenceSession,
  type SupabaseSessionState,
} from "../core/supabase_client";

type Props = {
  supabaseProjectUrl: string | null;
  anonKey: string | undefined;
  authSession: SupabaseSessionState | null;
  effectiveAuthRegion: string;
  activeTab: "home" | "welcome" | "leaderboard" | "backtest" | "monitor" | "config";
  activeStrategyName: string;
  homeWindowHours: number;
};

export function usePublicCommunityState({
  supabaseProjectUrl,
  anonKey,
  authSession,
  effectiveAuthRegion,
  activeTab,
  activeStrategyName,
  homeWindowHours,
}: Props) {
  const [communityStatus, setCommunityStatus] = useState("Community feed idle.");
  const [publicRegionActivity, setPublicRegionActivity] = useState<PublicRegionActivityEntry[]>([]);
  const [publicLeaderboard, setPublicLeaderboard] = useState<PublicLeaderboardEntry[]>([]);
  const [leaderboardRegionFilter, setLeaderboardRegionFilter] = useState("ALL");
  const [leaderboardBucketFilter, setLeaderboardBucketFilter] = useState("ALL");
  const [welcomeMapHoverRegion, setWelcomeMapHoverRegion] = useState<string | null>(null);
  const [welcomeMapSelectedRegion, setWelcomeMapSelectedRegion] = useState<string | null>(null);

  const communityLeaderboard = useMemo(
    () => buildCommunityLeaderboard(publicLeaderboard),
    [publicLeaderboard],
  );
  const communityRegionRanksByEntryId = useMemo(
    () => buildCommunityRegionRanks(communityLeaderboard),
    [communityLeaderboard],
  );
  const communityOnlineNow = useMemo(
    () => computeCommunityOnlineNow(publicRegionActivity),
    [publicRegionActivity],
  );
  const communityTopRegion = useMemo(
    () => computeTopRegion(publicRegionActivity),
    [publicRegionActivity],
  );
  const communityMyEntry = useMemo(
    () =>
      authSession
        ? communityLeaderboard.find((entry) => entry.user_id === authSession.user.id) || null
        : null,
    [communityLeaderboard, authSession],
  );
  const filteredPublicRegionActivity = useMemo(
    () =>
      filterPublicRegionActivity(
        publicRegionActivity,
        leaderboardRegionFilter,
        leaderboardBucketFilter,
      ),
    [publicRegionActivity, leaderboardRegionFilter, leaderboardBucketFilter],
  );
  const filteredCommunityLeaderboard = useMemo(
    () =>
      filterCommunityLeaderboard(
        communityLeaderboard,
        leaderboardRegionFilter,
        leaderboardBucketFilter,
      ),
    [communityLeaderboard, leaderboardRegionFilter, leaderboardBucketFilter],
  );
  const filteredCommunityTopRegion = useMemo(
    () => computeTopRegion(filteredPublicRegionActivity),
    [filteredPublicRegionActivity],
  );
  const filteredCommunityOnlineNow = useMemo(
    () => computeCommunityOnlineNow(filteredPublicRegionActivity),
    [filteredPublicRegionActivity],
  );
  const filteredCommunityMyEntry = useMemo(
    () =>
      authSession
        ? filteredCommunityLeaderboard.find((entry) => entry.user_id === authSession.user.id) || null
        : null,
    [filteredCommunityLeaderboard, authSession],
  );

  useEffect(() => {
    if (!supabaseProjectUrl || !anonKey) return;
    let cancelled = false;
    const loadCommunity = async () => {
      try {
        const [regions, scores] = await Promise.all([
          supabaseFetchRegionActivity(supabaseProjectUrl, anonKey),
          supabaseFetchLeaderboardEntries(supabaseProjectUrl, anonKey, "daily"),
        ]);
        if (cancelled) return;
        setPublicRegionActivity(regions);
        setPublicLeaderboard(scores);
        setCommunityStatus(
          `Live community feed: ${regions.reduce(
            (sum, region) => sum + Math.max(0, Number(region.online_now || 0)),
            0,
          )} online.`,
        );
      } catch (err) {
        if (cancelled) return;
        setCommunityStatus(
          err instanceof Error ? `Community feed unavailable: ${err.message}` : "Community feed unavailable.",
        );
      }
    };
    loadCommunity().catch(() => null);
    const timer = window.setInterval(() => {
      loadCommunity().catch(() => null);
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [supabaseProjectUrl, anonKey]);

  useEffect(() => {
    if (!authSession || !supabaseProjectUrl || !anonKey) return;
    const clientId = getPresenceClientId();
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await supabaseUpsertPresenceSession(
          supabaseProjectUrl,
          anonKey,
          authSession.accessToken,
          {
            user_id: authSession.user.id,
            region: effectiveAuthRegion,
            page: activeTab,
            is_online: true,
            client_id: clientId,
            meta: {
              strategy: activeStrategyName,
              windowHours: homeWindowHours,
            },
            last_seen_at: new Date().toISOString(),
          },
        );
      } catch {
        // keep UX silent; community card will fall back to last read
      }
    };
    heartbeat().catch(() => null);
    const timer = window.setInterval(() => {
      if (cancelled) return;
      heartbeat().catch(() => null);
    }, 45000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authSession,
    supabaseProjectUrl,
    anonKey,
    effectiveAuthRegion,
    activeTab,
    activeStrategyName,
    homeWindowHours,
  ]);

  const openLeaderboardForRegion = (shortCode: string, openTab: () => void) => {
    setLeaderboardRegionFilter(`AU-${shortCode}`);
    setLeaderboardBucketFilter("ALL");
    setWelcomeMapHoverRegion(null);
    setWelcomeMapSelectedRegion(null);
    openTab();
  };

  return {
    communityStatus,
    publicRegionActivity,
    publicLeaderboard,
    leaderboardRegionFilter,
    setLeaderboardRegionFilter,
    leaderboardBucketFilter,
    setLeaderboardBucketFilter,
    welcomeMapHoverRegion,
    setWelcomeMapHoverRegion,
    welcomeMapSelectedRegion,
    setWelcomeMapSelectedRegion,
    communityLeaderboard,
    communityRegionRanksByEntryId,
    communityOnlineNow,
    communityTopRegion,
    communityMyEntry,
    filteredPublicRegionActivity,
    filteredCommunityLeaderboard,
    filteredCommunityTopRegion,
    filteredCommunityOnlineNow,
    filteredCommunityMyEntry,
    openLeaderboardForRegion,
  };
}
