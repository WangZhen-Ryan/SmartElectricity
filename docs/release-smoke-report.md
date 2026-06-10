# Release Smoke Report

Date: 2026-03-19  
Workspace: `/Users/wz/SmartElectricity`

This report records the automated checks completed during the latest release hardening pass. It is not a replacement for manual device QA.

## Automated checks completed

### 1. Production build

Command:

```bash
cd /Users/wz/SmartElectricity/web
npm run build
```

Result: passed

Current build output summary:

- `dist/assets/index-DpD617T8.js` `379.51 kB` raw / `95.01 kB` gzip
- `dist/assets/index-BigiuVUv.css` `94.09 kB` raw / `16.64 kB` gzip
- `react-vendor-D7f9BLy3.js` `141.83 kB`
- `charts-and-rl-qSqil1iZ.js` `62.70 kB`
- `community-hdjqgzBh.js` `16.71 kB`
- `auth-admin-yfUOw-60.js` `16.47 kB`
- `OnboardingWizard-CU3NRcY0.js` `8.59 kB`

Conclusion:

- code-splitting is still active
- main bundle has not regressed to the older pre-splitting size
- exact hashed filenames may change between builds; release validation should compare bundle class and size, not the previous hash only
- `web/dist` is now intended as a build artifact, not a repo-tracked release source

### 2. Privacy enforcement entrypoints

Command:

```bash
rg -n "prepareCloudConfigPayload|preparePublicLeaderboardPayload" web/src/App.tsx web/src/hooks/useAuthWorkspaceState.ts web/src/core/privacy.ts
```

Result:

- cloud config save path goes through `prepareCloudConfigPayload(...)`
- leaderboard publish path goes through `preparePublicLeaderboardPayload(...)`
- direct zero-sanitization publish/save paths were not found in the main release flow

Conclusion:

- cloud payloads and public payloads are both routed through the shared privacy enforcement layer in `web/src/core/privacy.ts`
- cloud/public payload preparation is centralized and no longer relies on scattered inline sanitization

### 3. Public/community surface audit

Command:

```bash
rg -n "host|bridgeUrl|password|token|username|unitId|baseAddr|apiKey|secret|credential" \
  web/src/gui/CommunityPanels.tsx \
  web/src/gui/WelcomeLeaderboardShell.tsx \
  web/src/gui/PublicActivityShell.tsx \
  web/src/gui/ConfigWorkspaceShell.tsx \
  web/src/hooks/useWorkspaceShellProps.ts \
  web/src/hooks/usePublicCommunityState.ts
```

Result summary:

- no local battery connection fields were found in:
  - `CommunityPanels.tsx`
  - `WelcomeLeaderboardShell.tsx`
  - `PublicActivityShell.tsx`
  - `usePublicCommunityState.ts`
- `ConfigWorkspaceShell.tsx` and `useWorkspaceShellProps.ts` do contain `token` / `host` references, but those belong to the private Config workspace and onboarding runtime status, not the public/community surface

Conclusion:

- public/community panels are not currently wired to render local hostnames, bridge URLs, usernames, passwords, or tokens
- private Config shell still contains runtime/setup references, which is expected

### 4. Local bridge launch contract

Code-side checks completed:

- bridge exposes:
  - `/status`
  - `/api/config/validate`
  - `/api/battery/telemetry`
  - `/api/device/command/health`
  - `/api/device/command`
- Home Assistant adapter supports:
  - real entity reads through `/api/states/:entity_id`
  - legacy action maps
  - template-based `commandMap.templates`
- Generic Modbus adapter supports:
  - register-map telemetry
  - command register writes
- website `Config` now exposes:
  - `Validate Bridge Config`
  - `Open Bridge Status`

Conclusion:

- launch scope is explicit: local control is supported only through `home-assistant` and `generic-modbus`
- bundled `web/server` remains read-only and must not be treated as a production control bridge

## Manual checks still required

The following still require human validation before release:

- real sign-up / sign-in / sign-out flow
- forgot password email flow
- root-hash recovery flow: `/#access_token=...&type=recovery`
- `/auth/reset-password?...` route flow
- cloud config save/load with a real authenticated user
- strategy profile save/load/activate/publish with a real authenticated user
- Welcome mobile tap interactions on an actual phone
- Leaderboard filter behavior on an actual phone
- Config auth card usability on an actual phone
- bridge `/status` page and `Validate Bridge Config` flow against a real local bridge
- local command health and command send behavior against a real HA / Generic Modbus bridge
- browser network inspection during:
  - cloud config save
  - leaderboard publish

## Release recommendation

Current state is suitable for:

- private beta
- early controlled public shell

Current state still benefits from one final manual pass before broader public release:

- mobile QA on a real device
- auth flow validation with live Supabase emails
- network payload spot check in browser devtools

See also:

- [docs/release-checklist.md](/Users/wz/SmartElectricity/docs/release-checklist.md)
- [docs/payload-audit.md](/Users/wz/SmartElectricity/docs/payload-audit.md)
