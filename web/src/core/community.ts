export type RegionBucketMeta = {
  code: string;
  short: string;
  label: string;
  market: string;
  postcodeRange: string;
  tone: string;
  fallbackPulse: string;
  fallbackRatio: number;
};

export type HomeRegionActivity = {
  code: string;
  label: string;
  market: string;
  postcodeRange: string;
  tone: string;
  pulse: string;
  users: number;
};

export type PublicLeaderboardEntry = {
  id: string;
  user_id: string;
  region: string;
  score: number;
  profit_aud: number;
  details?: Record<string, unknown>;
};

export type CommunityLeaderboardEntry = PublicLeaderboardEntry & {
  rank: number;
  label: string;
  strategy: string;
  capabilityScore: number;
  marketAlpha: number;
  stability: number;
  execution: number;
};

export type PublicRegionActivityEntry = {
  region: string;
  online_now: number | null;
  latest_seen_at: string | null;
};

export function buildHomeRegionActivity(
  publicRegionActivity: PublicRegionActivityEntry[],
  activeUsersNow: number,
  regionBuckets: readonly RegionBucketMeta[],
): HomeRegionActivity[] {
  const liveByRegion = new Map(
    publicRegionActivity.map((region) => [region.region, Math.max(0, Number(region.online_now || 0))]),
  );
  return regionBuckets.map((bucket) => {
    const liveUsers = liveByRegion.get(bucket.code);
    const users =
      liveUsers !== undefined ? liveUsers : Math.max(1, Math.round(activeUsersNow * bucket.fallbackRatio));
    const pulse = users > 10 ? "Most active" : users > 4 ? "Live" : bucket.fallbackPulse;
    return {
      code: bucket.short,
      label: bucket.label,
      market: bucket.market,
      postcodeRange: bucket.postcodeRange,
      tone: bucket.tone,
      pulse,
      users,
    };
  });
}

export function buildWelcomeRegionInsights(
  homeRegionActivity: HomeRegionActivity[],
  publicLeaderboard: PublicLeaderboardEntry[],
) {
  const byCode = new Map<
    string,
    {
      code: string;
      label: string;
      market: string;
      postcodeRange: string;
      users: number;
      pulse: string;
      traders: number;
      totalProfitAud: number;
      avgProfitAud: number | null;
    }
  >();
  homeRegionActivity.forEach((region) => {
    const bucketCode = `AU-${region.code}`;
    const entries = publicLeaderboard.filter((entry) => entry.region === bucketCode);
    const totalProfitAud = entries.reduce((sum, entry) => sum + Number(entry.profit_aud || 0), 0);
    const traders = entries.length;
    byCode.set(region.code, {
      code: region.code,
      label: region.label,
      market: region.market,
      postcodeRange: region.postcodeRange,
      users: region.users,
      pulse: region.pulse,
      traders,
      totalProfitAud,
      avgProfitAud: traders ? totalProfitAud / traders : null,
    });
  });
  return byCode;
}

export function buildCommunityLeaderboard(
  publicLeaderboard: PublicLeaderboardEntry[],
): CommunityLeaderboardEntry[] {
  return publicLeaderboard.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    label: `Trader-${entry.user_id.slice(0, 6)}`,
    strategy:
      entry.details && typeof entry.details.strategy === "string"
        ? String(entry.details.strategy)
        : "Private setup",
    capabilityScore:
      entry.details && typeof entry.details.capabilityScore === "number"
        ? Number(entry.details.capabilityScore)
        : Number(entry.score || 0),
    marketAlpha:
      entry.details && typeof entry.details.marketAlpha === "number"
        ? Number(entry.details.marketAlpha)
        : Number(entry.score || 0),
    stability:
      entry.details && typeof entry.details.stability === "number"
        ? Number(entry.details.stability)
        : 0,
    execution:
      entry.details && typeof entry.details.execution === "number"
        ? Number(entry.details.execution)
        : 0,
  }));
}

export function buildCommunityRegionRanks(communityLeaderboard: CommunityLeaderboardEntry[]) {
  const ranks = new Map<string, number>();
  const grouped = new Map<string, CommunityLeaderboardEntry[]>();
  communityLeaderboard.forEach((entry) => {
    const bucket = grouped.get(entry.region);
    if (bucket) {
      bucket.push(entry);
    } else {
      grouped.set(entry.region, [entry]);
    }
  });
  grouped.forEach((entries) => {
    entries
      .slice()
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .forEach((entry, idx) => {
        ranks.set(entry.id, idx + 1);
      });
  });
  return ranks;
}

export function computeCommunityOnlineNow(publicRegionActivity: PublicRegionActivityEntry[]) {
  return publicRegionActivity.reduce(
    (sum, region) => sum + Math.max(0, Number(region.online_now || 0)),
    0,
  );
}

export function computeTopRegion(publicRegionActivity: PublicRegionActivityEntry[]) {
  return (
    [...publicRegionActivity].sort(
      (left, right) => Number(right.online_now || 0) - Number(left.online_now || 0),
    )[0] || null
  );
}

export function filterPublicRegionActivity(
  publicRegionActivity: PublicRegionActivityEntry[],
  regionFilter: string,
  bucketFilter: string,
) {
  return publicRegionActivity.filter(
    (region) =>
      (regionFilter === "ALL" || region.region === regionFilter) &&
      (bucketFilter === "ALL" || region.region === bucketFilter),
  );
}

export function filterCommunityLeaderboard(
  communityLeaderboard: CommunityLeaderboardEntry[],
  regionFilter: string,
  bucketFilter: string,
) {
  return communityLeaderboard.filter(
    (entry) =>
      (regionFilter === "ALL" || entry.region === regionFilter) &&
      (bucketFilter === "ALL" || entry.region === bucketFilter),
  );
}
