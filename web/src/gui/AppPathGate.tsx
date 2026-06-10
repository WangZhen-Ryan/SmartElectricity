import { Suspense } from "react";
import type { ComponentType } from "react";
import type { AppRouteState, RecoveryHashError } from "../core/routeState";

type RuntimeHealthItem = {
  label: string;
  ok: boolean;
  detail: string;
};

type RuntimeHealth = {
  items: RuntimeHealthItem[];
  score: number;
  onlineNow: number;
  topRegion: string;
  usersTracked: number;
};

type TopRegion = {
  region: string;
  online_now: number | null;
} | null;

type LazyAuthRecoveryView = ComponentType<{
  recoveryAccessToken: string | null;
  recoveryHashError: RecoveryHashError;
  resetPasswordValue: string;
  resetPasswordConfirm: string;
  resetStatus: string;
  resetError: string | null;
  resetLoading: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onSubmit: (token: string) => void;
  onBackToApp: () => void;
}>;

type LazyAdminConsoleView = ComponentType<{
  currentPath: string;
  runtimeHealth: RuntimeHealth;
  publicRegionCount: number;
  communityStatus: string;
  communityLeaderboardCount: number;
  onOpenPublicApp: () => void;
  onOpenOps: () => void;
}>;

type LazyOpsRuntimeView = ComponentType<{
  currentPath: string;
  runtimeHealth: RuntimeHealth;
  communityOnlineNow: number;
  communityLeaderboardCount: number;
  publicRegionCount: number;
  communityTopRegion: TopRegion;
  topRegionShort: string;
  onOpenPublicApp: () => void;
  onOpenAdmin: () => void;
}>;

type Props = {
  routeState: AppRouteState;
  runtimeHealth: RuntimeHealth;
  publicRegionCount: number;
  communityStatus: string;
  communityLeaderboardCount: number;
  communityOnlineNow: number;
  communityTopRegion: TopRegion;
  topRegionShort: string;
  resetPasswordValue: string;
  resetPasswordConfirm: string;
  resetStatus: string;
  resetError: string | null;
  resetLoading: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onSubmitPasswordReset: (token: string) => void;
  LazyAuthRecoveryView: LazyAuthRecoveryView;
  LazyAdminConsoleView: LazyAdminConsoleView;
  LazyOpsRuntimeView: LazyOpsRuntimeView;
};

function RouteFallback({ label }: { label: string }) {
  return (
    <div className="page">
      <section className="panel lazy-panel-fallback">
        <div className="loading-shell">
          <span className="spinner" />
          <div className="motion-skeleton-copy">
            <span>{label}</span>
            <span className="motion-skeleton-line" />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function AppPathGate({
  routeState,
  runtimeHealth,
  publicRegionCount,
  communityStatus,
  communityLeaderboardCount,
  communityOnlineNow,
  communityTopRegion,
  topRegionShort,
  resetPasswordValue,
  resetPasswordConfirm,
  resetStatus,
  resetError,
  resetLoading,
  onPasswordChange,
  onConfirmChange,
  onSubmitPasswordReset,
  LazyAuthRecoveryView,
  LazyAdminConsoleView,
  LazyOpsRuntimeView,
}: Props) {
  if (routeState.isResetPasswordRoute) {
    return (
      <Suspense fallback={<RouteFallback label="Loading password recovery..." />}>
        <LazyAuthRecoveryView
          recoveryAccessToken={routeState.recoveryAccessToken}
          recoveryHashError={routeState.recoveryHashError}
          resetPasswordValue={resetPasswordValue}
          resetPasswordConfirm={resetPasswordConfirm}
          resetStatus={resetStatus}
          resetError={resetError}
          resetLoading={resetLoading}
          onPasswordChange={onPasswordChange}
          onConfirmChange={onConfirmChange}
          onSubmit={onSubmitPasswordReset}
          onBackToApp={() => {
            if (typeof window !== "undefined") window.location.href = "/";
          }}
        />
      </Suspense>
    );
  }

  if (routeState.isAdminRoute) {
    return (
      <Suspense fallback={<RouteFallback label="Loading admin console..." />}>
        <LazyAdminConsoleView
          currentPath={routeState.currentPath}
          runtimeHealth={runtimeHealth}
          publicRegionCount={publicRegionCount}
          communityStatus={communityStatus}
          communityLeaderboardCount={communityLeaderboardCount}
          onOpenPublicApp={() => window.location.assign("/")}
          onOpenOps={() => window.location.assign("/ops")}
        />
      </Suspense>
    );
  }

  if (routeState.isOpsRoute) {
    return (
      <Suspense fallback={<RouteFallback label="Loading ops runtime..." />}>
        <LazyOpsRuntimeView
          currentPath={routeState.currentPath}
          runtimeHealth={runtimeHealth}
          communityOnlineNow={communityOnlineNow}
          communityLeaderboardCount={communityLeaderboardCount}
          publicRegionCount={publicRegionCount}
          communityTopRegion={communityTopRegion}
          topRegionShort={topRegionShort}
          onOpenPublicApp={() => window.location.assign("/")}
          onOpenAdmin={() => window.location.assign("/admin")}
        />
      </Suspense>
    );
  }

  return null;
}
