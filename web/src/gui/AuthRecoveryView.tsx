type RecoveryHashError = {
  code: string;
  description: string;
} | null;

type Props = {
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
};

export default function AuthRecoveryView({
  recoveryAccessToken,
  recoveryHashError,
  resetPasswordValue,
  resetPasswordConfirm,
  resetStatus,
  resetError,
  resetLoading,
  onPasswordChange,
  onConfirmChange,
  onSubmit,
  onBackToApp,
}: Props) {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-header">
          <h2>Reset Password</h2>
          <p className="hint">Set a new password for your GridPulse account.</p>
        </div>
        {recoveryAccessToken ? (
          <div className="grid">
            <div className="panel">
              <div className="field">
                <label>New Password</label>
                <input
                  type="password"
                  value={resetPasswordValue}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="field">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={resetPasswordConfirm}
                  onChange={(event) => onConfirmChange(event.target.value)}
                  placeholder="Repeat new password"
                />
              </div>
              <div className="hero-actions">
                <button
                  className="primary"
                  disabled={resetLoading}
                  onClick={() => onSubmit(recoveryAccessToken)}
                >
                  {resetLoading ? "Updating..." : "Update Password"}
                </button>
                <button className="ghost" onClick={onBackToApp}>
                  Back To App
                </button>
              </div>
              <div className="hint">{resetStatus}</div>
              {resetError ? <div className="error">{resetError}</div> : null}
            </div>
          </div>
        ) : (
          <div className="empty">
            {recoveryHashError ? (
              <>
                {`Recovery link failed (${recoveryHashError.code}). `}
                {recoveryHashError.description}. Request a new reset email and use the latest link.
              </>
            ) : (
              "Missing or expired recovery token. Open the latest reset email link again."
            )}
          </div>
        )}
      </section>
    </div>
  );
}
