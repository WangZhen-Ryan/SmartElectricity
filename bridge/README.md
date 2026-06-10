# GridPulse Local Bridge

This is a minimal local bridge skeleton for GridPulse.

It is designed for users who want local battery monitoring or control through:

- Home Assistant
- Generic Modbus

## What it does

The bridge exposes a normalized local HTTP API:

- `GET /api/health`
- `GET /status`
- `GET /api/config/validate`
- `GET /api/battery/telemetry`
- `GET /api/device/command/health`
- `POST /api/device/command`

The website talks only to this API.

## Quick start

1. Copy the example config:

```bash
cd bridge
cp config.example.json config.json
```

2. Edit `config.json`
   - choose `provider`
   - fill Home Assistant or Generic Modbus fields

3. Start the bridge:

```bash
cd bridge
npm start
```

4. In the website `Config` page:
   - set `Bridge URL` to `http://localhost:8787`
   - choose `Home Assistant` or `Generic Modbus`
   - open `http://localhost:8787/status`
   - click `Validate Bridge Config`
   - test telemetry and control readiness

## Important

This bridge is a **minimum bridge**, not a full vendor-certified adapter pack yet.

- Home Assistant adapter now supports real entity reads through the HA REST API
- Home Assistant command execution works if `commandMap` is configured
- Generic Modbus adapter now supports configurable holding-register reads
- Generic Modbus command execution works if `commandMap` is configured
- you still need to fill the correct entities/register map for your own battery/inverter

Launch scope:

- local control is supported only through `home-assistant`
- local control is supported only through `generic-modbus`
- vendor cloud paths remain monitor-only
- GridPulse cloud does not relay commands

## Home Assistant mode

Required:

- `baseUrl`
- `token`
- telemetry entity IDs

Optional but recommended:

- `commandMap`

`commandMap` can be configured in two ways:

1. Legacy action map
   - one service call
   - one entity
   - one action field
   - action values for `charge/hold/discharge`

2. Template mode
   - one full Home Assistant service payload per action
   - best for batteries that expose different services or payload shapes

Template example:

```json
"commandMap": {
  "templates": {
    "charge": {
      "serviceDomain": "select",
      "serviceName": "select_option",
      "serviceData": {
        "entity_id": "select.battery_mode",
        "option": "Charge"
      }
    },
    "hold": {
      "serviceDomain": "select",
      "serviceName": "select_option",
      "serviceData": {
        "entity_id": "select.battery_mode",
        "option": "Hold"
      }
    },
    "discharge": {
      "serviceDomain": "select",
      "serviceName": "select_option",
      "serviceData": {
        "entity_id": "select.battery_mode",
        "option": "Discharge"
      }
    }
  }
}
```

The bridge reads Home Assistant states from `/api/states/:entity_id`.
For commands it calls:

- `/api/services/{serviceDomain}/{serviceName}`

with:

- `entity_id`
- action field from `serviceField`

## Generic Modbus mode

Required:

- `host`
- `port`
- `unitId`
- `registerMap.socPct`

Recommended:

- full `registerMap`
- `commandMap`

The adapter currently supports:

- Modbus TCP holding register reads
- `u16`
- `i16`
- `u32`
- `i32`
- `f32`
- byte orders:
  - `ABCD`
  - `BADC`
  - `CDAB`
  - `DCBA`

You must still fill the correct vendor register map yourself.

## Why this exists

It lets the website support many battery families through one contract, without exposing battery credentials to cloud config or public pages.
