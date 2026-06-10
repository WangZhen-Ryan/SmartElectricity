# Release Checklist

This checklist is for the current SmartElectricity release target:

- Primary workspace: `Home / Backtest / Monitor / Config`
- Secondary public/community surfaces: `Welcome / Leaderboard`
- Local control launch scope: `home-assistant` + `generic-modbus` only
- Public/community surfaces must never expose local battery connection details or credentials

## 1. Auth and Account

- Sign up with email/password works.
- Sign in with email/password works.
- Sign out clears local session and private cloud state.
- Session restore works on refresh.
- Forgot password shows explicit "email sent" feedback.
- Reset password works from:
  - `/auth/reset-password?...`
  - root hash recovery link `/#access_token=...&type=recovery`
- Expired/invalid recovery link shows clear error state.
- Auth UI never reveals any saved credential fields.

## 2. Privacy Boundary

Reference:

- [docs/payload-audit.md](/Users/wz/SmartElectricity/docs/payload-audit.md)

Verify these fields never enter cloud config payloads or public leaderboard payloads:

- Amber token
- Sigen username
- Sigen password
- HA token
- Modbus host
- Modbus port
- Modbus unit/base address
- bridge URL
- vendor credentials
- any `token/password/secret/api-key/credential`-like field

Confirm these rules:

- Public/community UI does not render hostnames, bridge URLs, usernames, passwords, or tokens.
- `Config` may show battery source type and health only.
- Cloud config stores non-secret setup only.
- Leaderboard publish sends metrics only.

## 3. Cloud Config

- Unauthenticated user cannot save cloud config.
- Unauthenticated user cannot load cloud config.
- Authenticated user can save non-secret config successfully.
- Authenticated user can load their own saved config successfully.
- Loading cloud config restores the correct session-facing settings.
- Another user cannot read or apply someone else’s cloud config.

## 4. Strategy Studio

- Save local profile works without auth.
- Save cloud profile works with auth.
- Cloud profile list refreshes after save.
- Load selected profile rehydrates:
  - strategy studio controls
  - active strategy
  - applicable backtest config snapshot
- Set Active marks the chosen cloud profile active and clears the previous active profile.
- Generate From Current Result produces a usable strategy profile name/summary.
- Publish Active Result works only when authenticated.
- Publish confirmation clearly communicates:
  - strategy/profile name
  - region
  - public metrics only

## 5. Home / Monitor / Battery Fallback

- `Home` renders correctly with no live battery source.
- `Monitor` renders recommendation/rationale even when battery source is unavailable.
- `batteryTelemetry` drives UI state for Home/Monitor/Config.
- Simulated/fallback battery state is explicitly labeled.
- Raw battery payload remains debug-only.
- Local Modbus unavailable path does not crash.
- Sigen unavailable path does not crash.

## 6. Local Bridge + Control Scope

- `Config` exposes only these local control providers:
  - `Home Assistant`
  - `Generic Modbus`
- `vendor-cloud` remains monitor-only for launch.
- `http://YOUR-BRIDGE:8787/status` opens successfully.
- `Validate Bridge Config` returns actionable errors/warnings.
- `GET /api/device/command/health` clearly distinguishes:
  - `healthy`
  - `degraded`
  - `offline`
  - `read-only-bundled-proxy`
- `Send Command` stays disabled unless:
  - control enabled
  - instant override enabled
  - provider is supported
  - bridge path is local
  - bridge health is command-capable
  - battery telemetry is live and not simulated
- Bundled dev proxy remains read-only and must not be treated as a production control path.

## 7. Welcome / Leaderboard

- `Welcome` remains secondary and does not hijack the main working flow.
- Desktop:
  - hover shows region tooltip
  - click opens filtered `Leaderboard`
- Mobile:
  - tap selects region
  - selected region card appears
  - CTA opens filtered `Leaderboard`
  - Clear button resets selection
- `Welcome` preview rows match the `Leaderboard` public schema:
  - rank
  - display label
  - region
  - profit
  - public capability/score
- `Leaderboard` filters work:
  - region filter
  - bucket filter
  - clear filters
- Public boundary message is visible in both `Welcome` and `Leaderboard`.

## 8. Mobile QA

Verify on a phone-sized viewport:

- `Welcome`
  - Australia map remains usable
  - selected region card is readable
  - CTA buttons stack properly
- `Leaderboard`
  - filter bar wraps cleanly
  - bucket chips remain tappable
  - public policy block is readable
- `Config`
  - auth toggle is usable
  - form fields are readable and tappable
  - save/load buttons stack and remain visible
- `Home`
  - decision console and charts do not overlap badly
- `Monitor`
  - battery status cards and source state remain readable

## 9. Build and Performance

- `npm run build` passes.
- Chunk split remains healthy:
  - `react-vendor`
  - `charts-and-rl`
  - `community`
  - `auth-admin`
- Main bundle does not regress back to pre-splitting size.
- Lazy-loaded surfaces show local fallback and then hydrate cleanly.
- Deployment must use build artifacts / CI output, not mixed stale `web/dist` files.

## 10. Release Smoke Test

Before release:

1. Sign in with a real account.
2. Save cloud config.
3. Load cloud config.
4. Save a Strategy Studio profile.
5. Set it active.
6. Publish one result to leaderboard.
7. Open `Welcome`, click a region, verify filtered `Leaderboard`.
8. Open bridge `/status` and confirm config + command health messages match Config UI.
9. Run `npm run build`.
10. Confirm no private connection data appears in public UI or network payloads.
