import { useCallback, useMemo } from "react";
import { parseAppRouteState } from "../core/routeState";

type AppTab =
  | "home"
  | "welcome"
  | "leaderboard"
  | "backtest"
  | "monitor"
  | "config";

type Props = {
  authSession: { user?: { email?: string } } | null;
  setActiveTab: (tab: AppTab) => void;
  setAuthStatus: (value: string) => void;
};

export function useAuthRoutingState({
  authSession,
  setActiveTab,
  setAuthStatus,
}: Props) {
  const routeState = useMemo(
    () =>
      parseAppRouteState(
        typeof window !== "undefined"
          ? {
              pathname: window.location.pathname,
              hash: window.location.hash,
              search: window.location.search,
            }
          : undefined,
      ),
    [],
  );

  const openWorkspaceTab = useCallback(
    (tab: AppTab) => {
      setActiveTab(tab);
      if (!authSession && (tab === "backtest" || tab === "monitor" || tab === "config")) {
        setAuthStatus(
          "Local session mode active. Sign in only if you want cloud sync and leaderboard publishing.",
        );
      }
    },
    [authSession, setActiveTab, setAuthStatus],
  );

  return {
    routeState,
    openWorkspaceTab,
  };
}
