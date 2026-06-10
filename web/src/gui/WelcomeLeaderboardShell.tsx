import { Suspense } from "react";
import type { ComponentProps, ComponentType } from "react";
import type {
  BatteryBrandCard,
  CommunityLeaderboardRow,
  PublicRegionActivityRow,
  RegionBucket,
  RegionInsight,
  RegionMapData,
  RegionMapShape,
  WelcomePreviewRow,
  WelcomeStats,
} from "./CommunityPanels";

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

type LazyPublicActivityShell = ComponentType<{
  activeCommunityTab: "welcome" | "leaderboard";
  authSession: { user?: { email?: string } } | null;
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
}>;

type Props = ComponentProps<LazyPublicActivityShell> & {
  LazyPublicActivityShell: LazyPublicActivityShell;
};

export default function WelcomeLeaderboardShell({
  LazyPublicActivityShell,
  ...props
}: Props) {
  return (
    <Suspense fallback={<SectionFallback label="Loading community workspace..." />}>
      <LazyPublicActivityShell {...props} />
    </Suspense>
  );
}
