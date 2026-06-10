import { useAuthRoutingState } from "./useAuthRoutingState";
import {
  useConfigWorkspaceShellProps,
  useWelcomeLeaderboardShellProps,
} from "./useWorkspaceShellProps";

type AppTab =
  | "home"
  | "backtest"
  | "monitor"
  | "config"
  | "welcome"
  | "leaderboard";

type Props = {
  authSession: { user?: { email?: string } } | null;
  setActiveTab: (tab: AppTab) => void;
  setAuthStatus: (value: string) => void;
  configShellInput: Parameters<typeof useConfigWorkspaceShellProps>[0];
  welcomeShellInput: Omit<
    Parameters<typeof useWelcomeLeaderboardShellProps>[0],
    "openWorkspaceTab"
  >;
};

export function useReleaseShellState({
  authSession,
  setActiveTab,
  setAuthStatus,
  configShellInput,
  welcomeShellInput,
}: Props) {
  const { routeState, openWorkspaceTab } = useAuthRoutingState({
    authSession,
    setActiveTab,
    setAuthStatus,
  });

  const { accountPanelProps, onboardingWizardProps, bridgeShellProps, llmRuntimeProps } =
    useConfigWorkspaceShellProps(configShellInput);

  const welcomeShellProps = useWelcomeLeaderboardShellProps({
    ...welcomeShellInput,
    openWorkspaceTab,
  });

  return {
    routeState,
    openWorkspaceTab,
    accountPanelProps,
    onboardingWizardProps,
    bridgeShellProps,
    llmRuntimeProps,
    welcomeShellProps,
  };
}
