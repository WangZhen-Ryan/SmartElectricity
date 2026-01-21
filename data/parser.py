from __future__ import annotations

from datetime import datetime
from typing import List

from data.models import PriceInterval


def parse_amber_payload(payload: dict) -> List[PriceInterval]:
    intervals: List[PriceInterval] = []
    for item in payload.get("data", []):
        intervals.append(
            PriceInterval(
                start_time=_parse_time(item["startTime"]),
                end_time=_parse_time(item["endTime"]),
                channel_type=item["channelType"],
                per_kwh_cents=float(item["perKwh"]),
            )
        )
    intervals.sort(key=lambda x: (x.start_time, x.channel_type))
    return intervals


def _parse_time(value: str) -> datetime:
    # Amber returns ISO 8601 with timezone, e.g. "2024-01-01T00:00:00+10:00".
    return datetime.fromisoformat(value)
