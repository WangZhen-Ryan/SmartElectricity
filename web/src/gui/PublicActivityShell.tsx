import {
  RegionalLeaderboardPanel,
  WelcomeLandingPanel,
  type BatteryBrandCard,
  type CommunityLeaderboardRow,
  type PublicRegionActivityRow,
  type RegionBucket,
  type RegionInsight,
  type RegionMapData,
  type RegionMapShape,
  type WelcomePreviewRow,
  type WelcomeStats,
} from "./CommunityPanels";

type AuthSession = { user?: { email?: string } } | null;

type Props = {
  activeCommunityTab: "welcome" | "leaderboard";
  authSession: AuthSession;
  homeWelcomeStats: WelcomeStats;
  supportedBatteryBrands: BatteryBrandCard[];
  shapes: RegionMapShape[];
  welcomeRegionMapByCode: Map<string, RegionMapData>;
  welcomeRegionInsightsByCode: Map<string, RegionInsight>;
  welcomeMapHoverRegion: string | null;
  welcomeMapSelectedRegion: string | null;
  welcomeLeaderboardPreview: WelcomePreviewRow[];
  communityStatus: string;
  filteredCommunityOnlineNow: number;
  filteredCommunityTopRegion: { region: string; online_now: number | null } | null;
  filteredCommunityMyEntry: { rank: number; profit_aud: number } | null;
  leaderboardRegionFilter: string;
  leaderboardBucketFilter: string;
  filteredPublicRegionActivity: PublicRegionActivityRow[];
  filteredCommunityLeaderboard: CommunityLeaderboardRow[];
  communityRegionRanksByEntryId: Map<string, number>;
  regionBuckets: RegionBucket[];
  onHoverRegion: (value: string | null) => void;
  onSelectRegion: (value: string | null) => void;
  onOpenAccount: () => void;
  onOpenBacktest: () => void;
  onOpenMonitor: () => void;
  onOpenLeaderboardForRegion: (shortCode: string) => void;
  onLeaderboardRegionFilterChange: (value: string) => void;
  onLeaderboardBucketFilterChange: (value: string) => void;
  formatProfit: (value: number) => string;
  getRegionBucketMeta: (regionCode: string) => RegionBucket;
};

export default function PublicActivityShell({
  activeCommunityTab,
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
  onHoverRegion,
  onSelectRegion,
  onOpenAccount,
  onOpenBacktest,
  onOpenMonitor,
  onOpenLeaderboardForRegion,
  onLeaderboardRegionFilterChange,
  onLeaderboardBucketFilterChange,
  formatProfit,
  getRegionBucketMeta,
}: Props) {
  if (activeCommunityTab === "welcome") {
    return (
      <WelcomeLandingPanel
        authSession={authSession}
        homeWelcomeStats={homeWelcomeStats}
        supportedBatteryBrands={supportedBatteryBrands}
        shapes={shapes}
        welcomeRegionMapByCode={welcomeRegionMapByCode}
        welcomeRegionInsightsByCode={welcomeRegionInsightsByCode}
        welcomeMapHoverRegion={welcomeMapHoverRegion}
        welcomeMapSelectedRegion={welcomeMapSelectedRegion}
        welcomeLeaderboardPreview={welcomeLeaderboardPreview}
        onHoverRegion={onHoverRegion}
        onSelectRegion={onSelectRegion}
        onOpenAccount={onOpenAccount}
        onOpenBacktest={onOpenBacktest}
        onOpenMonitor={onOpenMonitor}
        onOpenLeaderboardForRegion={onOpenLeaderboardForRegion}
        formatProfit={formatProfit}
        getRegionBucketMeta={getRegionBucketMeta}
      />
    );
  }

  return (
    <RegionalLeaderboardPanel
      authSession={authSession}
      communityStatus={communityStatus}
      filteredCommunityOnlineNow={filteredCommunityOnlineNow}
      filteredCommunityTopRegion={filteredCommunityTopRegion}
      filteredCommunityMyEntry={filteredCommunityMyEntry}
      leaderboardRegionFilter={leaderboardRegionFilter}
      leaderboardBucketFilter={leaderboardBucketFilter}
      filteredPublicRegionActivity={filteredPublicRegionActivity}
      filteredCommunityLeaderboard={filteredCommunityLeaderboard}
      communityRegionRanksByEntryId={communityRegionRanksByEntryId}
      regionBuckets={regionBuckets}
      onLeaderboardRegionFilterChange={onLeaderboardRegionFilterChange}
      onLeaderboardBucketFilterChange={onLeaderboardBucketFilterChange}
      formatProfit={formatProfit}
      getRegionBucketMeta={getRegionBucketMeta}
    />
  );
}
