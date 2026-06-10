export type RecoveryHashError = {
  code: string;
  description: string;
} | null;

export type AppRouteState = {
  currentPath: string;
  isResetPasswordRoute: boolean;
  isAdminRoute: boolean;
  isOpsRoute: boolean;
  recoveryAccessToken: string | null;
  recoveryHashError: RecoveryHashError;
};

export function parseAppRouteState(locationLike?: Pick<Location, "pathname" | "hash" | "search">): AppRouteState {
  const currentPath = locationLike?.pathname || "/";
  const recoveryHash = locationLike
    ? new URLSearchParams(locationLike.hash.replace(/^#/, ""))
    : null;
  const recoveryHashType = (recoveryHash?.get("type") || "").toLowerCase();
  const hasRecoveryHashToken = Boolean(recoveryHash?.get("access_token"));
  const isResetPasswordRoute =
    /^\/auth\/reset-password\/?$/.test(currentPath) ||
    (hasRecoveryHashToken &&
      (recoveryHashType === "recovery" || recoveryHashType === "magiclink" || !recoveryHashType));
  const recoveryAccessToken = (() => {
    const hashToken = recoveryHash?.get("access_token");
    if (
      hashToken &&
      (recoveryHashType === "recovery" || recoveryHashType === "magiclink" || !recoveryHashType)
    ) {
      return hashToken;
    }
    const search = new URLSearchParams(locationLike?.search || "");
    return search.get("access_token");
  })();
  const recoveryHashError = (() => {
    if (!recoveryHash) return null;
    const code = recoveryHash.get("error_code") || recoveryHash.get("error");
    const description = recoveryHash.get("error_description");
    if (!code && !description) return null;
    return {
      code: code || "recovery_error",
      description: description || "Recovery link is invalid or expired.",
    };
  })();

  return {
    currentPath,
    isResetPasswordRoute,
    isAdminRoute: /^\/admin(\/|$)/.test(currentPath),
    isOpsRoute: /^\/ops(\/|$)/.test(currentPath),
    recoveryAccessToken,
    recoveryHashError,
  };
}
