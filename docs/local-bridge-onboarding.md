# Local Bridge Onboarding

## Who needs this

You need a local bridge if:

- you want battery monitor data from your own LAN
- you want local battery control
- you already run Home Assistant or can run a small always-on service

You do **not** need this if you only want:

- Amber price replay
- backtesting
- public leaderboard
- cloud-read-only features

## What hardware works

Use any always-on local machine:

- Raspberry Pi
- NAS
- old laptop or mini PC
- Home Assistant host
- router with Docker support

## Beginner setup

1. Run the bridge on your always-on device.
2. Pick one provider:
   - `home-assistant`
   - `generic-modbus`
3. Set the website `Bridge URL` to your bridge, for example:
   - `http://YOUR-BRIDGE-HOST:8787`
4. Open `http://YOUR-BRIDGE:8787/status`
5. Check `Config incomplete` vs `Ready for monitor`
6. In the website `Config` page, click `Validate Bridge Config`
7. Test telemetry first
8. Only after telemetry is healthy, enable local control

## Home Assistant path

Use this when:

- your battery already appears in Home Assistant
- you prefer entity/service configuration instead of register maps

You will need:

- Home Assistant URL
- a long-lived access token
- entity IDs for SOC / power / solar / grid
- optionally a command service mapping
- for flexible control, use per-action `commandMap.templates`

This is the easiest local-control path for most users.

## Generic Modbus path

Use this when:

- your battery or inverter exposes Modbus TCP
- you know the register map
- you are comfortable editing numeric addresses and scaling

You will need:

- host
- port
- unit ID
- byte order
- register map
- command register mapping

This path is more powerful, but less beginner-friendly.

## Status page and config validation

Your bridge should expose:

- `/status`
- `/api/config/validate`
- `/api/battery/telemetry`
- `/api/device/command/health`

The website uses `/api/config/validate` to tell beginners which fields are missing before they try real telemetry or local control.

## Safety model

- SmartElectricity cloud does not relay battery control commands
- passwords, tokens, hostnames, and bridge URLs stay local
- the website only sends commands to your own bridge
- if the bridge is missing or unhealthy, the UI stays in monitor-only mode

## Current launch scope

Local control launch scope:

- Home Assistant
- Generic Modbus

Not launch-ready for control:

- vendor cloud control
- unsupported custom bridges
- any battery without a local Home Assistant or Generic Modbus path

## Reality check

If your battery vendor blocks LAN access or does not expose a usable local protocol, the bridge cannot magically fix that.

In that case:

- use monitor-only mode
- use vendor cloud read path if available
- or wait until your local access path is unlocked
