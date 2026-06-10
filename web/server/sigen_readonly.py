#!/usr/bin/env python3
import argparse
import asyncio
import json
import math
import sys
from typing import Any, Dict, List, Optional, Tuple


def normalize_key(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def walk_values(value: Any, prefix: str = "") -> List[Tuple[str, Any]]:
    rows: List[Tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            rows.extend(walk_values(child, child_prefix))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            child_prefix = f"{prefix}[{idx}]"
            rows.extend(walk_values(child, child_prefix))
    else:
        rows.append((prefix, value))
    return rows


def to_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v if math.isfinite(v) else None
    if isinstance(value, str):
        try:
            v = float(value.strip())
            return v if math.isfinite(v) else None
        except Exception:
            return None
    return None


def pick_metric(flattened: List[Tuple[str, Any]], aliases: List[str]) -> Optional[float]:
    alias_norm = [normalize_key(a) for a in aliases]
    best: Optional[Tuple[int, float]] = None
    for path, raw in flattened:
        val = to_number(raw)
        if val is None:
            continue
        path_norm = normalize_key(path)
        score = 0
        for alias in alias_norm:
            if alias and alias in path_norm:
                score = max(score, len(alias))
        if score <= 0:
            continue
        if best is None or score > best[0]:
            best = (score, val)
    return best[1] if best else None


def kW_guess(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    # Heuristic: if a value looks like watts, convert to kW.
    if abs(value) > 2000:
        return value / 1000.0
    return value


def soc_guess(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value > 100 and value <= 1000:
        return value / 10.0
    return value


async def read_sigen(username: str, password: str, region: str) -> Dict[str, Any]:
    try:
        from sigen import Sigen
    except Exception as err:
        raise RuntimeError(f"sigen import failed: {err}") from err

    client = Sigen(username=username, password=password, region=region)
    await client.async_initialize()
    station = await client.fetch_station_info()
    flow = await client.get_energy_flow()

    flat = walk_values(flow)

    metrics = {
        "socPct": soc_guess(
            pick_metric(
                flat,
                [
                    "soc",
                    "batterySoc",
                    "essSoc",
                    "energyStorageSoc",
                ],
            )
        ),
        "essKw": kW_guess(
            pick_metric(flat, ["essPower", "batteryPower", "storagePower", "batPower"])
        ),
        "pvKw": kW_guess(
            pick_metric(flat, ["pvPower", "photovoltaicPower", "solarPower"])
        ),
        "gridKw": kW_guess(
            pick_metric(flat, ["gridPower", "meterPower", "gridActivePower"])
        ),
        "plantKw": kW_guess(
            pick_metric(flat, ["plantPower", "loadPower", "housePower", "totalPower"])
        ),
        "maxChargeKw": kW_guess(
            pick_metric(flat, ["maxChargingPower", "availableMaxChargingPower", "chargeLimit"])
        ),
        "maxDischargeKw": kW_guess(
            pick_metric(flat, ["maxDischargingPower", "availableMaxDischargingPower", "dischargeLimit"])
        ),
        "chargeCapacityKwh": pick_metric(
            flat, ["chargingCapacity", "chargeCapacity", "availableChargeCapacity"]
        ),
        "dischargeCapacityKwh": pick_metric(
            flat, ["dischargingCapacity", "dischargeCapacity", "availableDischargeCapacity"]
        ),
    }
    return {
        "ok": True,
        "source": "sigen-cloud",
        "region": region,
        "stationId": getattr(client, "station_id", None),
        "metrics": metrics,
        "raw": {
            "station": station,
            "energyFlow": flow,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only sigen cloud metrics bridge.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--region", default="apac")
    args = parser.parse_args()
    try:
        payload = asyncio.run(read_sigen(args.username, args.password, args.region))
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as err:
        print(json.dumps({"ok": False, "error": str(err)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
