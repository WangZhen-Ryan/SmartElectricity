# Local Battery Bridge Specification

## Purpose
This spec defines a closed-distribution local bridge contract that allows the SmartElectricity website to:

- read battery/inverter telemetry from many battery types
- perform local-only battery control when explicitly enabled
- avoid sending device credentials or LAN details to cloud config or public surfaces

The launch website supports direct product-facing control modes for:

- `home-assistant`
- `generic-modbus`

But this bridge spec is intentionally broader, so future battery families can integrate through a local adapter without changing the website contract.

## Architecture
The website should never directly implement per-vendor battery control logic.

Instead:

1. The user runs a local bridge on a Raspberry Pi, NAS, mini PC, router, or always-on machine.
2. The bridge talks to the actual battery path:
   - Home Assistant entities/services
   - Modbus TCP
   - MQTT / Node-RED flows
   - vendor LAN/serial adapters
   - future vendor cloud adapters if explicitly allowed
3. The website talks only to the bridge's normalized HTTP API.

This gives one UI contract for many battery types.

## Bridge Requirements
The bridge must be user-hosted and local to the battery environment.

Required properties:

- must expose HTTP on the user's LAN
- must not require SmartElectricity cloud to proxy commands
- must own battery credentials locally
- must not upload secrets to SmartElectricity cloud config

Recommended deployment targets:

- Raspberry Pi
- NAS
- Home Assistant host
- old laptop / mini PC
- Docker-capable router or local server

## Product-Facing Provider Model
The website should continue to expose only a small set of user-facing providers:

- `home-assistant`
- `generic-modbus`
- `vendor-cloud`

Notes:

- `home-assistant` means the bridge is backed by HA services/entities.
- `generic-modbus` means the bridge is backed by Modbus TCP register logic.
- `vendor-cloud` is monitor-only for launch.
- internally, the local bridge can support many battery families without exposing vendor complexity to the UI.

## Normalized Telemetry API
The bridge should expose:

### `GET /api/battery/telemetry`

Response:

```json
{
  "ok": true,
  "provider": "home-assistant",
  "adapter": "sigenergy-ha",
  "timestamp": "2026-03-18T18:30:00Z",
  "live": true,
  "simulated": false,
  "socPct": 62.5,
  "reservePct": 20,
  "batteryPowerKw": -3.2,
  "gridKw": 1.4,
  "solarKw": 5.8,
  "plantKw": 4.4,
  "maxChargeKw": 5,
  "maxDischargeKw": 5,
  "chargeCapacityKwh": 12.1,
  "dischargeCapacityKwh": 17.0,
  "message": "live telemetry",
  "rawSourceKind": "ha-entity"
}
```

Field semantics:

- negative `batteryPowerKw` = discharge
- positive `batteryPowerKw` = charge
- `live` must be `false` if bridge is returning stale or placeholder data
- `simulated` must be `true` for synthetic or replay-only data

## Bridge Health API
The bridge must expose:

### `GET /api/device/command/health`

Response:

```json
{
  "ok": true,
  "commandCapable": true,
  "mode": "home-assistant",
  "message": "HA service bridge reachable",
  "adapter": "sigenergy-ha",
  "telemetryLive": true
}
```

Minimum rules:

- `ok=true` and `commandCapable=true` => bridge is healthy
- `ok=true` and `commandCapable=false` => bridge reachable but not command-capable
- request failure => offline
- bundled SmartElectricity dev server must continue to return `read-only-bundled-proxy`

## Command API
The bridge must expose:

### `POST /api/device/command`

Request:

```json
{
  "provider": "home-assistant",
  "action": "charge",
  "powerKw": 3.5,
  "targetSoc": null,
  "reason": "Local override from SmartElectricity monitor",
  "commandRegister": 40001,
  "commandUnitId": 247,
  "commandScale": 1000
}
```

Response:

```json
{
  "ok": true,
  "accepted": true,
  "provider": "home-assistant",
  "action": "charge",
  "message": "Command forwarded to local adapter"
}
```

Rules:

- command execution is always local-only
- bridge is responsible for adapter-specific translation
- website must not know vendor register/service details beyond generic metadata

## Adapter Model
To support all battery types, the bridge should use adapters.

Suggested adapter classes:

- `ha-*`
  - reads entities
  - calls HA services
- `modbus-*`
  - reads/writes register maps
- `mqtt-*`
  - consumes state topics
  - publishes control topics
- `vendor-lan-*`
  - vendor-specific local APIs
- `vendor-cloud-*`
  - read-only for launch unless explicitly approved

Examples:

- `sigenergy-ha`
- `sigenergy-modbus`
- `foxess-ha`
- `goodwe-modbus`
- `solis-modbus`
- `tesla-cloud-read`

This is how the system can support many battery types without exposing many product modes.

## Security Model
Secrets that must remain local to the bridge:

- vendor usernames/passwords
- HA long-lived tokens
- Modbus host/port/unit/register details
- local IP addresses
- MQTT broker credentials
- vendor cloud credentials

The website may store only non-secret metadata:

- provider type
- control enabled/disabled
- instant override enabled/disabled
- readiness label
- monitor mode label
- active strategy/profile metadata

## Launch Scope
For launch, the website should claim:

- monitor support:
  - Amber
  - local Modbus
  - current cloud monitor paths already implemented
- control support:
  - Home Assistant bridge
  - Generic Modbus bridge

Do not claim generic support for all batteries unless the user has a compatible local bridge or Home Assistant / Generic Modbus path.

Accurate launch wording:

- "Supports local battery control through Home Assistant or Generic Modbus bridge."
- "Additional battery families can be integrated through a local bridge adapter."

## Non-Goals for Launch
Not part of launch:

- SmartElectricity cloud relaying control commands
- storing battery secrets in cloud config
- exposing vendor-specific control UI in the website
- pretending all vendor-cloud sources are command-capable

## Recommended Next Step
Build a distributable local bridge package with:

- one HTTP server
- one adapter interface
- one HA adapter
- one Generic Modbus adapter
- telemetry endpoint
- health endpoint
- command endpoint

That is the real path to "supporting all battery types" without opening the whole codebase.
