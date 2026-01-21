from __future__ import annotations

from typing import List, Optional

from core.events import MarketEvent
from data.models import PriceInterval


class AmberPriceFeed:
    def __init__(self, intervals: List[PriceInterval]) -> None:
        self._events = _build_market_events(intervals)
        self._index = 0

    def has_next(self) -> bool:
        return self._index < len(self._events)

    def next_event(self) -> MarketEvent:
        event = self._events[self._index]
        self._index += 1
        return event


def _build_market_events(intervals: List[PriceInterval]) -> List[MarketEvent]:
    buckets: dict = {}
    for interval in intervals:
        entry = buckets.setdefault(
            interval.start_time,
            {"general": None, "feedin": None, "end_time": interval.end_time},
        )
        if interval.end_time > entry["end_time"]:
            entry["end_time"] = interval.end_time

        if interval.channel_type == "general":
            entry["general"] = interval
        elif interval.channel_type == "feedIn":
            entry["feedin"] = interval

    events: List[MarketEvent] = []
    for start_time in sorted(buckets.keys()):
        entry = buckets[start_time]
        general: Optional[PriceInterval] = entry["general"]
        feedin: Optional[PriceInterval] = entry["feedin"]
        events.append(
            MarketEvent(
                start_time=start_time,
                end_time=entry["end_time"],
                general_cents=general.per_kwh_cents if general else None,
                feedin_cents=feedin.per_kwh_cents if feedin else None,
            )
        )
    return events
