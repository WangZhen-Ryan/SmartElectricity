# Payload Audit Note

Date: 2026-03-15  
Workspace: `/Users/wz/SmartElectricity`

This note summarizes the release-side payload protection boundaries that are enforced in code.

## Protected entrypoints

The following functions are the only approved entrypoints for cloud/public payload preparation:

- `prepareCloudConfigPayload(...)`
- `preparePublicLeaderboardPayload(...)`

Source of truth:

- [web/src/core/privacy.ts](/Users/wz/SmartElectricity/web/src/core/privacy.ts)

These helpers perform both:

1. sanitization
2. assertion

That means payloads are first stripped of disallowed fields and then rejected if any sensitive key still remains.

## Cloud config paths protected

Cloud config payloads are prepared through the shared privacy pipeline before save:

- private workspace config save
- Strategy Studio cloud profile save
- Strategy Studio active profile update

Relevant code paths:

- [web/src/App.tsx](/Users/wz/SmartElectricity/web/src/App.tsx)
- [web/src/hooks/useAuthWorkspaceState.ts](/Users/wz/SmartElectricity/web/src/hooks/useAuthWorkspaceState.ts)

## Public leaderboard paths protected

Public leaderboard publish payloads are prepared through the shared privacy pipeline before publish:

- explicit result publish from Strategy Studio / private workspace flow

Relevant code paths:

- [web/src/hooks/useAuthWorkspaceState.ts](/Users/wz/SmartElectricity/web/src/hooks/useAuthWorkspaceState.ts)

## Fields blocked from cloud/public payloads

The denylist and pattern-based blocking currently exclude:

- Amber token
- Sigen username
- Sigen password
- Home Assistant token
- Modbus host
- Modbus port
- Modbus unit ID
- Modbus base address
- bridge URL
- command register details
- vendor credentials
- any key matching token/password/secret/api-key/credential-like patterns

## Public/community component scan

The following public/community surfaces were checked to ensure they do not receive local connection details:

- [web/src/gui/CommunityPanels.tsx](/Users/wz/SmartElectricity/web/src/gui/CommunityPanels.tsx)
- [web/src/gui/WelcomeLeaderboardShell.tsx](/Users/wz/SmartElectricity/web/src/gui/WelcomeLeaderboardShell.tsx)
- [web/src/gui/PublicActivityShell.tsx](/Users/wz/SmartElectricity/web/src/gui/PublicActivityShell.tsx)
- [web/src/hooks/usePublicCommunityState.ts](/Users/wz/SmartElectricity/web/src/hooks/usePublicCommunityState.ts)

These public surfaces are expected to carry only:

- region
- rank
- label/display name
- public profit
- public capability/score
- aggregated online/presence information

They must not receive:

- local hostnames
- bridge URLs
- usernames
- passwords
- tokens
- raw battery connector details

## Private surfaces allowed to reference runtime setup

The following are private workspace surfaces and may reference non-public runtime/setup state:

- [web/src/gui/ConfigWorkspaceShell.tsx](/Users/wz/SmartElectricity/web/src/gui/ConfigWorkspaceShell.tsx)
- [web/src/gui/ConfigAccountPanel.tsx](/Users/wz/SmartElectricity/web/src/gui/ConfigAccountPanel.tsx)
- [web/src/hooks/useWorkspaceShellProps.ts](/Users/wz/SmartElectricity/web/src/hooks/useWorkspaceShellProps.ts)

Even there, cloud persistence still goes through the privacy pipeline.

## Local bridge boundary

The private workspace may display bridge runtime state for setup purposes, including:

- bridge status URL
- validation status
- provider type
- local health label

But the following must continue to stay out of cloud/public payloads:

- bridge URL
- HA token
- Modbus host/port/unit/base
- command register details
- any vendor or local bridge secret

## Remaining manual verification

The following still require human/browser verification before release:

- inspect browser network payload during cloud config save
- inspect browser network payload during leaderboard publish
- verify no sensitive fields appear in request bodies
- verify public UI never reveals any local connection details during real authenticated use
