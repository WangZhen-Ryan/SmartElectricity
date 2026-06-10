#!/usr/bin/env python3
"""
Read-only probe for Sigenergy cloud API via the unofficial `sigen` package.

Usage:
  SIGEN_USERNAME=... SIGEN_PASSWORD=... SIGEN_REGION=apac python scripts/sigen_probe.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


async def main() -> int:
    username = _require_env("SIGEN_USERNAME")
    password = _require_env("SIGEN_PASSWORD")
    region = os.getenv("SIGEN_REGION", "apac").strip() or "apac"

    try:
        from sigen import Sigen  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "Package `sigen` is not installed. Run: pip install sigen"
        ) from exc

    # Read-only: only call fetch/get methods. Never call any set_* methods.
    client = Sigen(username=username, password=password, region=region)
    await client.async_initialize()

    station_info = await client.fetch_station_info()
    energy_flow = await client.get_energy_flow()
    operational_mode = await client.get_operational_mode()

    result = {
        "ok": True,
        "at": datetime.now(timezone.utc).isoformat(),
        "region": region,
        "station": station_info,
        "energy_flow": energy_flow,
        "operational_mode": operational_mode,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)

